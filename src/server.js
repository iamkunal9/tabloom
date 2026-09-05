import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { validateCommand } from './validation.js';

const MAX_PAYLOAD = 1_000_000;
const errorBody = (code, message) => ({ ok: false, error: { code, message } });
const safeToken = (actual, supplied) => {
  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(actual); const b = Buffer.from(supplied || '');
  return a.length === b.length && timingSafeEqual(a, b);
};

export async function startServer({ port = 17653, token, commandTimeoutMs = 30_000, helloTimeoutMs = 5_000, heartbeatIntervalMs = 20_000, heartbeatDeadlineMs = 45_000, maxPending = 100 } = {}) {
  if (typeof token !== 'string' || token.length < 16) throw new Error('A pairing token of at least 16 characters is required');
  let extension = null;
  let nextId = 1;
  let pendingCount = 0;
  const pending = new Map();

  function failPending(code, message) {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Object.assign(new Error(message), { code })); }
    pending.clear();
  }
  function drop(ws, code = 'EXTENSION_DISCONNECTED', message = 'Extension disconnected') {
    if (extension !== ws) return;
    extension = null;
    failPending(code, message);
  }
  function dispatch(method, params) {
    if (++pendingCount > maxPending) { pendingCount--; return Promise.reject(Object.assign(new Error('Too many pending commands'), { code: 'BUSY' })); }
    // The extension owns serialization and captures its grant at receipt.
    // Holding work here would allow it to cross a Stop/re-enable boundary.
    const run = new Promise((resolve, reject) => {
      const ws = extension;
      if (!ws || ws.readyState !== WebSocket.OPEN || !ws.authenticated) return reject(Object.assign(new Error('Extension is not connected'), { code: 'EXTENSION_DISCONNECTED' }));
      const id = String(nextId++);
      const timer = setTimeout(() => {
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        entry.reject(Object.assign(new Error('Command timed out; extension connection was closed'), { code: 'COMMAND_TIMEOUT' }));
        drop(ws, 'EXTENSION_DISCONNECTED', 'Extension disconnected after command timeout');
        ws.terminate();
      }, commandTimeoutMs);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ type: 'command', id, method, params }), error => {
        if (error) { clearTimeout(timer); pending.delete(id); reject(Object.assign(error, { code: 'EXTENSION_DISCONNECTED' })); ws.terminate(); }
      });
    });
    return run.finally(() => { pendingCount--; });
  }

  const server = http.createServer(async (request, response) => {
    const host = request.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) return send(response, 403, errorBody('FORBIDDEN', 'Host is not allowed'));
    if (request.url === '/health' && request.method === 'GET') return send(response, 200, { ok: true });
    if (request.url !== '/command' || request.method !== 'POST') return send(response, 404, errorBody('NOT_FOUND', 'Not found'));
    if (request.headers.origin) return send(response, 403, errorBody('FORBIDDEN', 'Browser Origin requests are not allowed'));
    if (!safeToken(token, request.headers.authorization?.replace(/^Bearer /, ''))) return send(response, 401, errorBody('UNAUTHORIZED', 'Invalid bearer token'));
    try {
      const body = await readBody(request);
      const envelope = JSON.parse(body);
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || typeof envelope.method !== 'string' || !Object.hasOwn(envelope, 'params') || Object.keys(envelope).some(k => !['method', 'params'].includes(k))) throw new Error('Expected {method,params}');
      const params = validateCommand(envelope.method, envelope.params);
      send(response, 200, { ok: true, result: await dispatch(envelope.method, params) });
    } catch (error) {
      const code = error.code || 'INVALID_REQUEST';
      const status = code === 'INVALID_REQUEST' ? 400 : code === 'BUSY' ? 429 : 503;
      send(response, status, errorBody(code, error.message || 'Request failed'));
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  server.on('upgrade', (request, socket, head) => {
    const host = request.headers.host || '';
    const origin = request.headers.origin || '';
    if (request.url !== '/extension' || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host) || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return socket.destroy();
    wss.handleUpgrade(request, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    if (extension) return ws.close(1008, 'extension already connected');
    extension = ws;
    ws.authenticated = false;
    ws.lastPong = Date.now();
    const helloTimer = setTimeout(() => ws.close(1008, 'authentication timeout'), helloTimeoutMs);
    const heartbeat = setInterval(() => {
      if (!ws.authenticated) return;
      if (Date.now() - ws.lastPong > heartbeatDeadlineMs) return ws.terminate();
      ws.send(JSON.stringify({ type: 'ping' }));
    }, heartbeatIntervalMs);
    ws.on('message', raw => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return ws.close(1008, 'invalid message'); }
      if (!ws.authenticated) {
        if (message?.type !== 'hello' || !safeToken(token, message.token)) return ws.close(1008, 'authentication failed');
        ws.authenticated = true; ws.lastPong = Date.now(); clearTimeout(helloTimer); ws.send(JSON.stringify({ type: 'hello', ok: true })); return;
      }
      if (message?.type === 'pong') { ws.lastPong = Date.now(); return; }
      if (message?.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
      if (message?.type !== 'result' || typeof message.id !== 'string' || typeof message.ok !== 'boolean') return ws.close(1008, 'invalid message');
      const entry = pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer); pending.delete(message.id);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(Object.assign(new Error(message.error?.message || 'Extension command failed'), { code: message.error?.code || 'COMMAND_FAILED' }));
    });
    ws.on('close', () => { clearTimeout(helloTimer); clearInterval(heartbeat); drop(ws); });
    ws.on('error', () => {});
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const boundPort = server.address().port;
  return { port: boundPort, async close() { if (extension) extension.terminate(); failPending('SERVER_CLOSED', 'Bridge closed'); await new Promise(resolve => wss.close(() => server.close(resolve))); } };
}

function send(response, status, body) { if (!response.headersSent) { response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(body)); } }
function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    request.on('data', chunk => { size += chunk.length; if (size > MAX_PAYLOAD) { reject(Object.assign(new Error('Request body is too large'), { code: 'INVALID_REQUEST' })); request.resume(); } else chunks.push(chunk); });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8'))); request.on('error', reject);
  });
}
