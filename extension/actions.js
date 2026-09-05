import { isControllableTab } from './scope.js';

const METHODS = new Set(['status', 'tabs', 'snapshot', 'click', 'type', 'press', 'scroll', 'navigate', 'screenshot', 'open', 'close']);
const KEYS = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
};

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const object = params => params && typeof params === 'object' && !Array.isArray(params) ? params : {};
const finite = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
};
const tabId = value => {
  if (!Number.isInteger(value) || value < 0) throw new Error('tabId must be a non-negative integer');
  return value;
};
const text = (value, name, max) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} must be a non-empty string up to ${max} characters`);
  return value;
};
const httpUrl = value => {
  const raw = text(value, 'url', 8192);
  let parsed;
  try { parsed = new URL(raw); } catch { throw new Error('url must be an HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('url must be an HTTP(S) URL');
  return parsed.href;
};
const exact = (params, keys) => {
  const unexpected = Object.keys(params).filter(key => !keys.includes(key));
  if (unexpected.length) throw new Error(`Unexpected argument: ${unexpected[0]}`);
};

export function keyDefinition(key) {
  if (!own(KEYS, key)) throw new Error('key is not supported');
  return { ...KEYS[key] };
}

export function validateCommand(method, rawParams = {}) {
  if (!METHODS.has(method)) throw new Error(`Unsupported action: ${method}`);
  const params = object(rawParams);
  if (method === 'status' || method === 'tabs') { exact(params, []); return {}; }
  if (method === 'open') { exact(params, ['url']); return { url: httpUrl(params.url) }; }
  if (method === 'close' || method === 'snapshot' || method === 'screenshot') {
    exact(params, ['tabId']); return { tabId: tabId(params.tabId) };
  }
  if (method === 'navigate') {
    exact(params, ['tabId', 'url']); return { tabId: tabId(params.tabId), url: httpUrl(params.url) };
  }
  if (method === 'click') {
    exact(params, ['tabId', 'selector']);
    return { tabId: tabId(params.tabId), selector: text(params.selector, 'selector', 2048) };
  }
  if (method === 'type') {
    exact(params, ['tabId', 'selector', 'text']);
    if (typeof params.text !== 'string' || params.text.length > 100_000) throw new Error('text must be a string up to 100000 characters');
    return { tabId: tabId(params.tabId), selector: text(params.selector, 'selector', 2048), text: params.text };
  }
  if (method === 'press') {
    exact(params, ['tabId', 'key']); return { tabId: tabId(params.tabId), key: keyDefinition(params.key).key };
  }
  exact(params, ['tabId', 'x', 'y']);
  return { tabId: tabId(params.tabId), x: own(params, 'x') ? finite(params.x, 'x') : 0, y: own(params, 'y') ? finite(params.y, 'y') : 0 };
}

const selectorExpression = (selector, mode) => `(() => {
  const selector = ${JSON.stringify(selector)};
  let roots = [document];
  let all = [];
  try {
    for (const [index, part] of selector.split(' >>> ').entries()) {
      all = roots.flatMap(root => [...root.querySelectorAll(part)]);
      if (index < selector.split(' >>> ').length - 1) roots = all.map(element => element.shadowRoot).filter(Boolean);
    }
  } catch { return { error: 'Invalid selector' }; }
  const visible = all.filter(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  });
  if (visible.length !== 1) return { error: visible.length ? 'Selector is not unique' : 'No visible element matches selector' };
  const element = visible[0];
  ${mode === 'focus' || mode === 'verifyFocus' ? `
  const textInput = element instanceof HTMLInputElement && ['text', 'search', 'email', 'url', 'tel', 'password'].includes(element.type);
  const textArea = element instanceof HTMLTextAreaElement;
  const editable = element instanceof HTMLInputElement ? textInput : textArea || element.isContentEditable;
  if (!editable || element.matches(':disabled') || element.readOnly) return { error: 'Target is not editable' };
  const hasFocus = () => {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active === element;
  };
  ${mode === 'verifyFocus' ? "if (!hasFocus()) return { error: 'Target lost focus' }; return { focused: true };" : ''}
  ` : ''}
  element.scrollIntoView({ block: 'center', inline: 'center' });
  ${mode === 'focus' ? `element.focus();
  if (!hasFocus()) return { error: 'Target did not retain focus' };
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) element.select();
  else if (element.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }` : ''}
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
})()`;

const snapshotExpression = `(() => {
  const compact = (value, limit = 500) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
  const elements = [];
  const localSelector = (element, boundary) => {
    if (element.id) return '#' + CSS.escape(element.id);
    const parts = [];
    for (let node = element; node && node !== boundary && node.nodeType === 1; node = node.parentElement) {
      let part = node.localName;
      const siblings = node.parentNode?.children ? [...node.parentNode.children].filter(item => item.localName === node.localName) : [];
      if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const selectorFor = element => {
    const root = element.getRootNode();
    const local = localSelector(element, root);
    return root instanceof ShadowRoot ? selectorFor(root.host) + ' >>> ' + local : local;
  };
  const visit = root => {
    for (const element of root.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[tabindex]')) {
      if (elements.length >= 500) break;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      if (rect.width && rect.height && style.display !== 'none' && style.visibility !== 'hidden') elements.push({ selector: selectorFor(element), tag: element.localName, text: compact(element.innerText || element.value || element.getAttribute('aria-label')) });
    }
    for (const element of root.querySelectorAll('*')) if (element.shadowRoot && elements.length < 500) visit(element.shadowRoot);
  };
  visit(document);
  return { title: document.title.slice(0, 500), url: location.href, text: compact(document.body?.innerText, 50000), elements };
})()`;

export class ActionExecutor {
  constructor({ scope, tabs, debuggerApi }) {
    this.scope = scope;
    this.tabs = tabs;
    this.debugger = debuggerApi;
    this.attached = new Set();
    this._tail = Promise.resolve();
    this._detaching = Promise.resolve();
    scope.onRevoke(() => this.detachAll());
  }

  execute(method, rawParams) {
    let params;
    try { params = validateCommand(method, rawParams); } catch (error) { return Promise.reject(error); }
    if (method === 'status') return Promise.resolve({ ...this.scope.status(), connected: this.scope.connected });
    const generation = this.scope.generation;
    const run = this._tail.then(() => this.#run(method, params, generation));
    this._tail = run.catch(() => {});
    return run;
  }

  detachAll() {
    const ids = [...this.attached];
    this.attached.clear();
    const previous = this._detaching;
    this._detaching = Promise.allSettled([previous, ...ids.map(tabId => this.debugger.detach?.({ tabId }))]);
    return this._detaching;
  }

  markDetached(tabId, reason) {
    // Internal detach clears membership before invoking Chrome, so its event
    // cannot revoke a replacement grant. Pending attachments are members too.
    const wasAttached = this.attached.delete(tabId);
    if (wasAttached && reason === 'canceled_by_user') this.scope.revoke();
  }

  async #tab(id, generation) {
    this.scope.assertCurrent(generation);
    const current = await this.tabs.get(id);
    this.scope.assertCurrent(generation);
    this.scope.assertAllows(current);
    return current;
  }

  async #attach(id, generation) {
    await this._detaching;
    this.scope.assertCurrent(generation);
    if (this.attached.has(id)) return;
    this.scope.assertCurrent(generation);
    this.attached.add(id);
    let established = false;
    try {
      await this.debugger.attach({ tabId: id }, '1.3');
      established = true;
      this.scope.assertCurrent(generation);
      const current = await this.tabs.get(id);
      this.scope.assertCurrent(generation);
      this.scope.assertAllows(current);
      this.attached.add(id);
    } catch (error) {
      this.attached.delete(id);
      if (established) await this.debugger.detach?.({ tabId: id }).catch(() => {});
      throw error;
    }
  }

  async #cdp(id, method, params, generation, document) {
    this.scope.assertCurrent(generation);
    const before = await this.tabs.get(id);
    this.scope.assertCurrent(generation);
    this.scope.assertAllows(before);
    if (document) await this.#assertDocument(id, generation, document);
    const result = await this.debugger.sendCommand({ tabId: id }, method, params);
    this.scope.assertCurrent(generation);
    const after = await this.tabs.get(id);
    this.scope.assertCurrent(generation);
    this.scope.assertAllows(after);
    return result;
  }

  async #document(id, generation) {
    const result = await this.#cdp(id, 'Page.getFrameTree', {}, generation);
    const frame = result.frameTree?.frame;
    if (!frame?.id || !frame?.loaderId) throw new Error('Could not identify current document');
    return { id: frame.id, loaderId: frame.loaderId };
  }

  async #assertDocument(id, generation, expected) {
    const current = await this.#document(id, generation);
    if (current.id !== expected.id || current.loaderId !== expected.loaderId) throw new Error('Document changed during action');
  }

  async #run(method, params, generation) {
    this.scope.assertCurrent(generation);
    if (method === 'tabs') {
      const tabs = await this.tabs.query({});
      this.scope.assertCurrent(generation);
      return tabs.filter(tab => this.scope.allows(tab)).map(({ id, title, url }) => ({ id, title, url }));
    }
    if (method === 'open') {
      if (!this.scope.canManageTabs()) throw new Error('Full browser scope is required');
      this.scope.assertCurrent(generation);
      const created = await this.tabs.create({ url: params.url });
      this.scope.assertCurrent(generation);
      return { id: created.id, title: created.title, url: created.url };
    }
    const current = await this.#tab(params.tabId, generation);
    if (method === 'close') {
      if (!this.scope.canManageTabs()) throw new Error('Full browser scope is required');
      this.scope.assertCurrent(generation);
      await this.tabs.remove(params.tabId);
      this.attached.delete(params.tabId);
      this.scope.assertCurrent(generation);
      return {};
    }
    if (method === 'navigate') {
      this.scope.assertCurrent(generation);
      const updated = await this.tabs.update(params.tabId, { url: params.url });
      this.scope.assertCurrent(generation);
      return { id: updated.id, url: updated.url };
    }
    await this.#attach(current.id, generation);
    if (method === 'screenshot') {
      const result = await this.#cdp(current.id, 'Page.captureScreenshot', { format: 'png', fromSurface: true }, generation);
      return { mimeType: 'image/png', data: result.data };
    }
    if (method === 'scroll') {
      const expression = `window.scrollBy(${JSON.stringify(params.x)}, ${JSON.stringify(params.y)}); true`;
      await this.#cdp(current.id, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false }, generation);
      return {};
    }
    if (method === 'press') {
      const key = keyDefinition(params.key);
      const character = params.key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {};
      await this.#cdp(current.id, 'Input.dispatchKeyEvent', { type: 'keyDown', ...key, ...character }, generation);
      await this.#cdp(current.id, 'Input.dispatchKeyEvent', { type: 'keyUp', ...key }, generation);
      return {};
    }
    if (method === 'snapshot') {
      const result = await this.#cdp(current.id, 'Runtime.evaluate', { expression: snapshotExpression, returnByValue: true, awaitPromise: false }, generation);
      return result.result?.value;
    }
    const document = await this.#document(current.id, generation);
    const resolved = await this.#cdp(current.id, 'Runtime.evaluate', { expression: selectorExpression(params.selector, method === 'type' ? 'focus' : 'point'), returnByValue: true, awaitPromise: false }, generation);
    const point = resolved.result?.value;
    if (!point || point.error) throw new Error(point?.error || 'Could not resolve selector');
    await this.#assertDocument(current.id, generation, document);
    if (method === 'click') {
      await this.#cdp(current.id, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 }, generation, document);
      await this.#cdp(current.id, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 }, generation, document);
      return {};
    }
    const focused = await this.#cdp(current.id, 'Runtime.evaluate', { expression: selectorExpression(params.selector, 'verifyFocus'), returnByValue: true, awaitPromise: false }, generation, document);
    if (!focused.result?.value?.focused) throw new Error(focused.result?.value?.error || 'Target lost focus');
    await this.#cdp(current.id, 'Input.insertText', { text: params.text }, generation, document);
    return {};
  }
}

export { isControllableTab };
