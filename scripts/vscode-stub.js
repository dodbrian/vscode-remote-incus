// Minimal vscode stub so pure modules (authority, incusCli, bootstrap helpers)
// can be smoke-tested under plain node.
exports.workspace = {
  getConfiguration: () => ({ get: (_k, d) => d }),
};
exports.env = { appCommit: undefined, remoteAuthority: undefined, version: '0.0.0' };
exports.EventEmitter = class {
  event = () => ({ dispose: () => undefined });
  fire = () => undefined;
  dispose = () => undefined;
};
exports.window = {};
exports.commands = {};
exports.TreeItem = class {
  constructor() { /* noop */ }
};
exports.ThemeIcon = class {
  constructor(id) { this.id = id; }
};
exports.MarkdownString = class {
  constructor(v) { this.value = v; }
};
exports.TreeItemCollapsibleState = { None: 0, Collapsed: 1 };
exports.ProgressLocation = { Notification: 15 };
