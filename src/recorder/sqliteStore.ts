/*---------------------------------------------------------------------------------------------
 *  SQLite persistent store for InterceptRecords and SSE chunks.
 *--------------------------------------------------------------------------------------------*/
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { InterceptRecord, ISseChunkRecord } from '../common/protocol.js';

export class SqliteStore {
	private readonly _db: Database.Database;

	constructor(dbPath?: string) {
		const path = dbPath ?? resolve(process.cwd(), 'interceptor.db');
		this._db = new Database(path);
		this._db.pragma('journal_mode = WAL');
		this._initSchema();
	}

	private _initSchema(): void {
		this._db.exec(`
			CREATE TABLE IF NOT EXISTS requests (
				id TEXT PRIMARY KEY,
				started_at INTEGER NOT NULL,
				completed_at INTEGER,
				method TEXT NOT NULL,
				path TEXT NOT NULL,
				request_headers TEXT,
				request_body TEXT,
				status_code INTEGER,
				response_headers TEXT,
				is_streaming INTEGER DEFAULT 0,
				full_response_body TEXT,
				first_token_at INTEGER,
				token_count INTEGER DEFAULT 0,
				tps REAL,
				latency_ms REAL,
				model TEXT,
				error TEXT
			);

			CREATE TABLE IF NOT EXISTS sse_chunks (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				request_id TEXT NOT NULL,
				ts INTEGER NOT NULL,
				raw TEXT NOT NULL,
				content TEXT,
				reasoning TEXT,
				FOREIGN KEY (request_id) REFERENCES requests(id)
			);

			CREATE INDEX IF NOT EXISTS idx_chunks_request_id ON sse_chunks(request_id);
			CREATE INDEX IF NOT EXISTS idx_requests_started_at ON requests(started_at);
		`);
	}

	saveRequest(record: InterceptRecord): void {
		const stmt = this._db.prepare(`
			INSERT OR REPLACE INTO requests
			(id, started_at, completed_at, method, path, request_headers, request_body,
			 status_code, response_headers, is_streaming, full_response_body,
			 first_token_at, token_count, tps, latency_ms, model, error)
			VALUES
			(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		stmt.run(
			record.id,
			record.startedAt,
			record.completedAt ?? null,
			record.method,
			record.path,
			JSON.stringify(record.requestHeaders),
			record.requestBody ? JSON.stringify(record.requestBody) : null,
			record.statusCode ?? null,
			record.responseHeaders ? JSON.stringify(record.responseHeaders) : null,
			record.isStreaming ? 1 : 0,
			record.fullResponseBody ?? null,
			record.firstTokenAt ?? null,
			record.tokenCount,
			record.tps ?? null,
			record.latencyMs ?? null,
			record.model ?? null,
			record.error ?? null,
		);
	}

	saveSseChunk(requestId: string, chunk: ISseChunkRecord): void {
		const stmt = this._db.prepare(`
			INSERT INTO sse_chunks (request_id, ts, raw, content, reasoning)
			VALUES (?, ?, ?, ?, ?)
		`);
		stmt.run(
			requestId,
			chunk.ts,
			chunk.raw,
			chunk.parsed?.content ?? null,
			chunk.parsed?.reasoning ?? null,
		);
	}

	getRecentRequests(limit: number = 20): any[] {
		return this._db.prepare(
			`SELECT id, started_at, completed_at, method, path, status_code,
			        is_streaming, token_count, tps, latency_ms, model, error,
			        request_body
			 FROM requests ORDER BY started_at DESC LIMIT ?`
		).all(limit);
	}

	getRequestById(id: string): any | undefined {
		const row = this._db.prepare(
			'SELECT * FROM requests WHERE id = ?'
		).get(id) as any;
		if (!row) return undefined;
		// Parse JSON fields
		if (row.request_headers) row.request_headers = JSON.parse(row.request_headers);
		if (row.request_body) row.request_body = JSON.parse(row.request_body);
		if (row.response_headers) row.response_headers = JSON.parse(row.response_headers);
		row.chunks = this.getChunksForRequest(id);
		return row;
	}

	searchRequests(filter: { model?: string; method?: string; after?: number; before?: number; limit?: number }): any[] {
		const conditions: string[] = [];
		const params: any[] = [];
		if (filter.model) { conditions.push('model LIKE ?'); params.push(`%${filter.model}%`); }
		if (filter.method) { conditions.push('method = ?'); params.push(filter.method); }
		if (filter.after) { conditions.push('started_at >= ?'); params.push(filter.after); }
		if (filter.before) { conditions.push('started_at <= ?'); params.push(filter.before); }
		const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
		const limit = filter.limit ?? 50;
		return this._db.prepare(
			`SELECT id, started_at, completed_at, method, path, status_code,
			        is_streaming, token_count, tps, latency_ms, model, error
			 FROM requests ${where} ORDER BY started_at DESC LIMIT ?`
		).all(...params, limit);
	}

	getChunksForRequest(requestId: string): ISseChunkRecord[] {
		const rows = this._db.prepare(
			'SELECT ts, raw, content, reasoning FROM sse_chunks WHERE request_id = ? ORDER BY ts'
		).all(requestId) as Array<{ ts: number; raw: string; content: string | null; reasoning: string | null }>;

		return rows.map(r => ({
			ts: r.ts,
			raw: r.raw,
			parsed: {
				content: r.content ?? undefined,
				reasoning: r.reasoning ?? undefined,
			},
		}));
	}

	dispose(): void {
		this._db.close();
	}
}
