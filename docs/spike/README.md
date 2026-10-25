# Phase-0 transport proof of concept

The original spike established that a VS Code server could run in an Incus
container and communicate with the client through `incus exec` stdio, without
SSH or externally exposed instance ports. Its implementation has been removed
from the working tree and remains available in sanitized Git history.

The experiments established the architecture used by the extension:

- Install and run the server as the selected instance user, with token-file
  authentication and a loopback listener.
- Bridge each logical connection through a separate Incus exec process using
  the server's bundled Node runtime.
- Keep protocol bytes on stdout and diagnostics on stderr; bound relay cleanup.
- Handle client/server commit alignment and real Incus CLI behavior.

The canonical findings, versions and limitations are recorded in
[DESIGN §8](../DESIGN.md#8-spike-evidence-ledger-all-hands-on-verified-incus-605-vs-code-1141211420).
The [current testing guide](../tests/README.md) describes supported verification
entry points. The spike's old deployment and token-state scripts are historical
experiments, not current operating instructions. Current token policy is
specified in [DESIGN §4](../DESIGN.md#4-connection-token-policy-frozen).
