/*---------------------------------------------------------------------------------------------
 *  SSE Passthrough - Transform stream that taps SSE chunks without modifying them.
 *  Bytes pass through transparently to the downstream client while parsed tokens
 *  are emitted via callbacks for capture/display.
 *--------------------------------------------------------------------------------------------*/
import { Transform, TransformCallback } from 'node:stream';
import { Emitter } from '../common/emitter.js';
import { StandardOpenAIAdapter } from '../adapters/StandardOpenAIAdapter.js';
import { ISseChunkRecord } from '../common/protocol.js';

export interface SsePassthroughCallbacks {
	onChunk(raw: string, parsed: { content?: string; reasoning?: string }): void;
	onDone(): void;
}

export class SsePassthrough extends Transform {
	private readonly _adapter = new StandardOpenAIAdapter('openai');
	private readonly _onUpdate = new Emitter<string>();
	private readonly _onReasoning = new Emitter<string>();
	private readonly _buffer = { value: '' };
	private readonly _callbacks: SsePassthroughCallbacks;
	private readonly _chunks: ISseChunkRecord[] = [];
	private _tokenCount = 0;
	private _firstTokenAt: number | undefined;

	constructor(callbacks: SsePassthroughCallbacks) {
		super();
		this._callbacks = callbacks;

		this._onUpdate.event((text) => {
			if (!this._firstTokenAt) {
				this._firstTokenAt = Date.now();
			}
			this._tokenCount++;
		});
	}

	override _transform(chunk: Buffer, _encoding: string, callback: TransformCallback): void {
		// Pass bytes through unmodified
		this.push(chunk);

		// Tap: decode and parse for capture
		const text = chunk.toString('utf-8');
		const capturedContent: string[] = [];
		const capturedReasoning: string[] = [];

		const contentSub = this._onUpdate.event(t => capturedContent.push(t));
		const reasoningSub = this._onReasoning.event(t => capturedReasoning.push(t));

		this._adapter.parseStreamChunk(text, this._onUpdate, this._onReasoning, this._buffer);

		contentSub.dispose();
		reasoningSub.dispose();

		const parsed = {
			content: capturedContent.length > 0 ? capturedContent.join('') : undefined,
			reasoning: capturedReasoning.length > 0 ? capturedReasoning.join('') : undefined,
		};

		this._chunks.push({ ts: Date.now(), raw: text, parsed });
		this._callbacks.onChunk(text, parsed);

		callback();
	}

	override _flush(callback: TransformCallback): void {
		this._callbacks.onDone();
		callback();
	}

	get chunks(): readonly ISseChunkRecord[] { return this._chunks; }
	get tokenCount(): number { return this._tokenCount; }
	get firstTokenAt(): number | undefined { return this._firstTokenAt; }

	dispose(): void {
		this._onUpdate.dispose();
		this._onReasoning.dispose();
	}
}
