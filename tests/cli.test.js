import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import WebSocket from 'ws';

const exec = promisify(execFile);
const cli = path.resolve('src/cli.js');

test('serve initializes fresh config and pair reuses its live token', async t => {
  const configDir = await mkdtemp(path.join(tmpdir(), 'tabloom-cli-'));
  const env = { ...process.env, TABLOOM_CONFIG_DIR: configDir };
  const child = spawn(process.execPath, [cli, 'serve', '--port', '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const listening = JSON.parse(await firstLine(child.stdout));
  const port = Number(listening.listening.split(':').at(-1));
  const first = JSON.parse((await exec(process.execPath, [cli, 'pair'], { env })).stdout);
  const second = JSON.parse((await exec(process.execPath, [cli, 'pair'], { env })).stdout);
  assert.equal(second.token, first.token);
  assert.equal(first.port, port);
  const ws = new WebSocket(`ws://127.0.0.1:${port}/extension`, { headers: { Origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop' } });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'hello', token: first.token }));
  assert.deepEqual(await new Promise(resolve => ws.once('message', data => resolve(JSON.parse(data)))), { type: 'hello', ok: true });
  ws.close();
});

function firstLine(stream) {
  return new Promise((resolve, reject) => {
    let text = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => { text += chunk; const newline = text.indexOf('\n'); if (newline >= 0) resolve(text.slice(0, newline)); });
    stream.on('error', reject); stream.on('end', () => reject(new Error('process ended before output')));
  });
}

test('actual executable symlink runs the CLI and writes its skill', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tabloom-linked-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const linked = path.join(dir, 'tabloom');
  await symlink(cli, linked);
  const { stdout } = await exec(linked, ['install-skill', '--dir', path.join(dir, 'skills')]);
  assert.equal(JSON.parse(stdout).ok, true);
});
