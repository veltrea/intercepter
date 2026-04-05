/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Veltrea Project (veltrea/user). All rights reserved.
 *  This code is part of the Veltrea AI-Native IDE project.
 *--------------------------------------------------------------------------------------------*/
import { IChatMessage } from '../common/types.js';
import { Emitter } from '../common/emitter.js';

export interface IVeltreaProviderAdapter {
    buildRequest(messages: IChatMessage[], modelId: string, maxTokens: number): any;
    getRequestOptions(apiKey: string): { url: string; headers: Record<string, string> };
    parseStreamChunk(
        chunk: string,
        onUpdate: Emitter<string>,
        onReasoningUpdate: Emitter<string>,
        buffer: { value: string }
    ): void;
    parseFullResponse(responseText: string): { content?: string, reasoning?: string };
}
