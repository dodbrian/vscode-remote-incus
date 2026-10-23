import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { withFixture } from './support/fixture';
import { context, progress } from './support/scenario';
import { FolderHistory } from '../src/history';
import { FolderNode, InstanceNode, InstancesTree } from '../src/tree';
import { registerCommands } from '../src/commands';
import { activate } from '../src/extension';
import { withProgressReport } from '../src/progress';
import { firstLine } from '../src/logging';
const authority = 'incus+one:same';
const node = (remote = 'one', status = 'Running') => new InstanceNode(remote, { name: 'same', status }, { online: false, hasFolders: false, icon: new vscode.ThemeIcon('vm') });

test('X4: history full authority isolation, cap, reorder, idempotence and remove', t => withFixture(t, f => {
  const history = new FolderHistory(context(f));
  for (let i = 0; i < 12; i++) history.record(authority, `/folder/${i}`);
  history.record('incus+two:same', '/folder/11');
  assert.equal(history.folders(authority).length, 10); assert.equal(history.folders(authority).at(-1), '/folder/2');
  const updates = f.state.get('updates'); history.record(authority, '/folder/11'); assert.equal(f.state.get('updates'), updates);
  history.record(authority, '/folder/5'); assert.equal(history.folders(authority)[0], '/folder/5');
  history.remove(authority, '/folder/11'); history.remove(authority, '/absent');
  assert.deepEqual(history.folders('incus+two:same'), ['/folder/11']);
  assert.equal(history.folders(authority).includes('/folder/11'), false);
}));

test('X1 X4: activation registers contributed view/resolver and records Incus workspace only', t => withFixture(t, f => {
  const ctx = context(f); f.state.set('authority', authority);
  f.state.set('folders', [{ uri: vscode.Uri.from({ scheme: 'vscode-remote', authority, path: '/workspace' }) }, { uri: vscode.Uri.file('/local') }]);
  f.expect('vscode.output', () => ({ appendLine() {}, show() {}, dispose() {} }));
  f.expect('vscode.registerResolver', (prefix, resolver) => { assert.equal(prefix, 'incus'); assert.equal(typeof resolver.resolve, 'function'); return { dispose() {} }; });
  f.expect('vscode.registerTree', (id) => { assert.equal(id, 'remote-incus.instances'); return { dispose() {} }; });
  const debug = process.env.REMOTE_INCUS_DEBUG_LOG; delete process.env.REMOTE_INCUS_DEBUG_LOG;
  f.defer(() => { if (debug === undefined) delete process.env.REMOTE_INCUS_DEBUG_LOG; else process.env.REMOTE_INCUS_DEBUG_LOG = debug; });
  activate(ctx);
  assert.deepEqual(new FolderHistory(ctx).folders(authority), ['/workspace']);
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.ok(manifest.extensionKind.includes('ui')); assert.equal(manifest.capabilities.untrustedWorkspaces.supported, true);
  for (const proposal of ['resolvers', 'contribViewsRemote']) assert.ok(manifest.enabledApiProposals.includes(proposal));
  assert.ok(manifest.contributes.views.remote.some((v: any) => v.id === 'remote-incus.instances' && v.remoteName === 'incus' && v.group === 'targets@1'));
}));

test('X2 X5 X6: tree isolation, icons/assets, selection, warning child and refresh', t => withFixture(t, async f => {
  const history = new FolderHistory(context(f)); const tree = new InstancesTree(history, `${process.cwd()}/assets`);
  history.record(authority, '/same path'); history.record('incus+two:same', '/same path');
  f.state.set('authority', authority); f.state.set('folders', [{ uri: vscode.Uri.from({ scheme: 'vscode-remote', authority, path: '/same path' }) }]);
  f.routes.set('child_process.execFile', (_cmd, args, _opts, cb) => {
    if (args[0] === 'remote' && args[1] === 'list') cb(null, JSON.stringify({ one: { Protocol: 'incus' }, two: { Protocol: 'incus' }, dead: { Protocol: 'incus' }, images: { Protocol: 'simplestreams' } }), '');
    else if (args[0] === 'remote') cb(new Error('default unavailable'), '', 'default unavailable');
    else if (args[1] === 'dead:') cb(new Error('offline'), '', 'offline');
    else cb(null, JSON.stringify([{ name: 'same', status: 'Running' }, { name: 'stopped', status: 'Stopped' }, { name: 'frozen', status: 'Frozen' }]), '');
  });
  const roots = await tree.getChildren(); assert.equal(roots.length, 3);
  assert.ok(roots.every(r => r.collapsibleState === vscode.TreeItemCollapsibleState.Expanded && r.iconPath === undefined));
  const one = await tree.getChildren(roots[0]); const two = await tree.getChildren(roots[1]);
  assert.equal(one[0].command, undefined); assert.equal(one[0].description, undefined);
  assert.equal(one[0].collapsibleState, vscode.TreeItemCollapsibleState.Expanded);
  assert.equal(one[1].collapsibleState, vscode.TreeItemCollapsibleState.None); assert.equal(one[1].description, undefined); assert.equal(one[2].description, 'Frozen');
  assert.match((one[0].tooltip as vscode.MarkdownString).value, /Running/);
  assert.equal((two[0].iconPath as vscode.ThemeIcon).id, 'vm-running'); assert.equal((one[1].iconPath as vscode.ThemeIcon).id, 'vm');
  const folders1 = await tree.getChildren(one[0]); const folders2 = await tree.getChildren(two[0]);
  assert.equal(folders1[0].label, '/same path'); assert.equal(folders1[0].command, undefined);
  for (const [item, name] of [[one[0], 'vm-active'], [folders1[0], 'folder-active'], [folders2[0], 'folder']] as const) {
    const icons = item.iconPath as { light: vscode.Uri; dark: vscode.Uri };
    for (const theme of ['light', 'dark'] as const) { assert.ok(icons[theme].fsPath.endsWith(`/${theme}/${name}.svg`)); assert.ok(existsSync(icons[theme].fsPath)); }
  }
  const warnings = await tree.getChildren(roots[2]); assert.match(String(warnings[0].label), /unavailable.*offline/);
  let changes = 0; tree.onDidChangeTreeData(() => changes++); tree.refresh(); assert.equal(changes, 1);
  f.state.set('authority', 'ssh+elsewhere');
  const disconnected = await tree.getChildren(roots[0]); assert.equal((disconnected[0].iconPath as vscode.ThemeIcon).id, 'vm-running');
  assert.equal((await tree.getChildren(disconnected[0]))[0].iconPath && ((await tree.getChildren(disconnected[0]))[0].iconPath as any).light.fsPath.endsWith('/folder.svg'), true);
}));

test('X2 X3 X8: command delegation without bootstrap; new-window URI; canceled destructive actions', t => withFixture(t, async f => {
  const ctx = context(f); const history = new FolderHistory(ctx); const tree = new InstancesTree(history, 'assets');
  registerCommands(ctx, tree, history); const callbacks = f.state.get('commands') as Map<string, (node: any) => Promise<void>>;
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  for (const entry of manifest.contributes.menus.commandPalette) assert.equal(entry.when, 'false');
  const inline = manifest.contributes.menus['view/item/context'].filter((m: any) => m.group.startsWith('inline'));
  assert.ok(inline.every((m: any) => !/startInstance|stopInstance/.test(m.command)));
  assert.deepEqual(inline.filter((m: any) => m.when.endsWith('instance-folder')).map((m: any) => m.command), ['remote-incus.connectToFolder', 'remote-incus.connectToFolderInNewWindow', 'remote-incus.removeFolderFromHistory']);
  for (const newWindow of [false, true]) {
    f.expect('vscode.execute', (id, options) => { assert.equal(id, 'vscode.newWindow'); assert.deepEqual(options, { remoteAuthority: authority, reuseWindow: !newWindow }); });
    await callbacks.get(`remote-incus.connectToInstance${newWindow ? 'InNewWindow' : ''}`)!(node());
  }
  const folder = '/space # ?/ä'; history.record(authority, folder);
  f.expect('vscode.execute', (id, uri, newWindow) => {
    assert.equal(id, 'vscode.openFolder'); assert.equal(uri.authority, authority); assert.equal(uri.path, folder); assert.equal(newWindow, true);
    assert.match(uri.toString(), /%23/); assert.match(uri.toString(), /%3F/);
  });
  await callbacks.get('remote-incus.connectToInstanceInNewWindow')!(node());
  for (const id of ['uninstallServer', 'resetToken']) { f.expect('vscode.warning', () => undefined); await callbacks.get(`remote-incus.${id}`)!(node()); }
  await callbacks.get('remote-incus.removeFolderFromHistory')!(new FolderNode(node(), folder, new vscode.ThemeIcon('folder')));
  assert.deepEqual(history.folders(authority), []);
  // No process expectations: any pre-bootstrap, identity or daemon call fails.
}));

test('X7: progress increments monotonic, show-log affordance and first-line cause', t => withFixture(t, async f => {
  const reports = progress(f);
  const value = await withProgressReport('Connecting', async report => { report('20% transfer', 20); report('10% transfer', 10); report('80% transfer', 80); report('ready', 100); return 42; });
  assert.equal(value, 42); assert.deepEqual(reports.map(r => r.increment), [20, 0, 60, 20]);
  assert.match(f.state.get('progressOptions').title, /command:remote-incus.showLog/);
  assert.equal(firstLine(new Error('daemon refused\nfull detail')), 'daemon refused');
}));


test('X8: registered lifecycle, kill, uninstall and rescue commands use clicked target', t => withFixture(t, async f => {
  const { passwd } = await import('./support/scenario');
  const ctx = context(f); const tree = new InstancesTree(new FolderHistory(ctx), 'assets');
  registerCommands(ctx, tree, new FolderHistory(ctx)); progress(f);
  const callbacks = f.state.get('commands') as Map<string, (node: any) => Promise<void>>;
  const argsSeen: string[][] = [];
  f.routes.set('child_process.execFile', (_cmd, args: string[], _opts, cb) => {
    assert.equal(args[1], 'clicked:same'); argsSeen.push(args);
    cb(null, args.at(-1)!.startsWith('getent') ? passwd : '', '');
  });
  for (const action of ['start', 'stop', 'restart']) {
    await callbacks.get(`remote-incus.${action}Instance`)!(node('clicked'));
    assert.ok(argsSeen.some(args => args[0] === action));
  }
  await callbacks.get('remote-incus.killServer')!(node('clicked'));
  assert.ok(argsSeen.some(args => args.at(-1)!.startsWith('pkill')));
  f.expect('vscode.warning', () => 'Uninstall');
  await callbacks.get('remote-incus.uninstallServer')!(node('clicked'));
  assert.ok(argsSeen.some(args => args.at(-1)!.includes("rm -rf '/home/alice/.vscode-server'")));
  assert.ok(!argsSeen.some(args => args[0] === 'delete'));
  f.expect('vscode.terminal', (options) => {
    assert.equal(options.name, 'same (incus exec)');
    assert.equal(typeof options.pty.open, 'function');
    return { show() { f.state.set('terminal-shown', true); } };
  });
  await callbacks.get('remote-incus.openTerminal')!(node('clicked'));
  assert.equal(f.state.get('terminal-shown'), true);
}));
