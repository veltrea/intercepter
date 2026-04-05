/*---------------------------------------------------------------------------------------------
 *  Configuration loader.
 *--------------------------------------------------------------------------------------------*/
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface InterceptorConfig {
	proxyPort: number;
	uiPort: number;
	upstreamUrl: string;
	maxRecordedSessions: number;
	logLevel: 'debug' | 'info' | 'warn' | 'error';
}

const DEFAULTS: InterceptorConfig = {
	proxyPort: 5555,
	uiPort: 5556,
	upstreamUrl: 'http://localhost:1234',
	maxRecordedSessions: 100,
	logLevel: 'info',
};

export function loadConfig(): InterceptorConfig {
	const configPath = resolve(process.cwd(), 'interceptor.config.json');
	let config = { ...DEFAULTS };
	if (existsSync(configPath)) {
		try {
			const raw = readFileSync(configPath, 'utf-8');
			const parsed = JSON.parse(raw);
			config = { ...config, ...parsed };
		} catch (e) {
			console.warn('[config] Failed to parse config file, using defaults:', e);
		}
	}
	// Environment variable overrides
	if (process.env.PROXY_PORT) config.proxyPort = Number(process.env.PROXY_PORT);
	if (process.env.UPSTREAM) config.upstreamUrl = process.env.UPSTREAM;
	if (process.env.UI_PORT) config.uiPort = Number(process.env.UI_PORT);
	return config;
}
