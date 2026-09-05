import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
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
        if (method === 'Page.getFrameTree') return frameTree('first');
        if (method === 'Runtime.evaluate') return { result: { value: { x: 20, y: 30, focused: true } } };
        return {};
      },
    },
  });
  await executor.execute('type', { tabId: 5, selector: '#name', text: 'Ada' });
  assert.ok(calls.some(([method]) => method === 'Runtime.evaluate'));
  assert.deepEqual(calls.at(-1), ['Input.insertText', { text: 'Ada' }]);
});

test('typing focuses and selects the requested input before inserting text', async () => {
  const scope = new ScopeGrant();
  scope.grantTab(tab(5));
  let focused;
  let selected = false;
  class Input {
    type = 'text';
    matches() { return false; }
    getBoundingClientRect() { return { width: 30, height: 20, left: 0, top: 0 }; }
    scrollIntoView() {}
    focus() { focused = this; }
    select() { selected = true; }
  }
  const target = new Input();
  const executor = new ActionExecutor({
    scope, tabs: { get: async () => tab(5) },
    debuggerApi: {
      attach: async () => {},
      sendCommand: async (_target, method, params) => {
        if (method === 'Page.getFrameTree') return frameTree('first');
        if (method === 'Runtime.evaluate') return { result: { value: vm.runInNewContext(params.expression, {
          document: { querySelectorAll: () => [target], get activeElement() { return focused; } },
          getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
          HTMLInputElement: Input,
          HTMLTextAreaElement: class {},
        }) } };
        if (method === 'Input.insertText') {
          assert.equal(focused, target, 'text must go to the requested element');
          assert.equal(selected, true, 'existing text must be replaced');
        }
        return {};
      },
    },
  });
  await executor.execute('type', { tabId: 5, selector: '#name', text: 'Ada' });
});

test('snapshot distinguishes direct sibling controls inside an open shadow root', async () => {
  class ShadowRoot {}
  const root = new ShadowRoot();
  const document = { title: 'Shadow', body: { innerText: '' }, querySelectorAll: selector => selector === '*' ? [host] : [] };
  const host = { id: 'host', getRootNode: () => document, shadowRoot: root };
  root.host = host;
  const button = () => ({ nodeType: 1, localName: 'button', innerText: 'Go', parentElement: null, parentNode: root,
    getRootNode: () => root, getBoundingClientRect: () => ({ width: 20, height: 20 }) });
  root.children = [button(), button()];
  root.querySelectorAll = () => root.children;
  const scope = new ScopeGrant();
  scope.grantTab(tab(1));
  const executor = new ActionExecutor({ scope, tabs: { get: async () => tab(1) }, debuggerApi: {
    attach: async () => {},
    sendCommand: async (_target, _method, params) => ({ result: { value: vm.runInNewContext(params.expression, {
      document, ShadowRoot, CSS: { escape: value => value }, location: { href: 'https://example.test/' },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    }) } }),
  } });
  const snapshot = await executor.execute('snapshot', { tabId: 1 });
  assert.equal(new Set(snapshot.elements.map(element => element.selector)).size, 2);
});

const frameTree = loaderId => ({ frameTree: { frame: { id: 'main', loaderId } } });

for (const method of ['click', 'type']) for (const reload of [false, true]) {
  test(`${method} rejects a document swap during selector resolution (${reload ? 'same URL reload' : 'navigation'})`, async () => {
    const scope = new ScopeGrant(); scope.grantTab(tab(1));
    let loader = 'first', url = 'https://example.test/', effects = 0;
    const executor = new ActionExecutor({ scope, tabs: { get: async () => tab(1, url) }, debuggerApi: {
      attach: async () => {},
      sendCommand: async (_target, command) => {
        if (command === 'Page.getFrameTree') return frameTree(loader);
        if (command === 'Runtime.evaluate') { loader = 'second'; if (!reload) url += 'next'; return { result: { value: { x: 1, y: 1 } } }; }
        if (command.startsWith('Input.')) effects++;
        return {};
      },
    } });
    await assert.rejects(executor.execute(method, { tabId: 1, selector: '#target', ...(method === 'type' ? { text: 'secret' } : {}) }), /document.*changed/i);
    assert.equal(effects, 0);
    assert.equal(scope.status().mode, 'tab');
  });
}

test('external debugger cancellation revokes and cancels queued commands without reattaching', async () => {
  const scope = new ScopeGrant(); scope.grantBrowser();
  let attachments = 0, effects = 0, release, enter;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { enter = resolve; });
  const executor = new ActionExecutor({ scope, tabs: { get: async () => tab(1), query: async () => { enter(); await gate; return []; }, create: async () => { effects++; } }, debuggerApi: {
    attach: async () => { attachments++; }, detach: async () => {}, sendCommand: async () => ({ data: 'png' }),
  } });
  await executor.execute('screenshot', { tabId: 1 });
  const running = executor.execute('tabs', {}); await entered;
  const queued = executor.execute('open', { url: 'https://example.test/' });
  executor.markDetached(1, 'canceled_by_user'); release();
  await assert.rejects(running, /revoked/); await assert.rejects(queued, /revoked/);
  await assert.rejects(executor.execute('screenshot', { tabId: 1 }), /revoked/);
  assert.equal(scope.status().mode, 'off'); assert.equal(attachments, 1); assert.equal(effects, 0);
});

test('extension detach during replacement does not revoke the replacement grant', async () => {
  const scope = new ScopeGrant(); scope.grantBrowser();
  let release;
  const executor = new ActionExecutor({ scope, tabs: { get: async () => tab(1) }, debuggerApi: {
    attach: async () => {}, sendCommand: async () => ({ data: 'png' }),
    detach: async () => { await new Promise(resolve => { release = resolve; }); executor.markDetached(1, 'canceled_by_user'); },
  } });
  await executor.execute('screenshot', { tabId: 1 }); scope.grantTab(tab(1)); release();
  await executor.execute('screenshot', { tabId: 1 });
  assert.deepEqual(scope.status(), { mode: 'tab', tabId: 1 });
});

function typingFixture({ kind = 'input', type = 'text', disabled = false, readOnly = false, redirect = false, loseFocus = false, shadow = false, contentEditable = false } = {}) {
  const scope = new ScopeGrant(); scope.grantTab(tab(1));
  const document = { activeElement: null, querySelectorAll: () => [shadow ? host : target] };
  class Element {
    getBoundingClientRect() { return { width: 30, height: 20, left: 0, top: 0 }; }
    scrollIntoView() {} select() {}
    focus() { document.activeElement = redirect ? other : shadow ? host : this; if (shadow) root.activeElement = this; }
    matches(selector) { return selector === ':disabled' && this.disabled; }
  }
  class Input extends Element {} class TextArea extends Element {}
  const target = new (kind === 'input' ? Input : kind === 'textarea' ? TextArea : Element)();
  Object.assign(target, { type, disabled, readOnly, isContentEditable: kind === 'contenteditable' || contentEditable });
  const other = new Input();
  const root = { activeElement: null, querySelectorAll: () => [target] }, host = { shadowRoot: root };
  let effects = 0, evaluations = 0;
  const context = vm.createContext({ document, HTMLInputElement: Input, HTMLTextAreaElement: TextArea,
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
  });
  document.createRange = () => ({ selectNodeContents() {} });
  const executor = new ActionExecutor({ scope, tabs: { get: async () => tab(1) }, debuggerApi: {
    attach: async () => {}, sendCommand: async (_target, method, params) => {
      if (method === 'Page.getFrameTree') return frameTree('first');
      if (method === 'Runtime.evaluate') {
        const value = vm.runInContext(params.expression, context);
        if (++evaluations === 1 && loseFocus) document.activeElement = other;
        return { result: { value } };
      }
      if (method === 'Input.insertText') { effects++; assert.equal(shadow ? root.activeElement : document.activeElement, target); }
      return {};
    },
  } });
  return { run: () => executor.execute('type', { tabId: 1, selector: shadow ? '#host >>> input' : '#target', text: 'secret' }), effects: () => effects };
}
for (const options of [{ kind: 'div' }, { disabled: true }, { readOnly: true }, { type: 'checkbox' }, { type: 'checkbox', contentEditable: true }, { type: 'number' }, { redirect: true }, { loseFocus: true }]) {
  test(`type refuses unsafe editable/focus target ${JSON.stringify(options)}`, async () => {
    const fixture = typingFixture(options); await assert.rejects(fixture.run(), /editable|focus/i); assert.equal(fixture.effects(), 0);
  });
}
for (const options of [{}, { kind: 'textarea' }, { kind: 'contenteditable' }, { shadow: true }]) {
  test(`type supports editable target ${JSON.stringify(options)}`, async () => {
    const fixture = typingFixture(options); await fixture.run(); assert.equal(fixture.effects(), 1);
  });
}

test('a failed debugger attachment does not detach a session it did not establish', async () => {
  const scope = new ScopeGrant(); scope.grantTab(tab(1));
  let detaches = 0;
  const executor = new ActionExecutor({ scope, tabs: { get: async () => tab(1) }, debuggerApi: {
    attach: async () => { throw new Error('Already attached by another debugger'); },
    detach: async () => { detaches++; },
  } });
  await assert.rejects(executor.execute('screenshot', { tabId: 1 }), /another debugger/);
  assert.equal(detaches, 0); assert.equal(executor.attached.size, 0);
});

test('user cancellation during pending attachment cannot restore membership or execute input', async () => {
  const scope = new ScopeGrant(); scope.grantTab(tab(1));
  let release, enter, effects = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { enter = resolve; });
  const executor = new ActionExecutor({ scope, tabs: { get: async () => tab(1) }, debuggerApi: {
    attach: async () => { enter(); await gate; }, detach: async () => {}, sendCommand: async () => { effects++; },
  } });
  const pending = executor.execute('press', { tabId: 1, key: 'Enter' }); await entered;
  executor.markDetached(1, 'canceled_by_user'); release();
  await assert.rejects(pending, /revoked/);
  assert.equal(scope.status().mode, 'off'); assert.equal(executor.attached.size, 0); assert.equal(effects, 0);
});

test('closing an attached target clears attachment without revoking browser control', async () => {
  const scope = new ScopeGrant(); scope.grantBrowser();
  const executor = new ActionExecutor({ scope, tabs: { get: async () => tab(1) }, debuggerApi: {
    attach: async () => {}, sendCommand: async () => ({ data: 'png' }),
  } });
  await executor.execute('screenshot', { tabId: 1 }); executor.markDetached(1, 'target_closed');
  assert.equal(executor.attached.size, 0); assert.equal(scope.status().mode, 'browser');
});
