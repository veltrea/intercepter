/*---------------------------------------------------------------------------------------------
 *  Shared type definitions - extracted from skosh-editor.
 *  Kept identical for back-portability.
 *--------------------------------------------------------------------------------------------*/

// --- ChatMessageRole (from vs/workbench/contrib/chat/common/languageModels.ts) ---

export const enum ChatMessageRole {
	System = 0,
	User = 1,
	Assistant = 2,
}

export interface IChatMessagePart {
	readonly type: string;
	readonly value: string;
}

export interface IChatMessage {
	readonly role: ChatMessageRole;
	readonly content: IChatMessagePart[];
}

// --- Node / Health (from skoshEventBus.ts, skoshEnvironmentManager.ts) ---

export enum NodeHealthState {
	Online = 'Online',
	Offline = 'Offline',
	RateLimited = 'RateLimited',
	Unreachable = 'Unreachable'
}

export enum ChatSessionState {
	Initializing = 'Initializing',
	Routing = 'Routing',
	LoadingModel = 'LoadingModel',
	Generating = 'Generating',
	Completed = 'Completed',
	Failed = 'Failed',
	Cancelled = 'Cancelled'
}

export interface IAIProviderNode {
	id: string;
	type: 'cloud' | 'local';
	providerType: string;
	providerUrl: string;
	capabilities: { models: string[]; supportVision?: boolean };
	availableModels?: string[];
	loadedModels: string[];
	healthStatus: NodeHealthState;
}

// --- Event (from skoshEventMonitor.ts) ---

export interface IVeltreaEvent {
	ts: number;
	level: 'info' | 'warn' | 'error' | 'ok';
	source: string;
	message: string;
	detail?: string;
}
