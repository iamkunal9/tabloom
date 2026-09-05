import { access, cp, mkdir, rm, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exists = value => access(value).then(() => true, () => false);

export async function installSkill({ agent = 'all', dir, force = false, cliPath = path.join(packageRoot, 'src', 'cli.js') } = {}) {
  if (!['all', 'codex', 'claude'].includes(agent)) throw new Error('agent must be codex, claude, or all');
  const agents = agent === 'all' ? ['codex', 'claude'] : [agent];
  const roots = agents.map(name => dir ? (agents.length === 1 ? path.resolve(dir) : path.resolve(dir, name)) : path.join(os.homedir(), `.${name}`, 'skills'));
  const destinations = roots.map(root => path.join(root, 'tabloom'));
  for (const destination of destinations) if (await exists(destination) && !force) throw new Error(`${destination} already exists; use --force to replace it`);
  for (const destination of destinations) {
    if (force) await rm(destination, { recursive: true, force: true });
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(packageRoot, 'skills', 'tabloom'), destination, { recursive: true });
    const helper = path.join(destination, 'scripts', 'tabloom');
    await mkdir(path.dirname(helper), { recursive: true });
    await writeFile(helper, `#!/bin/sh\nexec node ${shellQuote(path.resolve(cliPath))} "$@"\n`, { mode: 0o755 });
    await chmod(helper, 0o755);
  }
  return { destinations };
}
function shellQuote(value) { return `'${value.replaceAll("'", "'\\''")}'`; }
