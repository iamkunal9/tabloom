import { readConfig } from './config.js';

export async function command(method, params = {}, { config, signal } = {}) {
  const { port, token } = config || await readConfig();
  const response = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ method, params }), signal });
  let body;
  try { body = await response.json(); } catch { throw Object.assign(new Error(`Bridge returned HTTP ${response.status}`), { code: 'BRIDGE_ERROR' }); }
  if (!response.ok || body.ok !== true) throw Object.assign(new Error(body.error?.message || `Bridge returned HTTP ${response.status}`), { code: body.error?.code || 'BRIDGE_ERROR' });
  return body.result;
}
