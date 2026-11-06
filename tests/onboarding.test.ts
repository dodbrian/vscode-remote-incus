import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
test('runtime edit handles missing and empty arrays', () => {
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
    await activate(context(f));
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
    'dirty-during-confirmation',
    'closed-during-confirmation',
    'wrong-file',
    'apply-fails',
    'save-fails',
    'already-configured',
    'double-click',
    'walkthrough-fails',
  ]) {
    test(`${product}: setup ${outcome}`, (t) =>
      withFixture(t, async (f) => {
        const ctx = context(f);
        f.state.set('appName', product);
        const original =
          outcome === 'already-configured'
            ? '{"other":true,"enable-proposed-api":["other.extension","offline"]}'
            : '{"other":true,/* keep */"enable-proposed-api":["other.extension"]}';
        let content = original;
        let saved: string | undefined;
        let saves = 0;
        let edits = 0;
        let confirmations = 0;
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
            if (outcome === 'save-fails') return false;
            saved = content;
            document.isDirty = false;
            return true;
          },
        };
        f.state.set('activeEditor', { document });
        f.routes.set('vscode.execute', (command) => {
          if (outcome === 'walkthrough-fails' && command === 'workbench.action.openWalkthrough') {
            return Promise.reject(new Error('Walkthrough unavailable'));
          }
          return Promise.resolve();
        });
        f.routes.set('vscode.registerTree', () => ({ dispose() {} }));
        f.routes.set('vscode.warning', (message, options) => {
          confirmations++;
          assert.ok(message.includes(product));
          assert.equal(options.modal, true);
          if (outcome === 'changed') content = '{"new":true}';
          if (outcome === 'dirty-during-confirmation') document.isDirty = true;
          if (outcome === 'closed-during-confirmation') document.isClosed = true;
          return outcome === 'cancel' ? undefined : 'Enable Support';
        });
        f.routes.set('vscode.applyEdit', (edit) => {
          edits++;
          assert.equal(edit.edits.length, 1);
          const [uri, range, replacement] = edit.edits[0];
          assert.equal(uri.toString(), document.uri.toString());
          assert.equal(range.start.character, 0);
          assert.equal(range.end.character, original.length);
          if (outcome === 'apply-fails') return false;
          content = replacement;
          document.isDirty = true;
          return true;
        });
        f.routes.set('vscode.info', () => undefined);
        f.routes.set('vscode.error', () => undefined);
        await registerOnboarding(ctx, false);
        const enable = f.state.get('commands').get('remote-incus.enableSupport');
        if (outcome === 'double-click') await Promise.all([enable(), enable()]);
        else await enable();
        const shouldEdit = [
          'confirm',
          'double-click',
          'walkthrough-fails',
          'apply-fails',
          'save-fails',
        ].includes(outcome);
        const successful = [
          'confirm',
          'double-click',
          'walkthrough-fails',
          'already-configured',
        ].includes(outcome);
        assert.equal(edits, shouldEdit ? 1 : 0);
        assert.equal(saves, shouldEdit && outcome !== 'apply-fails' ? 1 : 0);
        if (saved) {
          assert.deepEqual(parse(saved), {
            other: true,
            'enable-proposed-api': ['other.extension', 'offline'],
          });
          assert.ok(saved.includes('/* keep */'));
        }
        if (outcome === 'cancel' || outcome === 'apply-fails') assert.equal(content, original);
        if (outcome === 'save-fails') assert.equal(document.isDirty, true);
        assert.equal(
          f.calls.some((c) => c.name === 'vscode.error'),
          [
            'dirty',
            'changed',
            'dirty-during-confirmation',
            'closed-during-confirmation',
            'wrong-file',
            'apply-fails',
            'save-fails',
          ].includes(outcome),
        );
        assert.equal(
          f.calls.some((c) => c.name === 'vscode.info'),
          successful,
        );
        assert.equal(ctx.globalState.get('setup.resumeAfterRestart') === true, successful);
        const focused = f.calls
          .filter((c) => c.args[0] === 'workbench.action.openWalkthrough')
          .at(-1);
        assert.equal(focused?.args[1].step, successful ? 'restart' : 'enable');
        assert.equal(
          f.calls.filter((c) => c.args[0] === 'workbench.action.configureRuntimeArguments').length,
          1,
        );
        if (outcome === 'double-click') assert.equal(confirmations, 1);
      }));
  }
}

test('setup stays available without repeatedly opening the walkthrough', (t) =>
  withFixture(t, async (f) => {
    const ctx = context(f);
    f.routes.set('vscode.execute', () => undefined);
    f.routes.set('vscode.registerTree', () => ({ dispose() {} }));
    await ctx.globalState.update('setup.offered', true);
    await registerOnboarding(ctx, false);
    assert.ok(!f.calls.some((c) => c.args[0] === 'workbench.action.openWalkthrough'));
    await f.state.get('commands').get('remote-incus.openSetup')();
    assert.ok(f.calls.some((c) => c.args[0] === 'workbench.action.openWalkthrough'));
  }));

test('setup respects disabled install walkthroughs', (t) =>
  withFixture(t, async (f) => {
    f.configuration.set('workbench.welcomePage.walkthroughs.openOnInstall', false);
    f.routes.set('vscode.execute', () => undefined);
    f.routes.set('vscode.registerTree', () => ({ dispose() {} }));
    await registerOnboarding(context(f), false);
    assert.ok(!f.calls.some((c) => c.args[0] === 'workbench.action.openWalkthrough'));
    assert.ok(f.state.get('commands').has('remote-incus.openSetup'));
  }));

test('ready editor hides setup and does not edit configuration', (t) =>
  withFixture(t, async (f) => {
    f.routes.set('vscode.execute', () => undefined);
    f.routes.set('vscode.info', () => undefined);
    await registerOnboarding(context(f), true);
    await f.state.get('commands').get('remote-incus.enableSupport')();
    assert.ok(
      f.calls.some((c) => c.args[1] === 'remote-incus.setupRequired' && c.args[2] === false),
    );
    assert.ok(!f.calls.some((c) => c.args[0] === 'workbench.action.configureRuntimeArguments'));
  }));

for (const product of ['Visual Studio Code', 'VSCodium']) {
  test(`${product}: walkthrough uses only the current editor and selects the pending step`, (t) =>
    withFixture(t, async (f) => {
      f.state.set('appName', product);
      const ctx = context(f);
      f.routes.set('vscode.execute', () => undefined);
      f.routes.set('vscode.registerTree', () => ({ dispose() {} }));
      await registerOnboarding(ctx, false);
      await f.state.get('commands').get('remote-incus.openSetup')();
      const opened = f.calls.filter((c) => c.args[0] === 'workbench.action.openWalkthrough').at(-1);
      const key = product === 'VSCodium' ? 'vscodium' : 'vscode';
      const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
      const walkthrough = manifest.contributes.walkthroughs.find(
        (item: any) => item.when === `remote-incus.editor == ${key}`,
      );
      assert.ok(walkthrough);
      const copy = JSON.stringify(walkthrough);
      assert.ok(copy.includes(product === 'VSCodium' ? 'VSCodium' : 'VS Code'));
      assert.ok(!copy.includes(product === 'VSCodium' ? 'VS Code' : 'VSCodium'));
      assert.equal(walkthrough.id, product === 'VSCodium' ? 'setup-vscodium' : 'setup');
      assert.ok(
        f.calls.some(
          (c) =>
            c.args[0] === 'setContext' && c.args[1] === 'remote-incus.editor' && c.args[2] === key,
        ),
      );
      assert.deepEqual(opened?.args[1], {
        category: product === 'VSCodium' ? 'offline#setup-vscodium' : 'offline#setup',
        step: 'enable',
      });
    }));
}

test('saved configuration resumes at restart even before APIs are granted', (t) =>
  withFixture(t, async (f) => {
    const ctx = context(f);
    await ctx.globalState.update('setup.resumeAfterRestart', true);
    await ctx.globalState.update('setup.offered', true);
    f.routes.set('vscode.execute', () => undefined);
    f.routes.set('vscode.registerTree', () => ({ dispose() {} }));
    await registerOnboarding(ctx, false);
    await f.state.get('commands').get('remote-incus.openSetup')();
    assert.deepEqual(
      f.calls.find((c) => c.args[0] === 'workbench.action.openWalkthrough')?.args[1],
      { category: 'offline#setup', step: 'restart' },
    );
    assert.equal(ctx.globalState.get('setup.resumeAfterRestart'), true);
  }));

test('successful restart advances to connect once, after ready context is applied', (t) =>
  withFixture(t, async (f) => {
    const ctx = context(f);
    await ctx.globalState.update('setup.resumeAfterRestart', true);
    const contexts = new Map();
    f.routes.set('vscode.execute', async (command, key, value) => {
      await Promise.resolve();
      if (command === 'setContext') contexts.set(key, value);
      if (command === 'workbench.action.openWalkthrough') {
        assert.equal(contexts.get('remote-incus.supportReady'), true);
        assert.deepEqual(key, { category: 'offline#setup', step: 'connect' });
      }
    });
    await registerOnboarding(ctx, true);
    assert.equal(f.calls.filter((c) => c.args[0] === 'workbench.action.openWalkthrough').length, 1);
    assert.equal(ctx.globalState.get('setup.resumeAfterRestart'), false);
    f.state.get('commands').clear();
    await registerOnboarding(ctx, true);
    assert.equal(f.calls.filter((c) => c.args[0] === 'workbench.action.openWalkthrough').length, 1);
  }));

test('restart resume respects disabled walkthrough opening', (t) =>
  withFixture(t, async (f) => {
    const ctx = context(f);
    await ctx.globalState.update('setup.resumeAfterRestart', true);
    f.configuration.set('workbench.welcomePage.walkthroughs.openOnInstall', false);
    f.routes.set('vscode.execute', () => undefined);
    await registerOnboarding(ctx, true);
    assert.ok(!f.calls.some((c) => c.args[0] === 'workbench.action.openWalkthrough'));
  }));

test('runtime edit preserves comments inside an empty proposed API array', () => {
  const original = '{"enable-proposed-api": [ /* leave this explanation */ ]}';
  const updated = enableProposedApi(original, id);
  assert.deepEqual(parse(updated)['enable-proposed-api'], [id]);
  assert.ok(updated.includes('/* leave this explanation */'));
});

for (const ready of [false, true]) {
  test(`walkthrough failure does not block activation (support ready: ${String(ready)})`, (t) =>
    withFixture(t, async (f) => {
      const ctx = context(f);
      if (ready) await ctx.globalState.update('setup.resumeAfterRestart', true);
      f.routes.set('vscode.output', () => ({ appendLine() {}, dispose() {} }));
      f.routes.set('vscode.registerResolver', () => {
        if (!ready) throw new Error('CANNOT use API proposal: resolvers');
        return { dispose() {} };
      });
      f.routes.set('vscode.registerTree', () => ({ dispose() {} }));
      let fail = true;
      f.routes.set('vscode.execute', (command) => {
        if (fail && command === 'workbench.action.openWalkthrough')
          return Promise.reject(new Error('Walkthrough UI unavailable'));
        return Promise.resolve();
      });
      await activate(ctx);
      assert.ok(f.state.get('commands').has('remote-incus.openSetup'));
      assert.ok(f.state.get('commands').has('remote-incus.showInstances'));
      if (ready) {
        assert.ok(
          f.calls.some(
            (c) => c.name === 'vscode.registerTree' && c.args[0] === 'remote-incus.instances',
          ),
        );
        assert.equal(ctx.globalState.get('setup.resumeAfterRestart'), true);
      } else assert.notEqual(ctx.globalState.get('setup.offered'), true);
      // A later startup can retry the one-time resume instead of losing it.
      fail = false;
      f.state.get('commands').clear();
      await registerOnboarding(ctx, ready);
      assert.equal(
        ctx.globalState.get(ready ? 'setup.resumeAfterRestart' : 'setup.offered'),
        !ready,
      );
    }));
}

test('unrelated resolver errors are not misreported as missing API permission', (t) =>
  withFixture(t, async (f) => {
    f.routes.set('vscode.output', () => ({ appendLine() {}, dispose() {} }));
    const failure = new Error('Internal proposed API registration failure');
    f.routes.set('vscode.registerResolver', () => {
      throw failure;
    });
    await assert.rejects(activate(context(f)), (error) => error === failure);
  }));
