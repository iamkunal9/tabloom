const METHODS = new Set(['status', 'tabs', 'snapshot', 'click', 'type', 'press', 'scroll', 'upload', 'navigate', 'screenshot', 'open', 'close']);
const KEYS = new Set(['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const exact = (params, keys) => {
  const extra = Object.keys(params).find(key => !keys.includes(key));
  if (extra) throw new Error(`Unexpected argument: ${extra}`);
};
const id = value => {
  if (!Number.isInteger(value) || value < 0) throw new Error('tabId must be a non-negative integer');
  return value;
};
const string = (value, name, max, allowEmpty = false) => {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > max) throw new Error(`${name} must be ${allowEmpty ? 'a' : 'a non-empty'} string up to ${max} characters`);
  return value;
};
const url = value => {
  let parsed;
  try { parsed = new URL(string(value, 'url', 8192)); } catch { throw new Error('url must be an HTTP(S) URL'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('url must be an HTTP(S) URL');
  return parsed.href;
};

export function validateCommand(method, value = {}) {
  if (!METHODS.has(method)) throw new Error(`Unsupported action: ${method}`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('params must be an object');
  const params = value;
  if (method === 'status' || method === 'tabs') { exact(params, []); return {}; }
  if (method === 'open') { exact(params, ['url']); return { url: url(params.url) }; }
  if (['close', 'snapshot', 'screenshot'].includes(method)) { exact(params, ['tabId']); return { tabId: id(params.tabId) }; }
  if (method === 'navigate') { exact(params, ['tabId', 'url']); return { tabId: id(params.tabId), url: url(params.url) }; }
  if (method === 'click') { exact(params, ['tabId', 'selector']); return { tabId: id(params.tabId), selector: string(params.selector, 'selector', 2048) }; }
  if (method === 'type') { exact(params, ['tabId', 'selector', 'text']); return { tabId: id(params.tabId), selector: string(params.selector, 'selector', 2048), text: string(params.text, 'text', 100000, true) }; }
  if (method === 'upload') { exact(params, ['tabId', 'selector', 'path']); return { tabId: id(params.tabId), selector: string(params.selector, 'selector', 2048), path: string(params.path, 'path', 4096) }; }
  if (method === 'press') {
    exact(params, ['tabId', 'key']);
    if (!KEYS.has(params.key)) throw new Error('key is not supported');
    return { tabId: id(params.tabId), key: params.key };
  }
  exact(params, ['tabId', 'x', 'y']);
  const finite = (value, name) => { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`); return value; };
  return { tabId: id(params.tabId), x: own(params, 'x') ? finite(params.x, 'x') : 0, y: own(params, 'y') ? finite(params.y, 'y') : 0 };
}
