/*---------------------------------------------------------------------------------------------
 *  MetricsCollector - aggregates TPS, latency, token counts across sessions.
 *--------------------------------------------------------------------------------------------*/
import { StreamRecorder } from './streamRecorder.js';

export interface AggregateMetrics {
	totalRequests: number;
	totalTokens: number;
	avgTps: number;
	avgLatencyMs: number;
	lastRequestAt?: number;
}

export class MetricsCollector {
	constructor(private readonly _recorder: StreamRecorder) { }

	getMetrics(): AggregateMetrics {
		const records = this._recorder.getRecords();
		const completed = records.filter(r => r.completedAt && !r.error);

		if (completed.length === 0) {
			return { totalRequests: records.length, totalTokens: 0, avgTps: 0, avgLatencyMs: 0 };
		}

		const totalTokens = completed.reduce((sum, r) => sum + r.tokenCount, 0);
		const tpsValues = completed.filter(r => r.tps && r.tps > 0).map(r => r.tps!);
		const latencyValues = completed.filter(r => r.latencyMs !== undefined).map(r => r.latencyMs!);

		return {
			totalRequests: records.length,
			totalTokens,
			avgTps: tpsValues.length > 0 ? tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length : 0,
			avgLatencyMs: latencyValues.length > 0 ? latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length : 0,
			lastRequestAt: completed[completed.length - 1]?.completedAt,
		};
	}
}
