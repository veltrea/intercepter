/*---------------------------------------------------------------------------------------------
 *  Standalone EventBus - adapted from skoshEventBus.ts.
 *  Removed: createDecorator, VS Code Disposable, _serviceBrand.
 *  Preserved: all publish/on method signatures.
 *--------------------------------------------------------------------------------------------*/
import { Emitter, Event } from './emitter.js';
import { NodeHealthState, ChatSessionState } from './types.js';

// --- Event payload definitions (identical to original) ---

export interface INodeStatePayload {
	nodeId: string;
	state: NodeHealthState;
}

export interface ISessionStatePayload {
	sessionId: string;
	state: ChatSessionState;
}

export interface IStreamChunkPayload {
	sessionId: string;
	chunk: string;
}

export interface IErrorPayload {
	context: string;
	error: Error;
}

export interface ICustomEventPayload {
	eventName: string;
	payload: any;
}

export interface INodeDiscoveredPayload {
	id: string;
	providerUrl: string;
	providerType: string;
	healthStatus: NodeHealthState;
	availableModels: string[];
	loadedModels: string[];
}

// --- EventBus interface ---

export interface IVeltreaEventBus {
	readonly onNodeStateChanged: Event<INodeStatePayload>;
	readonly onSessionStateChanged: Event<ISessionStatePayload>;
	readonly onStreamChunkReceived: Event<IStreamChunkPayload>;
	readonly onError: Event<IErrorPayload>;
	readonly onCustomEvent: Event<ICustomEventPayload>;
	readonly onNodeDiscovered: Event<INodeDiscoveredPayload>;

	publishNodeState(nodeId: string, state: NodeHealthState): void;
	publishSessionState(sessionId: string, state: ChatSessionState): void;
	publishStreamChunk(sessionId: string, chunk: string): void;
	publishError(context: string, error: Error): void;
	publishCustom(eventName: string, payload: any): void;
	publishNodeDiscovered(payload: INodeDiscoveredPayload): void;
	dispose(): void;
}

// --- Implementation ---

export class VeltreaEventBusImpl implements IVeltreaEventBus {
	private readonly _onNodeStateChanged = new Emitter<INodeStatePayload>();
	public readonly onNodeStateChanged = this._onNodeStateChanged.event;

	private readonly _onSessionStateChanged = new Emitter<ISessionStatePayload>();
	public readonly onSessionStateChanged = this._onSessionStateChanged.event;

	private readonly _onStreamChunkReceived = new Emitter<IStreamChunkPayload>();
	public readonly onStreamChunkReceived = this._onStreamChunkReceived.event;

	private readonly _onError = new Emitter<IErrorPayload>();
	public readonly onError = this._onError.event;

	private readonly _onCustomEvent = new Emitter<ICustomEventPayload>();
	public readonly onCustomEvent = this._onCustomEvent.event;

	private readonly _onNodeDiscovered = new Emitter<INodeDiscoveredPayload>();
	public readonly onNodeDiscovered = this._onNodeDiscovered.event;

	publishNodeState(nodeId: string, state: NodeHealthState): void {
		this._onNodeStateChanged.fire({ nodeId, state });
	}
	publishSessionState(sessionId: string, state: ChatSessionState): void {
		this._onSessionStateChanged.fire({ sessionId, state });
	}
	publishStreamChunk(sessionId: string, chunk: string): void {
		this._onStreamChunkReceived.fire({ sessionId, chunk });
	}
	publishError(context: string, error: Error): void {
		this._onError.fire({ context, error });
	}
	publishCustom(eventName: string, payload: any): void {
		this._onCustomEvent.fire({ eventName, payload });
	}
	publishNodeDiscovered(payload: INodeDiscoveredPayload): void {
		this._onNodeDiscovered.fire(payload);
	}

	dispose(): void {
		this._onNodeStateChanged.dispose();
		this._onSessionStateChanged.dispose();
		this._onStreamChunkReceived.dispose();
		this._onError.dispose();
		this._onCustomEvent.dispose();
		this._onNodeDiscovered.dispose();
	}
}
