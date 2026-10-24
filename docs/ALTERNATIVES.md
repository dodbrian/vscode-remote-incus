# Related projects and distribution research

Research date: **2026-10-23**. This is a dated research snapshot, not a claim
that no equivalent can ever exist. Recheck upstream before publication.

## Finding and positioning

The search found similar products, but no public extension matching the
combination implemented here: full remote development in desktop VS Code,
access to existing local and remote Incus instances through the configured
Incus client, and an `incus exec` transport without SSH or a separate gateway.

Suggested description:

> Open existing local and remote Incus instances as full VS Code development
> environments through your existing Incus connection, without SSH setup or
> a separate gateway.

Avoid claims such as "first" or "only". In particular, avoiding an SSH server
inside each instance is not unique: ssh2incus already achieves that through
a host-side gateway.

## Closest alternatives

| Project | Overlap | Difference from Remote - Incus |
| --- | --- | --- |
| Canonical Workshop | VS Code extension with environment discovery, creation, start, reconnect, and full in-container development | LXD/Workshop-managed environments; connects through Remote-SSH |
| ssh2incus | Incus containers and VMs, multiple remotes, IDE access without per-instance SSH servers | Separate host-side SSH gateway; SSH remains the IDE transport |
| dviererbe.vscode-lxd | Container/resource explorer inside VS Code | Management and inspection; no remote development connection found |
| Incus-spawn / isx | One-click Open in VS Code for Incus environments | External CLI/TUI; installs instance sshd and uses Remote-SSH |
| bubble | Provisions Incus development environments and opens VS Code | Opinionated environment manager, especially for Lean; uses Remote-SSH |
| XPipe | Incus discovery, management, shells, and file access | Separate desktop application; documented VS Code remote integration uses SSH |

### Canonical Workshop

The closest VS Code extension in user experience. It creates and lists project
workshops, starts stopped environments, reopens the window inside them, and
refreshes environments when their definitions change. Terminals, language
servers, and debuggers execute in the container.

It is published as `Canonical.workshop`, depends on Remote-SSH, and manages
SSH certificates and workshop SSH servers. It is a development-environment
manager backed by LXD, rather than a general resolver for existing Incus
instances. Its documented workflow therefore does not replace ours directly.

Sources: [VS Code walkthrough](https://ubuntu.com/workshop/docs/how-to/develop-with-workshops/connect-vscode/),
[release announcement](https://discourse.ubuntu.com/t/workshop-for-vs-code-develop-inside-your-workshops-without-leaving-the-editor/87883).

### ssh2incus

The closest transport alternative. An SSH server on the Incus host routes
connections to instances through the Incus API. It supports containers and
VMs, multiple remotes, command execution, SFTP/SCP, and port forwarding.
Its documentation reports testing with VS Code, Cursor, and JetBrains Gateway.
No SSH server is required inside the instances.

This can substitute for much of the development workflow if operating an
additional gateway is acceptable. Our distinction is using the existing Incus
connection directly, without introducing an SSH endpoint or SSH credentials.

Sources: [documentation](https://ssh2incus.com/documentation),
[source](https://github.com/mobydeck/ssh2incus).

### LXD extension

`dviererbe.vscode-lxd` is published on Microsoft Marketplace and Open VSX.
It exposes instances, images, networks, and storage. The inspected manifest
and source tree contained refresh/report commands, no remote resolver proposal,
and no Remote-SSH dependency. No full remote-workspace connection feature was
found. Incus compatibility is not established by its documentation.

Sources: [Marketplace](https://marketplace.visualstudio.com/items?itemName=dviererbe.vscode-lxd),
[manifest](https://github.com/dviererbe/vscode-lxd/blob/main/package.json),
[Open VSX](https://open-vsx.org/extension/dviererbe/vscode-lxd).

### Incus-spawn / isx and bubble

isx offers one-click IDE actions for Incus environments. Its `vscode-remote`
tool explicitly requires `sshd`, installs it automatically, and relies on
Remote-SSH to install the VS Code backend. It is an external environment
manager, not a native Incus resolver extension.

bubble provisions Incus environments with opinionated Lean development
presets and opens them in VS Code. Remote-SSH is an editor prerequisite.

Sources: [isx IDE integration](https://github.com/Sanne/incus-spawn/blob/main/docs/TOOLS.md#remote-ide-access),
[bubble](https://github.com/kim-em/bubble).

### XPipe and other adjacent approaches

XPipe discovers LXD/Incus containers and VMs using their CLI tools and offers
shells, file access, and management. Its documented VS Code remote-development
integration launches SSH connections. No native Incus-to-VS-Code resolver was
found in the inspected documentation.

Sources: [LXD/Incus integration](https://docs.xpipe.io/guide/lxc),
[VS Code integration](https://github.com/xpipe-io/docs/blob/master/content/guide/ssh.mdx).

Other search hits included Code on Incus / Coi (AI-tool session isolation),
VMTREE (SSH-based development environment provisioning), and code-server
inside Incus (browser-hosted development). These are related workflows,
rather than equivalents of our desktop VS Code resolver.

Sources: [Coi](https://github.com/coipond/coi),
[VMTREE](https://github.com/kkovacs/vmtree),
[code-server](https://github.com/coder/code-server).

## Search scope and limits

- Queried Microsoft Marketplace's public catalog and Open VSX's search API
  directly for `incus`, `lxd`, and `lxc`.
- Both registries returned zero results for `incus`. Relevant LXD results
  were the LXD explorer in both registries and Workshop on Marketplace.
- Searched GitHub repository metadata, names, descriptions, README indexes,
  and TypeScript repositories for Incus/LXD and VS Code combinations.
- Searched web indexes and Incus/LXD community discussions for remote
  development, exec transport, resolver APIs, and Dev Containers adapters.
- Inspected primary project documentation and relevant manifests/source.
  Alternatives were not installed or runtime-tested.

Negative search results do not exclude private, unindexed, newly published,
or differently named projects. Registry acceptance and editor compatibility
are separate questions.

## Distribution implications

Our essential `resolvers` API and Remote Explorer's `contribViewsRemote` are
still proposed. Microsoft's documentation says extensions using proposed APIs
should not be published on Marketplace. VSCE has publishing override flags,
but those do not establish policy permission or grant runtime API access.
No public GA date or finalization commitment was found for these proposals.

Sources: [proposed API policy](https://code.visualstudio.com/api/advanced-topics/using-proposed-api),
[resolver proposal](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.resolvers.d.ts),
[Remote Explorer API gate](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/browser/viewsExtensionPoint.ts),
[API finalization process](https://github.com/microsoft/vscode/wiki/Extension-API-process),
[VSCE publishing validation](https://github.com/microsoft/vscode-vsce/blob/main/src/publish.ts).

VSIX sharing is Microsoft's documented alternative. Open VSX is a plausible
additional registry: it already hosts Open Remote - SSH, which documents
proposed-API opt-in. This is precedent, not guaranteed acceptance of our package.
Microsoft VS Code users would still install the VSIX and enable our APIs;
Open VSX hosting does not change the client's default marketplace.

VSCodium uses Open VSX by default, but our Microsoft VS Code Server bootstrap
needs separate compatibility and licensing review before claiming support.
Publishing also requires a final publisher ID, registry account/agreement,
and replacement of the placeholder repository metadata. No publication has
been attempted or authorized by this research.

Sources: [VSIX sharing](https://code.visualstudio.com/api/advanced-topics/using-proposed-api#sharing-extensions-using-the-proposed-api),
[Open Remote - SSH](https://open-vsx.org/extension/jeanp413/open-remote-ssh),
[Open VSX publishing](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions),
[VSCodium registry documentation](https://github.com/VSCodium/vscodium/blob/master/docs/extensions.md).

Keep the current architecture for direct Incus access. GitHub release VSIXs
plus a prospective Open VSX listing are practical distribution candidates.
If Marketplace availability becomes essential, Workshop demonstrates an
SSH-based companion approach worth evaluating, subject to supported integration
and licensing review. A virtual filesystem alone would not preserve a general
remote extension host or equivalent language-tool/debugger behavior.
