/*---------------------------------------------------------------------------------------------
 *  Veltrea Interceptor MCP Server
 *  Thin WebSocket client that exposes Interceptor data as MCP tools.
 *  No GUI — runs as a stdio MCP server for AI agents.
 *
 *  Tools are kept minimal (5) to conserve tool slots in AI agents.
 *  For maintenance tasks, use the CLI: node mcp/cli.ts
 *--------------------------------------------------------------------------------------------*/
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import WebSocket from 'ws';
import * as http from 'node:http';

const WS_URL = process.env.VELTREA_WS_URL ?? 'ws://localhost:5556';
const PROXY_URL = process.env.VELTREA_PROXY_URL ?? 'http://localhost:5555';

// --- WebSocket RPC client ---

class InterceptorClient {
	private _ws: WebSocket | null = null;
	private _pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
	private _nextId = 0;
	private _connected = false;

	async connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			this._ws = new WebSocket(WS_URL);
			this._ws.on('open', () => { this._connected = true; resolve(); });
			this._ws.on('message', (data) => {
				try {
					const msg = JSON.parse(data.toString());
					if (msg.type === 'response' && msg.id) {
						const pending = this._pending.get(msg.id);
						if (pending) {
							this._pending.delete(msg.id);
							if (msg.error) pending.reject(new Error(msg.error));
							else pending.resolve(msg.result);
						}
					}
				} catch { /* ignore non-JSON */ }
			});
			this._ws.on('close', () => {
				this._connected = false;
				for (const [, p] of this._pending) p.reject(new Error('WebSocket closed'));
				this._pending.clear();
			});
			this._ws.on('error', (err) => { if (!this._connected) reject(err); });
		});
	}

	async rpc(method: string, params?: any): Promise<any> {
		if (!this._ws || !this._connected) {
			try { await this.connect(); } catch (e: any) {
				throw new Error(`Cannot connect to Veltrea Interceptor at ${WS_URL}: ${e.message}`);
			}
		}
		const id = `mcp-${this._nextId++}`;
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => { this._pending.delete(id); reject(new Error(`RPC timeout: ${method}`)); }, 10000);
			this._pending.set(id, {
				resolve: (v) => { clearTimeout(timeout); resolve(v); },
				reject: (e) => { clearTimeout(timeout); reject(e); },
			});
			this._ws!.send(JSON.stringify({ id, type: 'query', method, params }));
		});
	}
}

// --- MCP Server ---

const client = new InterceptorClient();
const server = new McpServer({ name: 'veltrea-interceptor', version: '0.1.0' });

server.tool(
	'get_recent_requests',
	'Get recent intercepted requests from the proxy',
	{ limit: z.number().optional().describe('Number of requests to return (default: 20)') },
	async ({ limit }) => {
		const result = await client.rpc('getRecentRequests', { limit: limit ?? 20 });
		return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
	},
);

server.tool(
	'get_request_detail',
	'Get full details of a specific request including headers, body, and SSE chunks',
	{ id: z.string().describe('Request ID') },
	async ({ id }) => {
		const result = await client.rpc('getRequestById', { id });
		if (!result) return { content: [{ type: 'text', text: `Request not found: ${id}` }] };
		return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
	},
);

server.tool(
	'get_raw_chunks',
	'Get raw SSE chunks for a specific request — shows the actual data sent by the LLM',
	{ request_id: z.string().describe('Request ID to get chunks for') },
	async ({ request_id }) => {
		const result = await client.rpc('getChunksForRequest', { requestId: request_id });
		return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
	},
);

server.tool(
	'set_model',
	'Override the model sent to the upstream LLM. All subsequent requests will use this model.',
	{ model: z.string().describe('Model name (e.g. google/gemma-3-1b, openai/gpt-oss-20b)') },
	async ({ model }) => {
		const result = await client.rpc('setOverrides', { model });
		return { content: [{ type: 'text', text: `Model override set. Current overrides: ${JSON.stringify(result)}` }] };
	},
);

server.tool(
	'set_max_tokens',
	'Override max_tokens sent to the upstream LLM',
	{ max_tokens: z.number().describe('Maximum tokens for completion') },
	async ({ max_tokens }) => {
		const result = await client.rpc('setOverrides', { max_tokens });
		return { content: [{ type: 'text', text: `max_tokens override set. Current overrides: ${JSON.stringify(result)}` }] };
	},
);

server.tool(
	'send_chat',
	'Send a chat message through the proxy to the upstream LLM and return the response. Useful for testing.',
	{
		message: z.string().describe('Message to send'),
		model: z.string().optional().describe('Model to use (defaults to first available)'),
		max_tokens: z.number().optional().describe('Max tokens (default: 256)'),
	},
	async ({ message, model, max_tokens }) => {
		// Get model if not specified
		if (!model) {
			const modelsRes = await new Promise<any>((res, rej) => {
				http.get(new URL('/v1/models', PROXY_URL), (r) => {
					let body = '';
					r.on('data', (c: Buffer) => body += c);
					r.on('end', () => { try { res(JSON.parse(body)); } catch { rej(new Error('Bad response')); } });
				}).on('error', rej);
			});
			model = modelsRes.data?.[0]?.id;
			if (!model) return { content: [{ type: 'text', text: 'No models available' }] };
		}

		const body = JSON.stringify({
			model,
			messages: [{ role: 'user', content: message }],
			max_tokens: max_tokens ?? 256,
			stream: true,
		});

		const response = await new Promise<string>((resolve, reject) => {
			const req = http.request(new URL('/v1/chat/completions', PROXY_URL), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
			}, (res) => {
				let fullText = '';
				let buffer = '';
				res.on('data', (chunk: Buffer) => {
					buffer += chunk.toString();
					const lines = buffer.split('\n');
					buffer = lines.pop() ?? '';
					for (const line of lines) {
						if (!line.startsWith('data: ')) continue;
						const data = line.slice(6);
						if (data === '[DONE]') continue;
						try {
							const parsed = JSON.parse(data);
							const content = parsed.choices?.[0]?.delta?.content;
							if (content) fullText += content;
						} catch {}
					}
				});
				res.on('end', () => resolve(fullText));
			});
			req.on('error', (e) => reject(e));
			req.write(body);
			req.end();
		});

		return { content: [{ type: 'text', text: `[${model}] ${response}` }] };
	},
);

// --- Start ---

async function main() {
	try {
		await client.connect();
		console.error('[mcp] Connected to Veltrea Interceptor at ' + WS_URL);
	} catch {
		console.error('[mcp] Warning: Could not connect to Veltrea Interceptor at ' + WS_URL);
		console.error('[mcp] Will retry on first tool call.');
	}
	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error('[mcp] MCP server running on stdio');
}

main().catch((err) => { console.error('[mcp] Fatal:', err); process.exit(1); });
