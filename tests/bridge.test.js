import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import WebSocket from 'ws';
import { startServer } from '../src/server.js';

const token = '0123456789abcdef0123456789abcdef';
const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fixture(options = {}) {
  const bridge = await startServer({ port: 0, token, commandTimeoutMs: 80, heartbeatIntervalMs: 30, heartbeatDeadlineMs: 80, helloTimeoutMs: 50, ...options });
  const base = `http://127.0.0.1:${bridge.port}`;
  return { bridge, base };
}

async function connectExtension(port, suppliedToken = token, headers = { Origin: origin }) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/extension`, { headers });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'hello', token: suppliedToken }));
  const hello = await new Promise((resolve, reject) => { ws.once('message', data => resolve(JSON.parse(data))); ws.once('close', () => reject(new Error('closed'))); });
  return { ws, hello };
}

async function command(base, method, params = {}, extra = {}) {
  return fetch(`${base}/command`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extra }, body: JSON.stringify({ method, params }) });
}

test('health is nonsensitive and command authentication is required', async t => {
  const { bridge, base } = await fixture(); t.after(() => bridge.close());
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true });
  const response = await fetch(`${base}/command`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"method":"status","params":{}}' });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error.code, 'UNAUTHORIZED');
});

test('rejects browser origins, hostile hosts, malformed input, and invalid commands before dispatch', async t => {
  const { bridge, base } = await fixture(); t.after(() => bridge.close());
  assert.equal((await command(base, 'status', {}, { Origin: 'https://evil.example' })).status, 403);
  const hostileStatus = await new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port: bridge.port, path: '/command', method: 'POST', headers: { host: 'evil.example', authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end('{"method":"status","params":{}}');
  });
  assert.equal(hostileStatus, 403);
  assert.equal((await command(base, 'evaluate', {})).status, 400);
  assert.equal((await command(base, 'navigate', { tabId: 1, url: 'file:///etc/passwd' })).status, 400);
  const malformed = await fetch(`${base}/command`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
});

test('authenticates one extension and dispatches validated commands', async t => {
  const { bridge, base } = await fixture(); t.after(() => bridge.close());
  const { ws, hello } = await connectExtension(bridge.port); t.after(() => ws.close());
  assert.deepEqual(hello, { type: 'hello', ok: true });
  ws.on('message', raw => {
    const message = JSON.parse(raw);
    if (message.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    if (message.type === 'command') ws.send(JSON.stringify({ type: 'result', id: message.id, ok: true, result: { mode: 'tab' } }));
  });
  const response = await command(base, 'status');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, result: { mode: 'tab' } });
});

test('denies duplicate, unauthenticated, and stalled extension connections', async t => {
  const { bridge } = await fixture(); t.after(() => bridge.close());
  const first = await connectExtension(bridge.port); t.after(() => first.ws.close());
  const second = new WebSocket(`ws://127.0.0.1:${bridge.port}/extension`, { headers: { Origin: origin } });
  const secondCode = await new Promise(resolve => second.once('close', resolve));
  assert.equal(secondCode, 1008);
  const wrong = new WebSocket(`ws://127.0.0.1:${bridge.port}/extension`, { headers: { Origin: origin } });
  await new Promise(resolve => wrong.once('open', resolve)); wrong.send(JSON.stringify({ type: 'hello', token: 'wrong-token-wrong' }));
  assert.equal(await new Promise(resolve => wrong.once('close', resolve)), 1008);
  first.ws.close(); await new Promise(resolve => first.ws.once('close', resolve));
  const stalled = new WebSocket(`ws://127.0.0.1:${bridge.port}/extension`, { headers: { Origin: origin } });
  await new Promise(resolve => stalled.once('open', resolve));
  assert.equal(await new Promise(resolve => stalled.once('close', resolve)), 1008);
});

test('a command timeout closes the extension and fails queued work', async t => {
  const { bridge, base } = await fixture(); t.after(() => bridge.close());
  const { ws } = await connectExtension(bridge.port);
  ws.on('message', raw => { if (JSON.parse(raw).type === 'ping') ws.send(JSON.stringify({ type: 'pong' })); });
  const first = command(base, 'tabs');
  const queued = command(base, 'status');
  const [a, b, closeCode] = await Promise.all([first, queued, new Promise(resolve => ws.once('close', resolve))]);
  assert.equal(closeCode, 1006);
  assert.equal((await a.json()).ok, false);
  assert.equal((await b.json()).ok, false);
});

test('disconnect and missed heartbeat fail pending work', async t => {
  const { bridge, base } = await fixture(); t.after(() => bridge.close());
  const { ws } = await connectExtension(bridge.port);
  const pending = command(base, 'tabs');
  await delay(10); ws.close();
  assert.equal((await (await pending).json()).error.code, 'EXTENSION_DISCONNECTED');
});

test('a missed heartbeat terminates the socket and fails pending work', async t => {
  const { bridge, base } = await fixture({ commandTimeoutMs: 1000, heartbeatIntervalMs: 20, heartbeatDeadlineMs: 45 }); t.after(() => bridge.close());
  const { ws } = await connectExtension(bridge.port);
  const pending = command(base, 'tabs');
  assert.equal(await new Promise(resolve => ws.once('close', resolve)), 1006);
  assert.equal((await (await pending).json()).error.code, 'EXTENSION_DISCONNECTED');
});
