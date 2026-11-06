import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { parse } from 'jsonc-parser';
import { enableProposedApi } from '../src/runtimeArguments';
import { registerOnboarding } from '../src/onboarding';
import { activate } from '../src/extension';
import { withFixture } from './support/fixture';
import { context } from './support/scenario';

const id = 'dodbrian.remote-incus';
test('runtime edit preserves comments, settings and other IDs; repeat is a no-op', () => {
  const original =
    '{\r\n  // keep me\r\n  "other": true,\r\n  "enable-proposed-api": ["other.extension", /* keep too */],\r\n}\r\n';
  const updated = enableProposedApi(original, id);
  assert.deepEqual(parse(updated), { other: true, 'enable-proposed-api': ['other.extension', id] });
  assert.ok(updated.includes('// keep me'));
  assert.ok(updated.includes('/* keep too */'));
  assert.ok(!updated.replaceAll('\r\n', '').includes('\n'));
  assert.equal(enableProposedApi(updated, id), updated);
  assert.equal(enableProposedApi(updated, id.toUpperCase()), updated);
});
test('runtime edit handles missing and empty arrays without enabling all extensions', () => {
  for (const original of ['{}', '{ /* keep */ }', '{"enable-proposed-api": []}']) {
    assert.deepEqual(parse(enableProposedApi(original, id))['enable-proposed-api'], [id]);
  }
});
test('runtime edit refuses malformed and ambiguous configuration', () => {
  for (const original of [
    '',
    '[]',
    '{broken}',
    '{"enable-proposed-api": true}',
    '{"enable-proposed-api": [1]}',
    '{"enable-proposed-api": [], "enable-proposed-api": []}',
  ]) {
    assert.throws(() => enableProposedApi(original, id));
  }
});

test('denied resolver access leaves setup operational even when proposed exports exist', (t) =>
  withFixture(t, async (f) => {
    f.routes.set('vscode.output', () => ({ appendLine() {}, dispose() {} }));
    f.routes.set('vscode.registerResolver', () => {
      throw new Error('CANNOT use API proposal: resolvers');
    });
    f.routes.set('vscode.execute', () => undefined);
    f.routes.set('vscode.registerTree', (view, provider) => {
      assert.equal(view, 'remote-incus.setup');
      assert.deepEqual(provider.getChildren(), []);
      return { dispose() {} };
    });
    activate(context(f));
    const commands = f.state.get('commands');
    assert.ok(commands.has('remote-incus.openSetup'));
    assert.ok(commands.has('remote-incus.enableSupport'));
    await commands.get('remote-incus.showInstances')();
    assert.ok(f.calls.some((call) => call.args[0] === 'workbench.action.openWalkthrough'));
  }));

for (const product of ['Visual Studio Code', 'VSCodium']) {
  for (const outcome of [
    'confirm',
    'cancel',
    'dirty',
    'changed',
    'wrong-file',
    'save-fails',
    'already-configured',
  ]) {
    test(`${product}: setup ${outcome}`, (t) =>
      withFixture(t, async (f) => {
        const ctx = context(f);
        f.state.set('appName', product);
        let content =
          outcome === 'already-configured' ? '{"enable-proposed-api":["offline"]}' : '{}';
        let saves = 0;
        let edits = 0;
        const document = {
          uri: vscode.Uri.file(
            `/editor/${product}/${outcome === 'wrong-file' ? 'settings.json' : 'argv.json'}`,
          ),
          isDirty: outcome === 'dirty',
          isClosed: false,
          getText: () => content,
          positionAt: (offset: number) => ({ line: 0, character: offset }),
          save: () => {
            saves++;
            return outcome !== 'save-fails';
          },
        };
        f.state.set('activeEditor', { document });
        f.routes.set('vscode.execute', () => undefined);
        f.routes.set('vscode.registerTree', () => ({ dispose() {} }));
        f.routes.set('vscode.warning', () => {
          if (outcome === 'changed') content = '{"new":true}';
          return outcome === 'cancel' ? undefined : 'Enable Support';
        });
        f.routes.set('vscode.applyEdit', () => {
          edits++;
          return true;
        });
        f.routes.set('vscode.info', () => undefined);
        f.routes.set('vscode.error', () => undefined);
        registerOnboarding(ctx, false);
        await f.state.get('commands').get('remote-incus.enableSupport')();
        const shouldEdit = outcome === 'confirm' || outcome === 'save-fails';
        assert.equal(edits, shouldEdit ? 1 : 0);
        assert.equal(saves, shouldEdit ? 1 : 0);
        assert.equal(
          f.calls.some((c) => c.name === 'vscode.error'),
          ['dirty', 'changed', 'wrong-file', 'save-fails'].includes(outcome),
        );
        assert.equal(
          f.calls.some(
            (c) => c.args[0] === 'setContext' && c.args[1] === 'remote-incus.supportConfigured',
          ),
          outcome === 'confirm' || outcome === 'already-configured',
        );
        assert.ok(f.calls.some((c) => c.args[0] === 'workbench.action.configureRuntimeArguments'));
      }));
  }
}

test('setup stays available without repeatedly opening the walkthrough', (t) =>
  withFixture(t, async (f) => {
    const ctx = context(f);
    f.routes.set('vscode.execute', () => undefined);
    f.routes.set('vscode.registerTree', () => ({ dispose() {} }));
    await ctx.globalState.update('setup.offered', true);
    registerOnboarding(ctx, false);
    assert.ok(!f.calls.some((c) => c.args[0] === 'workbench.action.openWalkthrough'));
    await f.state.get('commands').get('remote-incus.openSetup')();
    assert.ok(f.calls.some((c) => c.args[0] === 'workbench.action.openWalkthrough'));
  }));

test('setup respects disabled install walkthroughs', (t) =>
  withFixture(t, (f) => {
    f.configuration.set('workbench.welcomePage.walkthroughs.openOnInstall', false);
    f.routes.set('vscode.execute', () => undefined);
    f.routes.set('vscode.registerTree', () => ({ dispose() {} }));
    registerOnboarding(context(f), false);
    assert.ok(!f.calls.some((c) => c.args[0] === 'workbench.action.openWalkthrough'));
    assert.ok(f.state.get('commands').has('remote-incus.openSetup'));
  }));

test('ready editor hides setup and does not edit configuration', (t) =>
  withFixture(t, async (f) => {
    f.routes.set('vscode.execute', () => undefined);
    f.routes.set('vscode.info', () => undefined);
    registerOnboarding(context(f), true);
    await f.state.get('commands').get('remote-incus.enableSupport')();
    assert.ok(
      f.calls.some((c) => c.args[1] === 'remote-incus.setupRequired' && c.args[2] === false),
    );
    assert.ok(!f.calls.some((c) => c.args[0] === 'workbench.action.configureRuntimeArguments'));
  }));
