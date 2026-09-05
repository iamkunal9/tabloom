import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCommand, keyDefinition, ActionExecutor } from '../extension/actions.js';
import { ScopeGrant } from '../extension/scope.js';

const tab = (id, url = 'https://example.test/') => ({ id, url, title: 'Example', incognito: false });

test('rejects unsupported commands and unexpected or invalid arguments', () => {
  assert.throws(() => validateCommand('evaluate', { expression: 'alert(1)' }), /unsupported/i);
  assert.throws(() => validateCommand('click', { tabId: 1, selector: '' }), /selector/i);
  assert.throws(() => validateCommand('click', { tabId: 1, selector: '#ok', extra: true }), /unexpected/i);
  assert.throws(() => validateCommand('type', { tabId: 1, selector: '#q', text: 5 }), /text/i);
  assert.throws(() => validateCommand('scroll', { tabId: 1, x: Infinity }), /x/i);
  assert.throws(() => validateCommand('navigate', { tabId: 1, url: 'javascript:alert(1)' }), /HTTP/i);
  assert.throws(() => validateCommand('press', { tabId: 1, key: 'F12' }), /key/i);
  assert.throws(() => validateCommand('tabs', { tabId: 1 }), /unexpected/i);
});

test('rechecks tab eligibility after debugger attachment before CDP effects', async () => {
  const scope = new ScopeGrant();
  scope.grantTab(tab(5));
  let reads = 0;
  let effects = 0;
  let detached = 0;
  const executor = new ActionExecutor({
    scope,
    tabs: { get: async () => ++reads === 1 ? tab(5) : tab(5, 'chrome://settings/'), query: async () => [] },
    debuggerApi: { attach: async () => {}, detach: async () => { detached++; }, sendCommand: async () => { effects++; } },
  });
  await assert.rejects(executor.execute('click', { tabId: 5, selector: '#buy' }), /outside.*scope/i);
  assert.equal(effects, 0);
  assert.equal(detached, 1);
});

test('normalizes bounded action inputs without exposing arbitrary CDP', () => {
  assert.deepEqual(validateCommand('scroll', { tabId: 3 }), { tabId: 3, x: 0, y: 0 });
  assert.deepEqual(validateCommand('open', { url: 'https://example.test/a' }), { url: 'https://example.test/a' });
  assert.deepEqual(keyDefinition('Enter'), { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
});

test('denies tab actions outside the active grant before debugger attachment', async () => {
  const scope = new ScopeGrant();
  scope.grantTab(tab(1));
  let attached = false;
  const executor = new ActionExecutor({
    scope,
    tabs: { get: async id => tab(id), query: async () => [] },
    debuggerApi: { attach: async () => { attached = true; } },
  });
  await assert.rejects(executor.execute('click', { tabId: 2, selector: '#buy' }), /outside.*scope/i);
  assert.equal(attached, false);
});

test('revocation while queued cancels work before its first side effect', async () => {
  const scope = new ScopeGrant();
  scope.grantBrowser();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let enter;
  const entered = new Promise(resolve => { enter = resolve; });
  let effects = 0;
  const executor = new ActionExecutor({
    scope,
    tabs: { get: async id => tab(id), query: async () => { enter(); await gate; return []; }, create: async () => { effects++; } },
    debuggerApi: {},
  });
  const running = executor.execute('tabs', {});
  await entered;
  const pending = executor.execute('open', { url: 'https://example.test/' });
  scope.revoke();
  release();
  await assert.rejects(running, /revoked/i);
  await assert.rejects(pending, /revoked/i);
  assert.equal(effects, 0);
});

test('type resolves its selector and inserts text through bounded CDP commands', async () => {
  const scope = new ScopeGrant();
  scope.grantTab(tab(5));
  const calls = [];
  const executor = new ActionExecutor({
    scope,
    tabs: { get: async () => tab(5), query: async () => [] },
    debuggerApi: {
      attach: async () => {},
      detach: async () => {},
      sendCommand: async (_target, method, params) => {
        calls.push([method, params]);
        if (method === 'Runtime.evaluate') return { result: { value: { x: 20, y: 30 } } };
        return {};
      },
    },
  });
  await executor.execute('type', { tabId: 5, selector: '#name', text: 'Ada' });
  assert.equal(calls[0][0], 'Runtime.evaluate');
  assert.deepEqual(calls.at(-1), ['Input.insertText', { text: 'Ada' }]);
});
