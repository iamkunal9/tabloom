import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installSkill } from '../src/install-skill.js';

test('installs skill and an absolute cwd-independent helper into a custom directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tabloom-skill-'));
  const result = await installSkill({ agent: 'codex', dir, cliPath: '/opt/tabloom/src/cli.js' });
  assert.equal(result.destinations.length, 1);
  assert.match(await readFile(path.join(dir, 'tabloom', 'SKILL.md'), 'utf8'), /name: tabloom/);
  const helper = await readFile(path.join(dir, 'tabloom', 'scripts', 'tabloom'), 'utf8');
  assert.match(helper, /\/opt\/tabloom\/src\/cli\.js/);
  assert.ok(path.isAbsolute(result.destinations[0]));
});

test('refuses overwrite unless force is provided and supports all agents', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tabloom-skill-'));
  await installSkill({ agent: 'codex', dir });
  await assert.rejects(() => installSkill({ agent: 'codex', dir }), /already exists/);
  await writeFile(path.join(dir, 'tabloom', 'marker'), 'old');
  await installSkill({ agent: 'codex', dir, force: true });
  const all = await installSkill({ agent: 'all', dir: path.join(dir, 'agents') });
  assert.equal(all.destinations.length, 2);
});
