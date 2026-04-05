/*---------------------------------------------------------------------------------------------
 *  RequestCapture - creates and manages InterceptRecord lifecycle.
 *--------------------------------------------------------------------------------------------*/
import { InterceptRecord, createInterceptRecord } from '../common/protocol.js';
import { StreamRecorder } from '../recorder/streamRecorder.js';
import { IVeltreaEventBus } from '../common/eventBus.js';
import { ChatSessionState } from '../common/types.js';

export class RequestCapture {
	constructor(
		private readonly _recorder: StreamRecorder,
		private readonly _eventBus: IVeltreaEventBus,
	) { }

	startCapture(method: string, path: string, headers: Record<string, string>, body?: any): InterceptRecord {
		const record = createInterceptRecord(method, path, headers, body);
		this._recorder.start(record);
		this._eventBus.publishSessionState(record.id, ChatSessionState.Initializing);
		this._eventBus.publishCustom('intercept_start', {
			level: 'info',
			source: 'RequestCapture',
			message: `${method} ${path}`,
			detail: record.model ? `model: ${record.model}` : undefined,
		});
		return record;
	}

	markStreaming(record: InterceptRecord, statusCode: number, headers: Record<string, string>): void {
		record.isStreaming = true;
		record.statusCode = statusCode;
		record.responseHeaders = headers;
		this._eventBus.publishSessionState(record.id, ChatSessionState.Generating);
	}

	markNonStreaming(record: InterceptRecord, statusCode: number, headers: Record<string, string>, body: string): void {
		record.isStreaming = false;
		record.statusCode = statusCode;
		record.responseHeaders = headers;
		record.fullResponseBody = body;
	}

	addSseChunk(record: InterceptRecord, raw: string, parsed: { content?: string; reasoning?: string }): void {
		record.sseChunks.push({ ts: Date.now(), raw, parsed });
		if (parsed.content) {
			if (!record.firstTokenAt) {
				record.firstTokenAt = Date.now();
			}
			record.tokenCount++;
			this._eventBus.publishStreamChunk(record.id, parsed.content);
		}
		this._recorder.update(record);
	}

	completeCapture(record: InterceptRecord, error?: string): void {
		if (error) {
			record.error = error;
			this._eventBus.publishSessionState(record.id, ChatSessionState.Failed);
			this._eventBus.publishCustom('intercept_error', {
				level: 'error',
				source: 'RequestCapture',
				message: `${record.method} ${record.path} failed`,
				detail: error,
			});
		} else {
			this._eventBus.publishSessionState(record.id, ChatSessionState.Completed);
			const tps = record.tps ? record.tps.toFixed(1) : '-';
			const latency = record.latencyMs !== undefined ? `${record.latencyMs}ms` : '-';
			this._eventBus.publishCustom('intercept_complete', {
				level: 'ok',
				source: 'RequestCapture',
				message: `${record.method} ${record.path} completed`,
				detail: `tokens: ${record.tokenCount}, TPS: ${tps}, latency: ${latency}`,
			});
		}
		this._recorder.complete(record);
	}
}
