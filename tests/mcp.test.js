import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp.js';

test('MCP exposes typed tools and converts screenshots to image content', async t => {
  const calls = [];
  const server = createMcpServer({ command: async (method, params) => {
    calls.push([method, params]);
    return method === 'screenshot' ? { mimeType: 'image/png', data: 'aGVsbG8=' } : { mode: 'tab' };
  }});
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await server.close(); });
  const tools = await client.listTools();
  assert.ok(tools.tools.some(tool => tool.name === 'tabloom_click' && tool.inputSchema.required.includes('tabId')));
  const result = await client.callTool({ name: 'tabloom_screenshot', arguments: { tabId: 7 } });
  assert.deepEqual(calls.at(-1), ['screenshot', { tabId: 7 }]);
  assert.deepEqual(result.content, [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }]);
});

test('MCP tab arrays survive SDK result validation', async t => {
  const tabs = [{ id: 7, title: 'Example', url: 'https://example.test/' }];
  const server = createMcpServer({ command: async () => tabs });
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => { await client.close(); await server.close(); });
  const result = await client.callTool({ name: 'tabloom_tabs', arguments: {} });
  assert.deepEqual(JSON.parse(result.content[0].text), tabs);
});
