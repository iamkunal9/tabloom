import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startServer } from '../../src/server.js';
import { startFixture } from './fixture.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const extensionPath = path.join(root, 'extension');
const artifacts = path.join(root, 'artifacts');

async function launch(profile) {
  return chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
}

async function extensionId(context) {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  return new URL(worker.url()).host;
}

async function openPopup(context, id) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/popup.html`);
  return page;
}

async function pair(popup, port, token) {
  await popup.locator('#port').fill(String(port));
  await popup.locator('#token').fill(token);
  await popup.locator('#pair-form button[type=submit]').click();
  await assertText(popup, '#connected', 'Connected');
}

async function assertText(page, selector, value) {
  await page.locator(selector).waitFor();
  await page.waitForFunction(([selector, value]) => document.querySelector(selector)?.textContent === value, [selector, value]);
}

async function cli(method, params, configDir) {
  const { stdout } = await execFileAsync(process.execPath, [path.join(root, 'src/cli.js'), method, JSON.stringify(params)], {
    cwd: root, env: { ...process.env, TABLOOM_CONFIG_DIR: configDir },
  });
  const body = JSON.parse(stdout);
  assert.equal(body.ok, true);
  return body.result;
}

async function expectCliDenied(method, params, configDir, pattern = /scope|grant|control|required/i) {
  await assert.rejects(cli(method, params, configDir), error => {
    const body = JSON.parse(error.stdout || error.stderr);
    return body.ok === false && pattern.test(body.error.message);
  });
}

test('headed Chromium honors UI grants across CLI, MCP, disconnect, and restart', { timeout: 120_000 }, async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'tabloom-e2e-'));
  const profile = path.join(temp, 'profile');
  const configDir = path.join(temp, 'config');
  const token = 'e2e-token-0123456789abcdef0123456789';
  const fixture = await startFixture();
  let bridge = await startServer({ port: 0, token });
  const port = bridge.port;
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, 'config.json'), JSON.stringify({ port, token }));
  await mkdir(artifacts, { recursive: true });
  let context = await launch(profile);
  t.after(async () => {
    await context?.close().catch(() => {});
    await bridge?.close().catch(() => {});
    await fixture.close().catch(() => {});
    await rm(temp, { recursive: true, force: true });
  });

  const id = await extensionId(context);
  const first = context.pages()[0];
  await first.goto(fixture.url);
  const second = await context.newPage();
  await second.goto(`${fixture.url}/?second=1`);
  let popup = await openPopup(context, id);
  await pair(popup, port, token);
  await first.bringToFront();
  await first.waitForTimeout(200);
  await popup.bringToFront();
  await popup.locator('#current').click();
  await assertText(popup, '#scope', 'Current tab');

  const allowedTabs = await cli('tabs', {}, configDir);
  assert.equal(allowedTabs.length, 1);
  const firstId = allowedTabs[0].id;
  assert.equal(allowedTabs[0].url, `${fixture.url}/`);
  assert.deepEqual(await cli('status', {}, configDir), { mode: 'tab', tabId: firstId, connected: true });
  const snap = await cli('snapshot', { tabId: firstId }, configDir);
  assert.match(snap.text, /Your browser, on your terms/);
  const shadowInput = snap.elements.find(item => item.text === '' && item.selector.includes('#shadow-input'));
  const shadowButton = snap.elements.find(item => item.text === 'Send shadow');
  const nestedButton = snap.elements.find(item => item.text === 'Nested count: 0');
  assert.ok(shadowInput?.selector.includes(' >>> '));
  assert.ok(nestedButton?.selector.split(' >>> ').length === 3);

  await cli('type', { tabId: firstId, selector: '#name', text: 'AdaX' }, configDir);
  await cli('press', { tabId: firstId, key: 'Backspace' }, configDir);
  assert.equal(await first.locator('#name').inputValue(), 'Ada');
  await first.evaluate(() => {
    const disabled = document.createElement('input'); disabled.id = 'disabled-target'; disabled.disabled = true;
    const readonly = document.createElement('textarea'); readonly.id = 'readonly-target'; readonly.readOnly = true;
    const checkbox = document.createElement('input'); checkbox.id = 'checkbox-target'; checkbox.type = 'checkbox';
    const redirect = document.createElement('input'); redirect.id = 'redirect-target';
    redirect.addEventListener('focus', () => document.querySelector('#name').focus());
    document.body.prepend(disabled, readonly, checkbox, redirect);
  });
  for (const selector of ['#counter', '#disabled-target', '#readonly-target', '#checkbox-target', '#redirect-target']) {
    await expectCliDenied('type', { tabId: firstId, selector, text: 'wrong field' }, configDir, /editable|focus/i);
    assert.equal(await first.locator('#name').inputValue(), 'Ada');
  }
  await cli('type', { tabId: firstId, selector: '#name', text: 'Ada' }, configDir);
  await cli('press', { tabId: firstId, key: 'Enter' }, configDir);
  await assertText(first, '#result', 'Hello, Ada!');
  await cli('click', { tabId: firstId, selector: '#counter' }, configDir);
  await assertText(first, '#counter', 'Count: 1');
  await cli('type', { tabId: firstId, selector: shadowInput.selector, text: 'roundtrip' }, configDir);
  await cli('click', { tabId: firstId, selector: shadowButton.selector }, configDir);
  assert.equal(await first.locator('#shadow-host').evaluate(host => host.shadowRoot.querySelector('#shadow-result').textContent), 'Shadow: roundtrip');
  await cli('click', { tabId: firstId, selector: nestedButton.selector }, configDir);
  assert.equal(await first.locator('#shadow-host').evaluate(host => host.shadowRoot.querySelector('#nested-host').shadowRoot.querySelector('#nested-button').textContent), 'Nested count: 1');
  await cli('scroll', { tabId: firstId, y: 900 }, configDir);
  await first.waitForFunction(() => scrollY > 0);
  const png = await cli('screenshot', { tabId: firstId }, configDir);
  assert.equal(png.mimeType, 'image/png');
  assert.ok(Buffer.from(png.data, 'base64').length > 1000);
  await writeFile(path.join(artifacts, 'e2e-target.png'), Buffer.from(png.data, 'base64'));

  const allChromeTabs = await popup.evaluate(() => chrome.tabs.query({}));
  const secondTabId = allChromeTabs.find(tab => tab.url === `${fixture.url}/?second=1`).id;
  await expectCliDenied('snapshot', { tabId: secondTabId }, configDir);
  await expectCliDenied('open', { url: `${fixture.url}/next` }, configDir);

  const mcp = new Client({ name: 'tabloom-e2e', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'src/cli.js'), 'mcp'], cwd: root, env: { ...process.env, TABLOOM_CONFIG_DIR: configDir } });
  await mcp.connect(transport);
  const mcpResult = await mcp.callTool({ name: 'tabloom_snapshot', arguments: { tabId: firstId } });
  assert.equal(mcpResult.isError, undefined);
  assert.match(mcpResult.content[0].text, /Tabloom playground/);
  const mcpTabs = await mcp.callTool({ name: 'tabloom_tabs', arguments: {} });
  assert.equal(mcpTabs.isError, undefined);
  assert.deepEqual(JSON.parse(mcpTabs.content[0].text).map(tab => tab.id), [firstId]);
  await mcp.close();

  await cli('navigate', { tabId: firstId, url: `${fixture.url}/next` }, configDir);
  await first.waitForURL(`${fixture.url}/next`);
  await assertText(first, '#destination', 'Navigation complete');
  await cli('navigate', { tabId: firstId, url: fixture.url }, configDir);
  await first.waitForURL(`${fixture.url}/`);

  const internal = await context.newPage();
  await internal.goto('chrome://version/');

  await popup.locator('#browser').click();
  await assertText(popup, '#scope', 'Full browser');
  const fullTabs = await cli('tabs', {}, configDir);
  assert.ok(fullTabs.some(tab => tab.id === firstId));
  assert.ok(fullTabs.some(tab => tab.id === secondTabId));
  assert.ok(fullTabs.every(tab => !tab.url.startsWith('chrome://')));
  const opened = await cli('open', { url: `${fixture.url}/next` }, configDir);
  assert.ok(Number.isInteger(opened.id));
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal((await cli('tabs', {}, configDir)).find(tab => tab.id === opened.id)?.url, `${fixture.url}/next`);
  await cli('close', { tabId: opened.id }, configDir);
  assert.ok(!(await cli('tabs', {}, configDir)).some(tab => tab.id === opened.id));

  await first.bringToFront();
  await first.waitForTimeout(200);
  await popup.bringToFront();
  await popup.locator('#current').click();
  await assertText(popup, '#scope', 'Current tab');
  await expectCliDenied('snapshot', { tabId: secondTabId }, configDir);
  assert.equal((await cli('snapshot', { tabId: firstId }, configDir)).title, 'Tabloom playground');

  await popup.locator('main').screenshot({ path: path.join(artifacts, 'e2e-popup.png') });
  await popup.locator('#stop').click();
  await assertText(popup, '#scope', 'Off');
  await expectCliDenied('snapshot', { tabId: firstId }, configDir);

  await popup.locator('#browser').click();
  await assertText(popup, '#scope', 'Full browser');
  await bridge.close();
  bridge = null;
  await assertText(popup, '#connected', 'Disconnected');
  assert.equal(await popup.locator('#scope').textContent(), 'Off');
  bridge = await startServer({ port, token });
  await pair(popup, port, token);
  assert.equal(await popup.locator('#scope').textContent(), 'Off');
  await expectCliDenied('snapshot', { tabId: firstId }, configDir);

  await context.close();
  context = await launch(profile);
  const restartedId = await extensionId(context);
  popup = await openPopup(context, restartedId);
  await pair(popup, port, token);
  assert.equal(await popup.locator('#scope').textContent(), 'Off');
  const restartedTabs = await popup.evaluate(() => chrome.tabs.query({}));
  const restartedFixture = restartedTabs.find(tab => tab.url?.startsWith(fixture.url));
  if (restartedFixture) await expectCliDenied('snapshot', { tabId: restartedFixture.id }, configDir);

  await writeFile(path.join(artifacts, 'e2e-result.json'), `${JSON.stringify({ ok: true, chromium: await context.browser()?.version(), coverage: ['pair-ui','current-tab','shadow-dom','cli','mcp','full-browser','narrow','stop','disconnect','restart'] }, null, 2)}\n`);
});
