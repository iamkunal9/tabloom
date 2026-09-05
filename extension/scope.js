export function isControllableTab(tab) {
  if (!tab || !Number.isInteger(tab.id) || tab.incognito) return false;
  try {
    const protocol = new URL(tab.url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export async function resolveCurrentTab(active, previousId, popupUrl, getTab) {
  if (isControllableTab(active)) return active;
  if (active?.url === popupUrl && previousId !== undefined) {
    const previous = await getTab(previousId);
    if (isControllableTab(previous)) return previous;
  }
  throw new Error('Open a normal HTTP(S) tab before enabling Current tab');
}

export class ScopeGrant {
  #mode = 'off';
  #tabId;
  #generation = 0;
  #connected = false;
  #listeners = new Set();

  get generation() { return this.#generation; }
  get connected() { return this.#connected; }

  status() {
    return this.#mode === 'tab'
      ? { mode: 'tab', tabId: this.#tabId }
      : { mode: this.#mode };
  }

  async grantSelectedTab(selectTab) {
    if (!this.#connected) throw new Error('Pair and connect to the bridge first');
    const generation = this.#generation;
    const tab = await selectTab();
    if (!this.#connected || generation !== this.#generation) throw new Error('Enable control was cancelled');
    return this.grantTab(tab);
  }

  grantTab(tab) {
    if (!isControllableTab(tab)) throw new Error('This tab cannot be controlled');
    this.revoke();
    this.#mode = 'tab';
    this.#tabId = tab.id;
    this.#generation++;
    return this.status();
  }

  grantBrowser() {
    this.revoke();
    this.#mode = 'browser';
    this.#tabId = undefined;
    this.#generation++;
    return this.status();
  }

  revoke() {
    const wasActive = this.#mode !== 'off';
    this.#mode = 'off';
    this.#tabId = undefined;
    this.#generation++;
    if (wasActive) for (const listener of this.#listeners) listener();
  }

  setConnected(connected) {
    if (this.#connected && !connected) this.revoke();
    this.#connected = connected;
  }

  onRevoke(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  isCurrent(generation) {
    return this.#mode !== 'off' && generation === this.#generation;
  }

  assertCurrent(generation) {
    if (!this.isCurrent(generation)) throw new Error('Control grant was revoked');
  }

  allows(tab) {
    if (!isControllableTab(tab)) return false;
    return this.#mode === 'browser' || (this.#mode === 'tab' && tab.id === this.#tabId);
  }

  assertAllows(tab) {
    if (!this.allows(tab)) throw new Error('Tab is outside the approved scope');
  }

  canManageTabs() { return this.#mode === 'browser'; }
}
