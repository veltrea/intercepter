/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Veltrea Project (veltrea/user). All rights reserved.
 *  This code is part of the Veltrea AI-Native IDE project.
 *--------------------------------------------------------------------------------------------*/
import { IVeltreaProviderAdapter } from './IVeltreaProviderAdapter.js';
import { IChatMessage, ChatMessageRole } from '../common/types.js';
import { Emitter } from '../common/emitter.js';

export class GoogleGeminiAdapter implements IVeltreaProviderAdapter {

    constructor(private readonly modelId: string = 'gemini-2.0-flash') { }

    buildRequest(messages: IChatMessage[], modelId: string, maxTokens: number): any {
        const contents = messages.filter(m => m.role !== ChatMessageRole.System).map(m => ({
            role: m.role === ChatMessageRole.Assistant ? 'model' : 'user',
            parts: m.content.map((c: any) => ({ text: c.type === 'text' ? c.value : '' }))
        }));

        const systemMessage = messages.find(m => m.role === ChatMessageRole.System);
        const systemInstruction = systemMessage ? {
            parts: systemMessage.content.map((c: any) => ({ text: c.type === 'text' ? c.value : '' }))
        } : undefined;

        const payload: any = {
            contents,
            generationConfig: { maxOutputTokens: maxTokens }
        };

        if (systemInstruction) {
            payload.systemInstruction = systemInstruction;
        }

        return payload;
    }

    getRequestOptions(apiKey: string): { url: string; headers: Record<string, string> } {
        return {
            url: `https://generativelanguage.googleapis.com/v1beta/models/${this.modelId}:streamGenerateContent?key=${apiKey}&alt=sse`,
            headers: { 'Content-Type': 'application/json' }
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
                    if (parsed.candidates && parsed.candidates.length > 0) {
                        const candidate = parsed.candidates[0];
                        if (candidate.content?.parts?.length > 0) {
                            const textPart = candidate.content.parts[0].text;
                            if (textPart) {
                                const cleanText = this._sanitizeProtocolMarkers(textPart);
                                if (cleanText) {
                                    onUpdate.fire(cleanText);
                                }
                            }
                        }
                    }
                } catch {
                    // Ignore incomplete chunks
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
            if (parsed.candidates && parsed.candidates.length > 0) {
                const candidate = parsed.candidates[0];
                if (candidate.content?.parts?.length > 0) {
                    return { content: candidate.content.parts[0].text || undefined };
                }
            }
            return {};
        } catch (e) {
            console.error('Failed to parse full Gemini response:', e);
            return {};
        }
    }
}
