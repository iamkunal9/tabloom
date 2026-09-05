import test from 'node:test';
import assert from 'node:assert/strict';
import { ScopeGrant } from '../extension/scope.js';

const normal = (id, url = 'https://example.test/') => ({ id, url, incognito: false });

test('tab scope preserves the approved tab and denies other tabs after selection changes', () => {
  const scope = new ScopeGrant();
  scope.grantTab(normal(7));
  assert.equal(scope.allows(normal(7)), true);
  assert.equal(scope.allows(normal(8)), false);
  assert.equal(scope.status().tabId, 7);
});

test('all scopes reject internal pages and incognito tabs', () => {
  const scope = new ScopeGrant();
  scope.grantBrowser();
  assert.equal(scope.allows(normal(1, 'chrome://settings/')), false);
  assert.equal(scope.allows(normal(2, 'file:///tmp/private')), false);
  assert.equal(scope.allows({ ...normal(3), incognito: true }), false);
});

test('browser scope permits existing and future normal web tabs', () => {
  const scope = new ScopeGrant();
  scope.grantBrowser();
  assert.equal(scope.allows(normal(1)), true);
  assert.equal(scope.allows(normal(999, 'http://localhost:3000/')), true);
  assert.equal(scope.canManageTabs(), true);
});

test('revocation invalidates captured generation immediately', () => {
  const scope = new ScopeGrant();
  scope.grantTab(normal(4));
  const generation = scope.generation;
  scope.revoke();
  assert.equal(scope.isCurrent(generation), false);
  assert.deepEqual(scope.status(), { mode: 'off' });
});

test('disconnect revokes access and reconnect does not restore it', () => {
  const scope = new ScopeGrant();
  scope.grantBrowser();
  scope.setConnected(true);
  scope.setConnected(false);
  scope.setConnected(true);
  assert.equal(scope.status().mode, 'off');
  assert.equal(scope.allows(normal(1)), false);
});

test('invalid grant targets are rejected', () => {
  const scope = new ScopeGrant();
  assert.throws(() => scope.grantTab(normal(3, 'chrome-extension://abc/popup.html')), /cannot be controlled/i);
  assert.throws(() => scope.grantTab({ ...normal(4), incognito: true }), /cannot be controlled/i);
});

test('an enable operation awaiting tab selection cannot undo Stop or disconnection', async () => {
  for (const interrupt of [scope => scope.revoke(), scope => { scope.setConnected(false); scope.setConnected(true); }]) {
    const scope = new ScopeGrant();
    scope.setConnected(true);
    let resolve;
    const selection = new Promise(done => { resolve = done; });
    const enabling = scope.grantSelectedTab(() => selection);
    interrupt(scope);
    resolve(normal(7));
    await assert.rejects(enabling, /cancelled|connect/i);
    assert.equal(scope.status().mode, 'off');
  }
});

test('an older tab selection cannot overwrite a newer browser grant', async () => {
  const scope = new ScopeGrant();
  scope.setConnected(true);
  let resolve;
  const selection = new Promise(done => { resolve = done; });
  const enabling = scope.grantSelectedTab(() => selection);
  scope.grantBrowser();
  resolve(normal(7));
  await assert.rejects(enabling, /cancelled/i);
  assert.equal(scope.status().mode, 'browser');
});
