#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { command } from './client.js';
import { DEFAULT_PORT, readConfig, writeConfig } from './config.js';
import { installSkill } from './install-skill.js';
import { runMcp } from './mcp.js';
import { startServer } from './server.js';

export async function main(argv = process.argv.slice(2)) {
  const [operation, ...args] = argv;
  if (operation === 'pair') {
    const current = await ensureConfig();
    const requested = option(args, '--port');
    const port = requested === undefined ? current.port : parsePort(requested);
    const changed = port !== current.port;
    const config = changed ? await writeConfig({ port, token: current.token }) : current;
    console.log(JSON.stringify({ ok: true, port: config.port, token: config.token, restartRequired: changed, instructions: changed ? 'Restart tabloom serve, then paste this token and port into the Tabloom extension popup.' : 'Paste this token and port into the Tabloom extension popup.' })); return;
  }
  if (operation === 'serve') {
    let config = await ensureConfig();
    const rawPort = option(args, '--port');
    const port = rawPort === undefined ? config.port : parseServePort(rawPort);
    const bridge = await startServer({ port, token: config.token });
    if (bridge.port !== config.port) { config = await writeConfig({ port: bridge.port, token: config.token }); }
    console.log(JSON.stringify({ ok: true, listening: `127.0.0.1:${bridge.port}` })); return;
  }
  if (operation === 'mcp') return runMcp();
  if (operation === 'install-skill') {
    const result = await installSkill({ agent: option(args, '--agent') || 'all', dir: option(args, '--dir'), force: args.includes('--force'), cliPath: path.resolve(fileURLToPath(import.meta.url)) });
    console.log(JSON.stringify({ ok: true, ...result })); return;
  }
  if (!operation) throw Object.assign(new Error('Usage: tabloom pair|serve|mcp|install-skill|<method> [JSON params]'), { code: 'USAGE' });
  const params = args[0] === undefined ? {} : JSON.parse(args[0]);
  console.log(JSON.stringify({ ok: true, result: await command(operation, params) }));
}
function option(args, name) { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; }
function parsePort(value) { const port = Number(value); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('port must be between 1 and 65535'); return port; }
function parseServePort(value) { if (String(value) === '0') return 0; return parsePort(value); }
async function ensureConfig() {
  try { return await readConfig(); }
  catch (error) { if (error?.code !== 'ENOENT') throw error; return writeConfig({ port: parsePort(process.env.TABLOOM_PORT ?? DEFAULT_PORT) }); }
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch(error => { console.error(JSON.stringify({ ok: false, error: { code: error.code || 'COMMAND_FAILED', message: error.message } })); process.exitCode = 1; });
