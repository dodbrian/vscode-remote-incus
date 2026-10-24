// Isolated transfer experiment. No default target or production destination.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	incus "github.com/lxc/incus/v7/client"
	"github.com/lxc/incus/v7/shared/cliconfig"
	"github.com/lxc/incus/v7/shared/util"
	"github.com/pkg/sftp"
)

type result struct {
	Mode      string `json:"mode"`
	Outcome   string `json:"outcome"`
	Bytes     int64  `json:"bytes"`
	ConnectMS int64  `json:"connect_ms"`
	UploadMS  int64  `json:"upload_ms"`
	TotalMS   int64  `json:"total_ms"`
}

func main() {
	// Avoid ever printing a URL, target, credential path, remote stderr or token.
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "TRANSFER_FAILURE: "+err.Error())
		os.Exit(1)
	}
}
func run() error {
	target := os.Getenv("INCUS_TEST_TARGET")
	if !regexp.MustCompile(`^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$`).MatchString(target) {
		return errors.New("explicit target required")
	}
	mode := os.Getenv("INCUS_TRANSFER_MODE")
	if mode != "sftp-sequential" && mode != "sftp-concurrent" && mode != "http" {
		return errors.New("invalid experiment mode")
	}
	remotePath := os.Getenv("INCUS_TRANSFER_REMOTE")
	// Always write an owned disposable partial artifact, never an install path.
	if !strings.HasPrefix(remotePath, "/tmp/incus-transfer-") || !strings.HasSuffix(remotePath, ".partial") || path.Clean(remotePath) != remotePath {
		return errors.New("owned /tmp/incus-transfer-*.partial path required")
	}
	uid, e1 := strconv.ParseInt(os.Getenv("INCUS_TRANSFER_UID"), 10, 32)
	gid, e2 := strconv.ParseInt(os.Getenv("INCUS_TRANSFER_GID"), 10, 32)
	perm, e3 := strconv.ParseUint(os.Getenv("INCUS_TRANSFER_MODE_BITS"), 8, 12)
	if e1 != nil || e2 != nil || e3 != nil || uid < 0 || gid < 0 {
		return errors.New("explicit numeric uid/gid and octal mode required")
	}
	source, err := os.Open(os.Getenv("INCUS_TRANSFER_LOCAL"))
	if err != nil {
		return errors.New("local source open failed")
	}
	defer source.Close()
	info, err := source.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return errors.New("regular local source required")
	}
	started := time.Now()
	cfg, err := cliconfig.LoadConfig("")
	if err != nil {
		return errors.New("client configuration load failed")
	}
	cfg.ProjectOverride = os.Getenv("INCUS_PROJECT")
	parts := strings.SplitN(target, ":", 2)
	server, err := cfg.GetInstanceServer(parts[0])
	if err != nil {
		return errors.New("authenticated connection failed")
	}
	defer server.Disconnect()
	connected := time.Now()
	success := false
	defer func() {
		if !success {
			_ = server.DeleteInstanceFile(parts[1], remotePath)
		}
	}()
	if mode == "http" {
		err = server.CreateInstanceFile(parts[1], remotePath, incus.InstanceFileArgs{Content: source, UID: uid, GID: gid, Mode: int(perm), Type: "file", WriteMode: "overwrite"})
		if err != nil {
			return errors.New("HTTP upload failed; partial cleanup attempted")
		}
	} else {
		var client *sftp.Client
		if mode == "sftp-sequential" {
			client, err = server.GetInstanceFileSFTP(parts[1])
		} else {
			conn, connErr := server.GetInstanceFileSFTPConn(parts[1])
			if connErr != nil {
				return errors.New("SFTP connection failed")
			}
			client, err = sftp.NewClientPipe(conn, conn, sftp.MaxPacketUnchecked(128*1024), sftp.UseConcurrentWrites(true))
			if err != nil {
				_ = conn.Close()
			}
		}
		if err != nil {
			return errors.New("SFTP client setup failed")
		}
		defer client.Close()
		out, openErr := client.OpenFile(remotePath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
		if openErr != nil {
			return errors.New("SFTP output open failed")
		}
		written, copyErr := util.SafeCopy(out, source)
		if copyErr == nil && written != info.Size() {
			copyErr = io.ErrShortWrite
		}
		if copyErr == nil {
			copyErr = out.Chown(int(uid), int(gid))
		}
		if copyErr == nil {
			copyErr = out.Chmod(os.FileMode(perm))
		}
		closeErr := out.Close()
		if copyErr != nil || closeErr != nil {
			return errors.New("SFTP upload or metadata failed; partial cleanup attempted")
		}
	}
	success = true
	done := time.Now()
	return json.NewEncoder(os.Stdout).Encode(result{Mode: mode, Outcome: "success-unverified-partial", Bytes: info.Size(), ConnectMS: connected.Sub(started).Milliseconds(), UploadMS: done.Sub(connected).Milliseconds(), TotalMS: done.Sub(started).Milliseconds()})
}
