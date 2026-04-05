/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Veltrea Project (veltrea/user). All rights reserved.
 *  This code is part of the Veltrea AI-Native IDE project.
 *--------------------------------------------------------------------------------------------*/
import { IVeltreaProviderAdapter } from './IVeltreaProviderAdapter.js';
import { IChatMessage, ChatMessageRole } from '../common/types.js';
import { Emitter } from '../common/emitter.js';

export class AnthropicClaudeAdapter implements IVeltreaProviderAdapter {

    buildRequest(messages: IChatMessage[], modelId: string, maxTokens: number): any {
        const systemMessage = messages.find(m => m.role === ChatMessageRole.System);
        const userAndAssistantMsgs = messages.filter(m => m.role !== ChatMessageRole.System);

        const payload: any = {
            model: modelId,
            max_tokens: maxTokens,
            messages: userAndAssistantMsgs.map(m => ({
                role: m.role,
                content: m.content.map(c => c.type === 'text' ? c.value : '').join('')
            })),
            stream: true
        };

        if (systemMessage) {
            payload.system = systemMessage.content.map(c => c.type === 'text' ? c.value : '').join('');
        }

        return payload;
    }

    getRequestOptions(apiKey: string): { url: string; headers: Record<string, string> } {
        return {
            url: 'https://api.anthropic.com/v1/messages',
            headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
                'accept': 'text/event-stream'
            }
        };
    }

    parseStreamChunk(chunk: string, onUpdate: Emitter<string>, onReasoningUpdate: Emitter<string>, buffer: { value: string }): void {
        buffer.value += chunk;
        const lines = buffer.value.split('\n');
        buffer.value = lines.pop() || '';

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('data: ')) {
                const dataString = trimmedLine.substring(6);
                if (dataString === '[DONE]') { continue; }
                try {
                    const parsed = JSON.parse(dataString);
                    if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.type === 'text_delta') {
                        if (parsed.delta.text) {
                            const cleanText = this._sanitizeProtocolMarkers(parsed.delta.text);
                            if (cleanText) {
                                onUpdate.fire(cleanText);
                            }
                        }
                    }
                } catch {
                    // Ignore incomplete packets
                }
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
            if (parsed.content && Array.isArray(parsed.content)) {
                const textBlocks = parsed.content.filter((c: any) => c.type === 'text');
                return {
                    content: textBlocks.map((c: any) => c.text).join('') || undefined
                };
            }
            return {};
        } catch (e) {
            console.error('Failed to parse full Anthropic response:', e);
            return {};
        }
    }
}
