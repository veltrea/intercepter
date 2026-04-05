/*---------------------------------------------------------------------------------------------
 *  UI Server - serves dashboard HTML and handles WebSocket upgrade.
 *--------------------------------------------------------------------------------------------*/
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { WebSocketServer } from 'ws';
import { InterceptorConfig } from '../config.js';

export class UiServer {
	private _server: http.Server | undefined;
	public wss: WebSocketServer | undefined;

	constructor(private readonly _config: InterceptorConfig) { }

	start(): Promise<void> {
		return new Promise((resolve, reject) => {
			this._server = http.createServer((req, res) => {
				// Serve dashboard HTML
				if (req.url === '/' || req.url === '/index.html') {
					const htmlPath = path.resolve(import.meta.dirname, 'public', 'index.html');
					try {
						const html = fs.readFileSync(htmlPath, 'utf-8');
						res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
						res.end(html);
					} catch {
						res.writeHead(500);
						res.end('Dashboard HTML not found');
					}
				} else {
					res.writeHead(404);
					res.end('Not found');
				}
			});

			this.wss = new WebSocketServer({ server: this._server });

			this._server.on('error', reject);
			this._server.listen(this._config.uiPort, () => {
				console.log(`[ui] Dashboard at http://localhost:${this._config.uiPort}`);
				resolve();
			});
		});
	}

	stop(): Promise<void> {
		return new Promise((resolve) => {
			this.wss?.close();
			if (this._server) {
				this._server.close(() => resolve());
			} else {
				resolve();
			}
		});
	}
}
