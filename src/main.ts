/*---------------------------------------------------------------------------------------------
 *  Veltrea Interceptor - main entry point.
 *  Starts proxy server (IDE <-> LM Studio) and dashboard UI server.
 *--------------------------------------------------------------------------------------------*/
import { loadConfig } from './config.js';
import { VeltreaEventBusImpl } from './common/eventBus.js';
import { StreamRecorder } from './recorder/streamRecorder.js';
import { MetricsCollector } from './recorder/metricsCollector.js';
import { RequestCapture } from './proxy/requestCapture.js';
import { ProxyServer } from './proxy/proxyServer.js';
import { UiServer } from './ui/uiServer.js';
import { WsHandler } from './ui/wsHandler.js';
import { SqliteStore } from './recorder/sqliteStore.js';

async function main() {
	const config = loadConfig();

	console.log('─────────────────────────────────────────────');
	console.log('  Veltrea Interceptor');
	console.log(`  Proxy:     :${config.proxyPort} -> ${config.upstreamUrl}`);
	console.log(`  Dashboard: :${config.uiPort}`);
	console.log('─────────────────────────────────────────────');

	// Core services
	const eventBus = new VeltreaEventBusImpl();
	const recorder = new StreamRecorder(config.maxRecordedSessions);
	const metrics = new MetricsCollector(recorder);
	const sqliteStore = new SqliteStore();
	const capture = new RequestCapture(recorder, eventBus);

	// Persist to SQLite
	recorder.onRecordStarted(record => {
		sqliteStore.saveRequest(record);
	});
	recorder.onRecordUpdated(record => {
		const lastChunk = record.sseChunks[record.sseChunks.length - 1];
		if (lastChunk) {
			sqliteStore.saveSseChunk(record.id, lastChunk);
		}
	});
	recorder.onRecordCompleted(record => {
		sqliteStore.saveRequest(record);
	});

	// Proxy server
	const proxy = new ProxyServer(config, capture);

	// UI server
	const ui = new UiServer(config);

	try {
		await ui.start();
		// Wire WebSocket handler after UI server is ready
		const wsHandler = new WsHandler(ui.wss!, eventBus, recorder, metrics);

		// Wire RPC services for MCP and other clients
		wsHandler.setRpcServices({
			sqliteStore,
			getOverrides: () => proxy.getOverrides(),
			setOverrides: (o) => proxy.setOverrides(o),
			clearOverrides: () => proxy.clearOverrides(),
		});

		await proxy.start();

		console.log('[main] Ready. Configure your IDE endpoint to http://localhost:' + config.proxyPort);
	} catch (err) {
		console.error('[main] Failed to start:', err);
		process.exit(1);
	}

	// Graceful shutdown
	const shutdown = async () => {
		console.log('\n[main] Shutting down...');
		await proxy.stop();
		await ui.stop();
		eventBus.dispose();
		recorder.dispose();
		sqliteStore.dispose();
		process.exit(0);
	};

	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}

main();
