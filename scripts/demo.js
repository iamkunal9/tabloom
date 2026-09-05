#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { readConfig, writeConfig } from '../src/config.js';
import { startServer } from '../src/server.js';
import { startFixture } from '../tests/e2e/fixture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = path.join(root, 'extension');
const profile = await mkdtemp(path.join(os.tmpdir(), 'tabloom-demo-'));
let fixture;
let bridge;
let context;
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await context?.close().catch(() => {});
  await bridge?.close().catch(() => {});
  await fixture?.close().catch(() => {});
  await rm(profile, { recursive: true, force: true });
}
process.once('SIGINT', async () => { await close(); process.exit(0); });
process.once('SIGTERM', async () => { await close(); process.exit(0); });

try {
  let config;
  try { config = await readConfig(); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; config = await writeConfig(); }
  fixture = await startFixture();
  bridge = await startServer(config);
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const page = context.pages()[0];
  await page.goto(fixture.url);
  await page.bringToFront();
  await page.waitForTimeout(200);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator('#port').fill(String(config.port));
  await popup.locator('#token').fill(config.token);
  await popup.locator('#pair-form button[type=submit]').click();
  await popup.waitForFunction(() => document.querySelector('#connected')?.textContent === 'Connected');
  console.log(`Tabloom demo is ready at ${fixture.url}. Choose a scope in the extension tab; press Ctrl+C to stop.`);
  await new Promise(resolve => context.once('close', resolve));
  await close();
} catch (error) {
  await close();
  throw error;
}
