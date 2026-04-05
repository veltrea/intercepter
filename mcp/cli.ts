#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Veltrea Interceptor CLI
 *  All functionality available via WebSocket RPC — no MCP required.
 *
 *  Usage:
 *    npx tsx mcp/cli.ts <command> [args...]
 *--------------------------------------------------------------------------------------------*/
import WebSocket from 'ws';
import * as http from 'node:http';
import { resolve, join } from 'node:path';
import { unlinkSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';

const WS_URL = process.env.VELTREA_WS_URL ?? 'ws://localhost:5556';
const PROXY_URL = process.env.VELTREA_PROXY_URL ?? 'http://localhost:5555';

async function rpc(method: string, params?: any): Promise<any> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(WS_URL);
		ws.on('open', () => {
			ws.send(JSON.stringify({ id: 'cli-1', type: 'query', method, params }));
		});
		ws.on('message', (data) => {
			try {
				const msg = JSON.parse(data.toString());
				if (msg.id === 'cli-1') {
					if (msg.error) reject(new Error(msg.error));
					else resolve(msg.result);
					ws.close();
				}
			} catch {}
		});
		ws.on('error', (err) => { reject(new Error(`Cannot connect: ${err.message}`)); });
		setTimeout(() => { reject(new Error('Timeout')); ws.close(); }, 5000);
	});
}

function sendUiCommand(action: string, params?: any): Promise<void> {
	return new Promise((res, rej) => {
		const ws = new WebSocket(WS_URL);
		ws.on('open', () => {
			ws.send(JSON.stringify({ type: 'ui_command', action, params }));
			setTimeout(() => { ws.close(); res(); }, 200);
		});
		ws.on('error', (err) => { rej(new Error(`Cannot connect: ${err.message}`)); });
	});
}

const args = process.argv.slice(2);
const cmd = args[0];

function getFlag(name: string): string | undefined {
	const idx = args.indexOf(name);
	return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

(async () => {
	try {
		switch (cmd) {
			// --- Data queries ---

			case 'recent': {
				const limit = args[1] ? Number(args[1]) : 20;
				const results = await rpc('getRecentRequests', { limit });
				for (const r of results) {
					const tps = r.tps ? r.tps.toFixed(1) + ' t/s' : '-';
					const time = new Date(r.started_at).toLocaleTimeString();
					console.log(`${r.id}  ${r.method} ${r.path}  ${r.model || '-'}  ${r.status_code || '...'}  ${tps}  ${time}`);
				}
				console.log(`\n${results.length} requests`);
				break;
			}
			case 'detail': {
				const id = args[1];
				if (!id) { console.error('Usage: detail <request-id>'); process.exit(1); }
				const result = await rpc('getRequestById', { id });
				if (!result) { console.error(`Request not found: ${id}`); process.exit(1); }
				console.log(JSON.stringify(result, null, 2));
				break;
			}
			case 'chunks': {
				const reqId = args[1];
				if (!reqId) { console.error('Usage: chunks <request-id>'); process.exit(1); }
				const chunks = await rpc('getChunksForRequest', { requestId: reqId });
				for (const c of chunks) {
					console.log(c.raw);
				}
				console.log(`\n${chunks.length} chunks`);
				break;
			}
			case 'metrics': {
				const m = await rpc('getMetrics');
				console.log(`Requests: ${m.totalRequests}`);
				console.log(`Tokens:   ${m.totalTokens}`);
				console.log(`Avg TPS:  ${m.avgTps > 0 ? m.avgTps.toFixed(1) : '-'}`);
				console.log(`Avg Lat:  ${m.avgLatencyMs > 0 ? m.avgLatencyMs.toFixed(0) + 'ms' : '-'}`);
				break;
			}
			case 'search': {
				const filter: any = {};
				const model = getFlag('--model');
				const method = getFlag('--method');
				const limit = getFlag('--limit');
				if (model) filter.model = model;
				if (method) filter.method = method;
				if (limit) filter.limit = Number(limit);
				const results = await rpc('searchRequests', filter);
				for (const r of results) {
					const tps = r.tps ? r.tps.toFixed(1) + ' t/s' : '-';
					console.log(`${r.id}  ${r.method} ${r.path}  ${r.model || '-'}  ${r.status_code || '...'}  ${tps}  ${new Date(r.started_at).toLocaleTimeString()}`);
				}
				console.log(`\n${results.length} results`);
				break;
			}

			// --- Parameter overrides ---

			case 'set-model': {
				const model = args[1];
				if (!model) { console.error('Usage: set-model <model-name>'); process.exit(1); }
				const result = await rpc('setOverrides', { model });
				console.log(`Model override: ${model}`);
				console.log(JSON.stringify(result, null, 2));
				break;
			}
			case 'set-max-tokens': {
				const val = args[1];
				if (!val) { console.error('Usage: set-max-tokens <number>'); process.exit(1); }
				const result = await rpc('setOverrides', { max_tokens: Number(val) });
				console.log(`max_tokens override: ${val}`);
				console.log(JSON.stringify(result, null, 2));
				break;
			}
			case 'overrides': {
				const o = await rpc('getOverrides');
				if (Object.keys(o).length === 0) {
					console.log('No overrides set.');
				} else {
					console.log(JSON.stringify(o, null, 2));
				}
				break;
			}
			case 'clear-overrides': {
				await rpc('clearOverrides');
				console.log('Overrides cleared.');
				break;
			}

			// --- Chat ---

			case 'send': {
				// Usage: send <model> <message> [--max-tokens N]
				// or:   send <message> [--max-tokens N]  (uses first available model)
				// Strip flags from args first
				const sendArgs = args.slice(1).filter((a, i, arr) => a !== '--max-tokens' && arr[i - 1] !== '--max-tokens');
				let model = sendArgs[0] || '';
				let message = sendArgs.slice(1).join(' ');
				if (!message) {
					message = model;
					model = '';
				}
				if (!message) { console.error('Usage: send [model] <message> [--max-tokens N]'); process.exit(1); }

				// If no model specified, get first available
				if (!model) {
					const url = new URL('/v1/models', PROXY_URL);
					const modelsRes: any = await new Promise((res, rej) => {
						http.get(url, (r) => {
							let body = '';
							r.on('data', (c: Buffer) => body += c);
							r.on('end', () => { try { res(JSON.parse(body)); } catch { rej(new Error('Bad response')); } });
						}).on('error', rej);
					});
					model = modelsRes.data?.[0]?.id;
					if (!model) { console.error('No models available'); process.exit(1); }
					console.error(`Using model: ${model}`);
				}

				const maxTokens = getFlag('--max-tokens');
				const body = JSON.stringify({
					model,
					messages: [{ role: 'user', content: message }],
					max_tokens: maxTokens ? Number(maxTokens) : 256,
					stream: true,
				});

				const url = new URL('/v1/chat/completions', PROXY_URL);
				const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
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
								if (content) { process.stdout.write(content); fullText += content; }
							} catch {}
						}
					});
					res.on('end', () => {
						console.log('');
					});
				});
				req.on('error', (e) => { console.error('Request failed:', e.message); process.exit(1); });
				req.write(body);
				req.end();
				break;
			}

			// --- UI control ---

			case 'ui-select': {
				const id = args[1];
				if (!id) { console.error('Usage: ui-select <request-id>'); process.exit(1); }
				await sendUiCommand('selectRequest', { id });
				console.log(`Selected: ${id}`);
				break;
			}
			case 'ui-raw': {
				const val = args[1];
				if (!val || !['on', 'off'].includes(val)) { console.error('Usage: ui-raw <on|off>'); process.exit(1); }
				await sendUiCommand('toggleRaw', { enabled: val === 'on' });
				console.log(`Raw display: ${val}`);
				break;
			}
			case 'ui-clear': {
				await sendUiCommand('clearStream');
				console.log('Stream panel cleared.');
				break;
			}

			// --- Export ---

			case 'dump': {
				// dump <request-id> <output-dir>
				const reqId = args[1];
				const outDir = args[2] || '.';
				if (!reqId) { console.error('Usage: dump <request-id> <output-dir>'); process.exit(1); }
				const detail = await rpc('getRequestById', { id: reqId });
				if (!detail) { console.error(`Request not found: ${reqId}`); process.exit(1); }
				mkdirSync(outDir, { recursive: true });
				const prefix = `${reqId}`;
				// Request
				writeFileSync(join(outDir, `${prefix}_request.json`), JSON.stringify({
					method: detail.method,
					path: detail.path,
					headers: detail.request_headers,
					body: detail.request_body,
				}, null, 2));
				// Response headers
				if (detail.response_headers) {
					writeFileSync(join(outDir, `${prefix}_response_headers.json`), JSON.stringify(detail.response_headers, null, 2));
				}
				// Raw SSE chunks
				if (detail.chunks && detail.chunks.length > 0) {
					const rawLog = detail.chunks.map((c: any) => c.raw).join('\n\n');
					writeFileSync(join(outDir, `${prefix}_sse_raw.log`), rawLog);
				}
				// Full response body (non-streaming)
				if (detail.full_response_body) {
					writeFileSync(join(outDir, `${prefix}_response_body.json`), detail.full_response_body);
				}
				console.log(`Dumped to ${outDir}/`);
				console.log(`  ${prefix}_request.json`);
				if (detail.response_headers) console.log(`  ${prefix}_response_headers.json`);
				if (detail.chunks?.length > 0) console.log(`  ${prefix}_sse_raw.log (${detail.chunks.length} chunks)`);
				if (detail.full_response_body) console.log(`  ${prefix}_response_body.json`);
				break;
			}
			case 'dump-all': {
				// dump-all <output-dir> [--limit N]
				const outDir = args[1] || './dumps';
				const limit = getFlag('--limit') ? Number(getFlag('--limit')) : 100;
				const requests = await rpc('getRecentRequests', { limit });
				mkdirSync(outDir, { recursive: true });
				for (const r of requests) {
					const detail = await rpc('getRequestById', { id: r.id });
					if (!detail) continue;
					const prefix = r.id;
					writeFileSync(join(outDir, `${prefix}_request.json`), JSON.stringify({
						method: detail.method, path: detail.path,
						headers: detail.request_headers, body: detail.request_body,
					}, null, 2));
					if (detail.chunks?.length > 0) {
						writeFileSync(join(outDir, `${prefix}_sse_raw.log`), detail.chunks.map((c: any) => c.raw).join('\n\n'));
					}
					if (detail.full_response_body) {
						writeFileSync(join(outDir, `${prefix}_response_body.json`), detail.full_response_body);
					}
					console.log(`${r.id}  ${r.method} ${r.path}  ${r.model || '-'}`);
				}
				console.log(`\nDumped ${requests.length} requests to ${outDir}/`);
				break;
			}

			// --- Maintenance ---

			case 'reset-db': {
				const dbPath = resolve(process.cwd(), 'interceptor.db');
				for (const ext of ['', '-shm', '-wal']) {
					const p = dbPath + ext;
					if (existsSync(p)) { unlinkSync(p); console.log(`Deleted: ${p}`); }
				}
				console.log('Database reset. Restart the proxy to create a new one.');
				break;
			}
			default:
				console.log(`Veltrea Interceptor CLI

Chat:
  send [model] <message> [--max-tokens N]
                               Send a message through the proxy (streams response)

Data:
  recent [limit]               Recent requests (default: 20)
  detail <request-id>          Full request detail (headers, body, chunks)
  chunks <request-id>          Raw SSE chunks for a request
  metrics                      Aggregate metrics (TPS, latency, etc.)
  search [--model X] [--method GET|POST] [--limit N]

Export:
  dump <request-id> [output-dir]
                               Export request + raw SSE log to files
  dump-all [output-dir] [--limit N]
                               Export all recent requests to files

Overrides:
  set-model <model-name>       Override upstream model
  set-max-tokens <number>      Override max_tokens
  overrides                    Show current overrides
  clear-overrides              Clear all overrides

UI Control:
  ui-select <request-id>       Select a request in the GUI
  ui-raw <on|off>              Toggle raw SSE display
  ui-clear                     Clear stream panel

Maintenance:
  reset-db                     Delete SQLite database`);
				break;
		}
	} catch (e: any) {
		console.error('Error:', e.message);
		process.exit(1);
	}
})();
