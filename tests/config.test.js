import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readConfig, writeConfig } from '../src/config.js';

test('writes config with owner-only permissions and honors the port override', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tabloom-config-'));
  const env = { TABLOOM_CONFIG_DIR: path.join(root, 'config') };
  const written = await writeConfig({ port: 17653, token: '0123456789abcdef' }, env);
  assert.deepEqual(written, { port: 17653, token: '0123456789abcdef' });
  assert.equal((await stat(env.TABLOOM_CONFIG_DIR)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(env.TABLOOM_CONFIG_DIR, 'config.json'))).mode & 0o777, 0o600);
  assert.deepEqual(await readConfig({ ...env, TABLOOM_PORT: '19000' }), { port: 19000, token: written.token });
});
