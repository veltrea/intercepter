/*---------------------------------------------------------------------------------------------
 *  Standalone Emitter - VS Code Emitter<T> compatible replacement.
 *  Original: vs/base/common/event.ts
 *--------------------------------------------------------------------------------------------*/

export interface IDisposable {
	dispose(): void;
}

export type Event<T> = (listener: (e: T) => void) => IDisposable;

export class Emitter<T> {
	private _listeners = new Set<(e: T) => void>();
	private _disposed = false;

	get event(): Event<T> {
		return (listener: (e: T) => void): IDisposable => {
			if (this._disposed) {
				return { dispose: () => { } };
			}
			this._listeners.add(listener);
			return {
				dispose: () => { this._listeners.delete(listener); }
			};
		};
	}

	fire(value: T): void {
		if (this._disposed) { return; }
		for (const listener of this._listeners) {
			try { listener(value); } catch (e) { console.error('[Emitter] listener error:', e); }
		}
	}

	dispose(): void {
		this._disposed = true;
		this._listeners.clear();
	}
}
