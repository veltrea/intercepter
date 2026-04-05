/*---------------------------------------------------------------------------------------------
 *  ProxyServer - transparent HTTP proxy between IDE and LM Studio.
 *  Forwards all requests, captures SSE streams via SsePassthrough.
 *--------------------------------------------------------------------------------------------*/
import * as http from 'node:http';
import { URL } from 'node:url';
import { InterceptorConfig } from '../config.js';
import { RequestCapture } from './requestCapture.js';
import { SsePassthrough } from './ssePassthrough.js';

export interface ParameterOverrides {
	model?: string;
	max_tokens?: number;
}

export class ProxyServer {
	private _server: http.Server | undefined;
	private _overrides: ParameterOverrides = {};

	constructor(
		private readonly _config: InterceptorConfig,
		private readonly _capture: RequestCapture,
	) { }

	setOverrides(overrides: ParameterOverrides): void {
		this._overrides = { ...this._overrides, ...overrides };
	}

	getOverrides(): ParameterOverrides {
		return { ...this._overrides };
	}

	clearOverrides(): void {
		this._overrides = {};
	}

	start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this._server = http.createServer((req, res) => this._handleRequest(req, res));
			this._server.on('error', reject);
			this._server.listen(this._config.proxyPort, () => {
				console.log(`[proxy] Listening on :${this._config.proxyPort} -> ${this._config.upstreamUrl}`);
				resolve();
			});
		});
	}

	private _handleRequest(clientReq: http.IncomingMessage, clientRes: http.ServerResponse): void {
		const method = clientReq.method || 'GET';
		const path = clientReq.url || '/';

		// CORS: allow requests from any origin (wry WebView uses null origin)
		clientRes.setHeader('Access-Control-Allow-Origin', '*');
		clientRes.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
		clientRes.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');

		// Handle CORS preflight
		if (method === 'OPTIONS') {
			clientRes.writeHead(204);
			clientRes.end();
			return;
		}

		// Collect request body
		const bodyChunks: Buffer[] = [];
		clientReq.on('data', (chunk: Buffer) => bodyChunks.push(chunk));
		clientReq.on('end', () => {
			const rawBody = Buffer.concat(bodyChunks);
			let parsedBody: any;
			try { parsedBody = rawBody.length > 0 ? JSON.parse(rawBody.toString('utf-8')) : undefined; } catch { parsedBody = undefined; }

			// Extract request headers
			const reqHeaders: Record<string, string> = {};
			for (const [k, v] of Object.entries(clientReq.headers)) {
				if (v) { reqHeaders[k] = Array.isArray(v) ? v.join(', ') : v; }
			}

			// Apply parameter overrides
			let upstreamBody = rawBody;
			if (parsedBody && Object.keys(this._overrides).length > 0) {
				if (this._overrides.model) parsedBody.model = this._overrides.model;
				if (this._overrides.max_tokens) parsedBody.max_tokens = this._overrides.max_tokens;
				upstreamBody = Buffer.from(JSON.stringify(parsedBody), 'utf-8');
			}

			// Wait for model to be loaded before starting capture timer
			const modelId = parsedBody?.model;
			if (modelId && path.includes('/chat/completions')) {
				this._waitForModelLoaded(modelId).then((wasLoading) => {
					if (wasLoading) {
						console.log(`[proxy] Model ${modelId} loaded, starting inference timer`);
					}
					this._forwardRequest(method, path, reqHeaders, parsedBody, upstreamBody, clientRes);
				}).catch(() => {
					// If model status check fails, proceed anyway
					this._forwardRequest(method, path, reqHeaders, parsedBody, upstreamBody, clientRes);
				});
			} else {
				this._forwardRequest(method, path, reqHeaders, parsedBody, upstreamBody, clientRes);
			}
		});
	}

	private async _waitForModelLoaded(modelId: string): Promise<boolean> {
		const url = new URL(`/api/v0/models/${modelId}`, this._config.upstreamUrl);
		let wasLoading = false;

		for (let i = 0; i < 60; i++) { // Max 60 seconds wait
			try {
				const status = await new Promise<any>((resolve, reject) => {
					http.get(url, (res) => {
						let body = '';
						res.on('data', (c: Buffer) => body += c);
						res.on('end', () => {
							try { resolve(JSON.parse(body)); } catch { reject(); }
						});
					}).on('error', reject);
				});
				if (status.state === 'loaded') return wasLoading;
				wasLoading = true;
				console.log(`[proxy] Waiting for model ${modelId} to load (state: ${status.state})...`);
			} catch {
				return false; // API not available, proceed without waiting
			}
			await new Promise(r => setTimeout(r, 500));
		}
		return wasLoading;
	}

	private _forwardRequest(
		method: string,
		path: string,
		reqHeaders: Record<string, string>,
		parsedBody: any,
		upstreamBody: Buffer,
		clientRes: http.ServerResponse,
	): void {
			// Start capture — timer begins HERE, after model is loaded
			const record = this._capture.startCapture(method, path, reqHeaders, parsedBody);

			// Build upstream request
			const upstream = new URL(path, this._config.upstreamUrl);
			const upstreamHeaders: Record<string, string> = { ...reqHeaders };
			delete upstreamHeaders['host'];
			// Update content-length if body was modified
			if (parsedBody && Object.keys(this._overrides).length > 0) {
				upstreamHeaders['content-length'] = String(upstreamBody.length);
			}

			const proxyReq = http.request(
				{
					hostname: upstream.hostname,
					port: upstream.port,
					path: upstream.pathname + upstream.search,
					method,
					headers: upstreamHeaders,
				},
				(proxyRes) => this._handleUpstreamResponse(proxyRes, clientRes, record),
			);

			proxyReq.on('error', (err) => {
				this._capture.completeCapture(record, err.message);
				if (!clientRes.headersSent) {
					clientRes.writeHead(502, { 'Content-Type': 'application/json' });
				}
				clientRes.end(JSON.stringify({ error: { message: `Upstream error: ${err.message}`, type: 'proxy_error' } }));
			});

			if (upstreamBody.length > 0) {
				proxyReq.write(upstreamBody);
			}
			proxyReq.end();
	}

	private _handleUpstreamResponse(
		proxyRes: http.IncomingMessage,
		clientRes: http.ServerResponse,
		record: ReturnType<RequestCapture['startCapture']>,
	): void {
		const statusCode = proxyRes.statusCode || 200;
		const contentType = (proxyRes.headers['content-type'] || '').toLowerCase();
		const isSSE = contentType.includes('text/event-stream');

		// Forward response headers
		const resHeaders: Record<string, string> = {};
		for (const [k, v] of Object.entries(proxyRes.headers)) {
			if (v) {
				const val = Array.isArray(v) ? v.join(', ') : v;
				resHeaders[k] = val;
				clientRes.setHeader(k, val);
			}
		}
		clientRes.writeHead(statusCode);

		if (isSSE) {
			// SSE streaming: pipe through passthrough for capture
			this._capture.markStreaming(record, statusCode, resHeaders);

			const passthrough = new SsePassthrough({
				onChunk: (raw, parsed) => {
					this._capture.addSseChunk(record, raw, parsed);
				},
				onDone: () => {
					record.tokenCount = passthrough.tokenCount;
					record.firstTokenAt = passthrough.firstTokenAt;
					this._capture.completeCapture(record);
					passthrough.dispose();
				},
			});

			proxyRes.pipe(passthrough).pipe(clientRes, { end: true });
		} else {
			// Non-streaming: buffer full response
			const chunks: Buffer[] = [];
			proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
			proxyRes.on('end', () => {
				const body = Buffer.concat(chunks).toString('utf-8');
				this._capture.markNonStreaming(record, statusCode, resHeaders, body);
				this._capture.completeCapture(record);
				clientRes.end(body);
			});
			proxyRes.on('error', (err) => {
				this._capture.completeCapture(record, err.message);
				clientRes.end();
			});
		}
	}

	stop(): Promise<void> {
		return new Promise((resolve) => {
			if (this._server) {
				this._server.close(() => resolve());
			} else {
				resolve();
			}
		});
	}
}
