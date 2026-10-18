#!/usr/bin/env python3
"""Spike step 4: local TCP listener bridging each connection to its own
`incus exec … node -e` stdio relay inside fixture-container (no sshd).

Usage: python3 spike/04-relay.py
Requires spike/.state/{server.commit, server.port}.

Each accepted TCP connection:
  browser/socket  <->  [client] asyncio pump  <->  `incus exec -T --user ubuntu …
  node -e <relay>`  <->  127.0.0.1:<server-port> inside the container

Teardown rules (the ones the audit demanded):
  - socket EOF  -> close child stdin (server sees FIN)
  - child exit  -> close socket
  - socket abort-> kill child (no orphans)
"""
import asyncio
import pathlib
import sys

CONTAINER = "fixture-container"
DBG_USER = "ubuntu"
DBU_UID = "1000"   # incus 6.0.5: --user accepts NUMERIC uid only (verified)
DBU_HOME = f"/home/{DBG_USER}"
LISTEN_HOST, LISTEN_PORT = "127.0.0.1", 16080

STATE = pathlib.Path(__file__).parent / ".state"

# In-container relay; runs with the server's OWN bundled node.
# Writes ONLY mirrored bytes to stdout; stderr stays on its own channel.
RELAY_JS = (
    "const net=require('net');"
    "process.stdin.pause();"
    "const client=net.createConnection({host:process.env.RELAY_HOST,"
    "port:+process.env.RELAY_PORT},()=>{});"
    "client.pipe(process.stdout);"
    "process.stdin.pipe(client);"
    "process.stdin.on('end',()=>{client.end();});"
    "process.stdin.on('error',()=>process.exit(1));"
    "process.stdout.on('error',()=>process.exit(1));"
    "client.on('close',()=>process.exit(0));"
    "client.on('error',()=>process.exit(1));"
)


def read_state(name: str) -> str:
    return (STATE / name).read_text().strip()


async def pump(src: asyncio.StreamReader, dst_write, label: str, on_end):
    """Copy src -> dst; signal teardown when src hits EOF or errors."""
    try:
        while True:
            data = await src.read(65536)
            if not data:
                break
            dst_write(data)
            await drain(dst_write)
    except (ConnectionResetError, BrokenPipeError, Exception) as e:  # noqa: BLE001
        print(f"[relay:{label}] closed: {e!r}", file=sys.stderr)
    finally:
        await on_end()


async def drain(write):
    try:
        result = write(b"")  # flush hook – replaced at call site for streams only
    except Exception:  # noqa: BLE001
        pass


async def bridge(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, commit: str, port: str):
    peer = writer.get_extra_info("peername")
    print(f"[listener] new connection from {peer} -> spawning exec bridge", file=sys.stderr)

    cmd = [
        "incus", "exec", CONTAINER, "--mode", "non-interactive",
        "--user", DBU_UID,
        "--env", f"HOME={DBU_HOME}",
        "--env", "RELAY_HOST=127.0.0.1",
        "--env", f"RELAY_PORT={port}",
        "--",
        f"{DBU_HOME}/.vscode-server/bin/{commit}/node",
        "-e", RELAY_JS,
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=None,  # visible: the audit insists we see stray diagnostics
    )

    async def finish():
        try:
            proc.kill()
        except ProcessLookupError:
            pass
        if not writer.is_closing():
            writer.close()

    # client -> exec-stdin
    t1 = asyncio.create_task(pump(reader, lambda d: proc.stdin.write, "client->proc", finish))
    # exec-stdout -> client
    async def proc_to_client():
        try:
            while True:
                data = await proc.stdout.read(65536)
                if not data:
                    break
                writer.write(data)
                await writer.drain()
        except Exception as e:  # noqa: BLE001
            print(f"[relay:proc->client] closed: {e!r}", file=sys.stderr)
        finally:
            await finish()

    t2 = asyncio.create_task(proc_to_client())

    try:
        done, pending = await asyncio.wait({t1, t2, asyncio.create_task(proc.wait())},
                                          return_when=asyncio.FIRST_COMPLETED)
        await finish()
    finally:
        for t in (t1, t2):
            t.cancel()
        await asyncio.gather(*pending, return_exceptions=True)


async def main():
    commit = read_state("server.commit")
    port = read_state("server.port")
    try:
        token = read_state("server.token")
        print(f"== open in a browser:  http://{LISTEN_HOST}:{LISTEN_PORT}/?tkn={token}")
    except FileNotFoundError:
        print("== no token state; expect auth failure page — re-run 03-start-server.sh")

    print(f"== bridging {LISTEN_HOST}:{LISTEN_PORT} -> {CONTAINER}:127.0.0.1:{port} "
          f"(commit {commit[:12]}, relay = server-bundled node)")

    async def handle(reader, writer):
        try:
            await bridge(reader, writer, commit, port)
        finally:
            if not writer.is_closing():
                writer.close()

    server = await asyncio.start_server(handle, LISTEN_HOST, LISTEN_PORT)
    print(f"== listener up on {LISTEN_HOST}:{LISTEN_PORT}", file=sys.stderr)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
