import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_PORT = 17653;
export function configDir(env = process.env) { return path.resolve(env.TABLOOM_CONFIG_DIR || path.join(os.homedir(), '.config', 'tabloom')); }
export function configPath(env = process.env) { return path.join(configDir(env), 'config.json'); }

export async function readConfig(env = process.env) {
  const value = JSON.parse(await readFile(configPath(env), 'utf8'));
  const port = env.TABLOOM_PORT === undefined ? value.port : Number(env.TABLOOM_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || typeof value.token !== 'string' || value.token.length < 16) throw new Error('Tabloom config is invalid; run tabloom pair');
  return { port, token: value.token };
}

export async function writeConfig({ port = DEFAULT_PORT, token = randomBytes(32).toString('hex') } = {}, env = process.env) {
  const dir = configDir(env);
  await mkdir(dir, { recursive: true, mode: 0o700 }); await chmod(dir, 0o700);
  await writeFile(configPath(env), `${JSON.stringify({ port, token }, null, 2)}\n`, { mode: 0o600 }); await chmod(configPath(env), 0o600);
  return { port, token };
}
