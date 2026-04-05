/*---------------------------------------------------------------------------------------------
 *  StreamRecorder - stores InterceptRecords with circular buffer.
 *--------------------------------------------------------------------------------------------*/
import { InterceptRecord } from '../common/protocol.js';
import { Emitter, Event } from '../common/emitter.js';

export class StreamRecorder {
	private readonly _records: InterceptRecord[] = [];
	private readonly _maxRecords: number;

	private readonly _onRecordStarted = new Emitter<InterceptRecord>();
	public readonly onRecordStarted: Event<InterceptRecord> = this._onRecordStarted.event;

	private readonly _onRecordUpdated = new Emitter<InterceptRecord>();
	public readonly onRecordUpdated: Event<InterceptRecord> = this._onRecordUpdated.event;

	private readonly _onRecordCompleted = new Emitter<InterceptRecord>();
	public readonly onRecordCompleted: Event<InterceptRecord> = this._onRecordCompleted.event;

	constructor(maxRecords: number = 100) {
		this._maxRecords = maxRecords;
	}

	start(record: InterceptRecord): void {
		this._records.push(record);
		if (this._records.length > this._maxRecords) {
			this._records.shift();
		}
		this._onRecordStarted.fire(record);
	}

	update(record: InterceptRecord): void {
		this._onRecordUpdated.fire(record);
	}

	complete(record: InterceptRecord): void {
		record.completedAt = Date.now();
		if (record.firstTokenAt && record.tokenCount > 0) {
			const genDuration = (record.completedAt - record.firstTokenAt) / 1000;
			record.tps = genDuration > 0 ? record.tokenCount / genDuration : 0;
			record.latencyMs = record.firstTokenAt - record.startedAt;
		}
		this._onRecordCompleted.fire(record);
	}

	getRecords(): readonly InterceptRecord[] {
		return this._records;
	}

	getById(id: string): InterceptRecord | undefined {
		return this._records.find(r => r.id === id);
	}

	dispose(): void {
		this._onRecordStarted.dispose();
		this._onRecordUpdated.dispose();
		this._onRecordCompleted.dispose();
	}
}
