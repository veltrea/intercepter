/*---------------------------------------------------------------------------------------------
 *  WebSocket broadcast handler + RPC query handler.
 *  Subscribes to EventBus + StreamRecorder and broadcasts to all connected clients.
 *  Also handles request-response queries from MCP and other clients.
 *--------------------------------------------------------------------------------------------*/
import { WebSocketServer, WebSocket } from 'ws';
import { IVeltreaEventBus } from '../common/eventBus.js';
import { StreamRecorder } from '../recorder/streamRecorder.js';
import { MetricsCollector } from '../recorder/metricsCollector.js';
import { SqliteStore } from '../recorder/sqliteStore.js';
import { IDisposable } from '../common/emitter.js';

export interface RpcServices {
	sqliteStore: SqliteStore;
	getOverrides: () => any;
	setOverrides: (overrides: any) => void;
	clearOverrides: () => void;
}

export class WsHandler {
	private readonly _clients = new Set<WebSocket>();
	private readonly _disposables: IDisposable[] = [];
	private _rpcServices: RpcServices | undefined;

	constructor(
		private readonly _wss: WebSocketServer,
		private readonly _eventBus: IVeltreaEventBus,
		private readonly _recorder: StreamRecorder,
		private readonly _metrics: MetricsCollector,
	) {
		this._wss.on('connection', (ws) => {
			this._clients.add(ws);
			// Send current state on connect
			this._sendTo(ws, {
				type: 'init',
				records: this._recorder.getRecords(),
				metrics: this._metrics.getMetrics(),
			});
			ws.on('message', (data) => this._handleMessage(ws, data.toString()));
			ws.on('close', () => this._clients.delete(ws));
		});

		// Subscribe to recorder events
		this._disposables.push(
			this._recorder.onRecordStarted(record => {
				this._broadcast({ type: 'intercept_start', record });
			}),
			this._recorder.onRecordUpdated(record => {
				this._broadcast({
					type: 'sse_chunk',
					interceptId: record.id,
					chunk: record.sseChunks[record.sseChunks.length - 1],
					tokenCount: record.tokenCount,
				});
			}),
			this._recorder.onRecordCompleted(record => {
				this._broadcast({
					type: 'intercept_complete',
					record,
					metrics: this._metrics.getMetrics(),
				});
			}),
		);

		// Subscribe to custom events for general event stream
		this._disposables.push(
			this._eventBus.onCustomEvent(evt => {
				this._broadcast({ type: 'event', event: evt });
			}),
			this._eventBus.onError(err => {
				this._broadcast({ type: 'error', context: err.context, message: err.error.message });
			}),
		);
	}

	setRpcServices(services: RpcServices): void {
		this._rpcServices = services;
	}

	private _handleMessage(ws: WebSocket, raw: string): void {
		let msg: any;
		try { msg = JSON.parse(raw); } catch { return; }

		if (msg.type === 'query' || msg.type === 'command') {
			const result = this._handleRpc(msg);
			this._sendTo(ws, { id: msg.id, type: 'response', ...result });
		}

		// UI control commands — broadcast to all GUI clients
		if (msg.type === 'ui_command') {
			this._broadcast({ type: 'ui_command', action: msg.action, params: msg.params });
		}
	}

	private _handleRpc(msg: any): { result?: any; error?: string } {
		if (!this._rpcServices) {
			return { error: 'RPC services not initialized' };
		}
		const s = this._rpcServices;

		try {
			switch (msg.method) {
				// --- Queries ---
				case 'getRecentRequests':
					return { result: s.sqliteStore.getRecentRequests(msg.params?.limit ?? 20) };

				case 'getRequestById':
					if (!msg.params?.id) return { error: 'Missing param: id' };
					return { result: s.sqliteStore.getRequestById(msg.params.id) };

				case 'getChunksForRequest':
					if (!msg.params?.requestId) return { error: 'Missing param: requestId' };
					return { result: s.sqliteStore.getChunksForRequest(msg.params.requestId) };

				case 'getMetrics':
					return { result: this._metrics.getMetrics() };

				case 'searchRequests':
					return { result: s.sqliteStore.searchRequests(msg.params ?? {}) };

				// --- Parameter overrides ---
				case 'setOverrides':
					s.setOverrides(msg.params ?? {});
					return { result: s.getOverrides() };

				case 'getOverrides':
					return { result: s.getOverrides() };

				case 'clearOverrides':
					s.clearOverrides();
					return { result: {} };

				default:
					return { error: `Unknown method: ${msg.method}` };
			}
		} catch (e: any) {
			return { error: e.message };
		}
	}

	private _broadcast(data: any): void {
		const json = JSON.stringify(data);
		for (const client of this._clients) {
			if (client.readyState === WebSocket.OPEN) {
				client.send(json);
			}
		}
	}

	private _sendTo(ws: WebSocket, data: any): void {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(data));
		}
	}

	dispose(): void {
		for (const d of this._disposables) { d.dispose(); }
		this._clients.clear();
	}
}
