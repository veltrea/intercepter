/*---------------------------------------------------------------------------------------------
 *  InterceptRecord - captures a single proxied request/response cycle.
 *--------------------------------------------------------------------------------------------*/

export interface ISseChunkRecord {
	ts: number;
	raw: string;
	parsed?: {
		content?: string;
		reasoning?: string;
	};
}

export interface InterceptRecord {
	id: string;
	startedAt: number;
	completedAt?: number;

	// Request
	method: string;
	path: string;
	requestHeaders: Record<string, string>;
	requestBody?: any;

	// Response
	statusCode?: number;
	responseHeaders?: Record<string, string>;
	isStreaming: boolean;

	// SSE capture
	sseChunks: ISseChunkRecord[];
	fullResponseBody?: string;

	// Metrics
	firstTokenAt?: number;
	tokenCount: number;
	tps?: number;
	latencyMs?: number;

	// Model info (extracted from request body)
	model?: string;
	error?: string;
}

let _nextId = 0;

export function createInterceptRecord(method: string, path: string, headers: Record<string, string>, body?: any): InterceptRecord {
	return {
		id: `req-${Date.now()}-${_nextId++}`,
		startedAt: Date.now(),
		method,
		path,
		requestHeaders: headers,
		requestBody: body,
		isStreaming: false,
		sseChunks: [],
		tokenCount: 0,
		model: body?.model,
	};
}
