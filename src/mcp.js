import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { command as defaultCommand } from './client.js';

const tabId = z.number().int().nonnegative();
const httpUrl = z.string().url().refine(value => value.startsWith('http://') || value.startsWith('https://'), 'Must be an HTTP(S) URL');
const tools = [
  ['status', {}, 'Get the current authorization scope and bridge connection state.'],
  ['tabs', {}, 'List tabs permitted by the current authorization scope.'],
  ['snapshot', { tabId }, 'Read bounded page text and interactive elements.'],
  ['click', { tabId, selector: z.string().min(1).max(2048) }, 'Click one visible element.'],
  ['type', { tabId, selector: z.string().min(1).max(2048), text: z.string().max(100000) }, 'Replace text in one visible editable element.'],
  ['press', { tabId, key: z.enum(['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) }, 'Press a supported key.'],
  ['scroll', { tabId, x: z.number().finite().optional(), y: z.number().finite().optional() }, 'Scroll a tab by pixel deltas.'],
  ['navigate', { tabId, url: httpUrl }, 'Navigate a permitted tab to an HTTP(S) URL.'],
  ['screenshot', { tabId }, 'Capture a PNG screenshot.'],
  ['open', { url: httpUrl }, 'Open an HTTP(S) URL with full-browser scope.'],
  ['close', { tabId }, 'Close a tab with full-browser scope.'],
];

export function createMcpServer({ command = defaultCommand } = {}) {
  const server = new McpServer({ name: 'tabloom', version: '1.0.0' });
  for (const [method, schema, description] of tools) server.registerTool(`tabloom_${method}`, { description, inputSchema: schema }, async params => {
    try {
      const result = await command(method, params);
      if (method === 'screenshot') return { content: [{ type: 'image', mimeType: result.mimeType, data: result.data }] };
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result && typeof result === 'object' ? result : undefined };
    } catch (error) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: error.code || 'COMMAND_FAILED', message: error.message }) }] }; }
  });
  return server;
}

export async function runMcp() { await createMcpServer().connect(new StdioServerTransport()); }
