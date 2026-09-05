import { ScopeGrant, isControllableTab } from './scope.js';
import { ActionExecutor } from './actions.js';

const DEFAULT_PORT = 17653;
const RECONNECT_ALARM = 'tabloom-reconnect';
const HEARTBEAT_MS = 20_000;
const LIVENESS_LIMIT_MS = 50_000;
const scope = new ScopeGrant();
const executor = new ActionExecutor({ scope, tabs: chrome.tabs, debuggerApi: chrome.debugger });

let socket;
let connecting = false;
let heartbeatTimer;
let connectionDeadline;
let lastPong = 0;
let lastNormalTabId;

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isControllableTab(tab)) lastNormalTabId = tabId;
  } catch {}
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === lastNormalTabId) lastNormalTabId = undefined;
});
chrome.debugger.onDetach.addListener(source => executor.markDetached(source.tabId));

function emitState() {
  chrome.runtime.sendMessage({ type: 'stateChanged' }).catch(() => {});
}

function clearHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
  if (connectionDeadline) clearTimeout(connectionDeadline);
  connectionDeadline = undefined;
}

function disconnect() {
  clearHeartbeat();
  const current = socket;
  socket = undefined;
  scope.setConnected(false);
  if (current && current.readyState < WebSocket.CLOSING) current.close();
  emitState();
}

async function getPairing() {
  const { bridgePort = DEFAULT_PORT, pairingToken = '' } = await chrome.storage.local.get(['bridgePort', 'pairingToken']);
  return { bridgePort, pairingToken };
}

async function connect() {
  if (connecting || (socket && socket.readyState <= WebSocket.OPEN)) return;
  const { bridgePort, pairingToken } = await getPairing();
  if (!pairingToken || !Number.isInteger(bridgePort) || bridgePort < 1 || bridgePort > 65535) return;
  connecting = true;
  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${bridgePort}/extension`);
    socket = ws;
    connectionDeadline = setTimeout(() => { if (socket === ws && !scope.connected) disconnect(); }, 10_000);
    ws.addEventListener('open', () => ws.send(JSON.stringify({ type: 'hello', token: pairingToken })));
    ws.addEventListener('message', event => handleMessage(ws, event.data));
    ws.addEventListener('close', () => { if (socket === ws) disconnect(); });
    ws.addEventListener('error', () => { if (socket === ws) disconnect(); });
  } finally {
    connecting = false;
  }
}

function startHeartbeat(ws) {
  clearHeartbeat();
  lastPong = Date.now();
  heartbeatTimer = setInterval(() => {
    if (socket !== ws || ws.readyState !== WebSocket.OPEN || Date.now() - lastPong > LIVENESS_LIMIT_MS) {
      disconnect();
      return;
    }
    ws.send(JSON.stringify({ type: 'ping' }));
  }, HEARTBEAT_MS);
}

async function handleMessage(ws, raw) {
  if (ws !== socket || typeof raw !== 'string' || raw.length > 1_000_000) return disconnect();
  let message;
  try { message = JSON.parse(raw); } catch { return disconnect(); }
  lastPong = Date.now();
  if (message.type === 'hello') {
    if (message.ok !== true) return disconnect();
    scope.setConnected(true);
    startHeartbeat(ws);
    emitState();
    return;
  }
  if (!scope.connected) return disconnect();
  if (message.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return; }
  if (message.type === 'pong') { lastPong = Date.now(); return; }
  if (message.type !== 'command' || !['string', 'number'].includes(typeof message.id) || typeof message.method !== 'string') return;
  try {
    const result = await executor.execute(message.method, message.params);
    if (ws === socket && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'result', id: message.id, ok: true, result }));
  } catch (error) {
    if (ws === socket && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'result', id: message.id, ok: false, error: { code: 'COMMAND_FAILED', message: error?.message || 'Command failed' } }));
  }
}

async function targetTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (isControllableTab(active)) {
    lastNormalTabId = active.id;
    return active;
  }
  if (lastNormalTabId !== undefined) {
    const previous = await chrome.tabs.get(lastNormalTabId);
    if (isControllableTab(previous)) return previous;
  }
  throw new Error('Open a normal HTTP(S) tab before enabling Current tab');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'getState') {
      const pairing = await getPairing();
      return { ...scope.status(), connected: scope.connected, paired: Boolean(pairing.pairingToken), bridgePort: pairing.bridgePort, maskedToken: pairing.pairingToken ? `••••${pairing.pairingToken.slice(-4)}` : '' };
    }
    if (message?.type === 'pair') {
      const bridgePort = Number(message.bridgePort);
      const pairingToken = String(message.pairingToken || '').trim();
      if (!Number.isInteger(bridgePort) || bridgePort < 1 || bridgePort > 65535) throw new Error('Bridge port must be between 1 and 65535');
      if (pairingToken.length < 16 || pairingToken.length > 512) throw new Error('Pairing token is invalid');
      disconnect();
      await chrome.storage.local.set({ bridgePort, pairingToken });
      await connect();
      return {};
    }
    if (message?.type === 'grantTab') {
      if (!scope.connected) throw new Error('Pair and connect to the bridge first');
      return scope.grantTab(await targetTab());
    }
    if (message?.type === 'grantBrowser') {
      if (!scope.connected) throw new Error('Pair and connect to the bridge first');
      return scope.grantBrowser();
    }
    if (message?.type === 'stop') { scope.revoke(); emitState(); return {}; }
    throw new Error('Unsupported popup request');
  })().then(result => sendResponse({ ok: true, result }), error => sendResponse({ ok: false, error: error?.message || 'Request failed' }));
  return true;
});

chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === RECONNECT_ALARM && !scope.connected) connect(); });
connect();
