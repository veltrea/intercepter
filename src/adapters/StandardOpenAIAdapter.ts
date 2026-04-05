/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Veltrea Project. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../common/emitter.js';
import { IChatMessage, ChatMessageRole } from '../common/types.js';
import { IVeltreaProviderAdapter } from './IVeltreaProviderAdapter.js';

// -- OpenAI SSE response types -----------------------------------------------

interface OpenAIStreamDelta {
    content?: string | null;
    reasoning_content?: string | null;
    role?: string;
}

interface OpenAIStreamChoice {
    delta: OpenAIStreamDelta;
    index: number;
    finish_reason: string | null;
}

interface OpenAIStreamChunk {
    id: string;
    object: string;
    choices: OpenAIStreamChoice[];
}

// -- Provider name -----------------------------------------------------------

export type StandardOpenAIProviderName = 'openai' | 'z.ai' | 'openrouter';

// -- Adapter -----------------------------------------------------------------

export class StandardOpenAIAdapter implements IVeltreaProviderAdapter {

    constructor(private readonly providerName: StandardOpenAIProviderName) { }

    buildRequest(messages: IChatMessage[], modelId: string, maxTokens: number): object {
        return {
            model: modelId,
            messages: messages.map(m => ({
                role: this._mapRole(m.role),
                content: m.content.map((c: any) => c.type === 'text' ? c.value : '').join('')
            })),
            max_tokens: maxTokens,
            stream: true
        };
    }

    getRequestOptions(apiKey: string): { url: string; headers: Record<string, string> } {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'Authorization': `Bearer ${apiKey}`
        };

        switch (this.providerName) {
            case 'openai':
                return { url: 'https://api.openai.com/v1/chat/completions', headers };
            case 'z.ai':
                return { url: 'https://api.z.ai/api/paas/v4/chat/completions', headers };
            case 'openrouter':
                headers['HTTP-Referer'] = 'https://github.com/microsoft/vscode';
                headers['X-Title'] = 'Veltrea Copilot';
                return { url: 'https://openrouter.ai/api/v1/chat/completions', headers };
        }
    }

    parseStreamChunk(
        chunk: string,
        onUpdate: Emitter<string>,
        onReasoningUpdate: Emitter<string>,
        buffer: { value: string }
    ): void {
        buffer.value += chunk;
        const lines = buffer.value.split('\n');
        buffer.value = lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) { continue; }

            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') { continue; }

            let parsed: OpenAIStreamChunk;
            try {
                parsed = JSON.parse(dataStr) as OpenAIStreamChunk;
            } catch {
                continue;
            }

            const choice = parsed.choices?.[0];
            if (!choice) { continue; }

            const delta = choice.delta;
            if (delta.content) {
                const cleanContent = this._sanitizeProtocolMarkers(delta.content);
                if (cleanContent) {
                    onUpdate.fire(cleanContent);
                }
            }
            if (delta.reasoning_content) {
                onReasoningUpdate.fire(delta.reasoning_content);
            }
        }
    }

    private _sanitizeProtocolMarkers(content: string): string {
        const cleaned = content.replace(/<\|[^|]*\|?>/g, '');
        return cleaned || '';
    }

    parseFullResponse(responseText: string): { content?: string, reasoning?: string } {
        try {
            const parsed = JSON.parse(responseText);
            const choice = parsed.choices?.[0];
            if (!choice || !choice.message) {
                return {};
            }
            return {
                content: choice.message.content || undefined,
                reasoning: choice.message.reasoning_content || undefined
            };
        } catch (e) {
            console.error('Failed to parse full OpenAI response:', e);
            return {};
        }
    }

    private _mapRole(role: ChatMessageRole): 'user' | 'assistant' | 'system' {
        if (role === ChatMessageRole.Assistant) return 'assistant';
        if (role === ChatMessageRole.System) return 'system';
        return 'user';
    }
}
