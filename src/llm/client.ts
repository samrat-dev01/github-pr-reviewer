import { VERDICT_JSON_SCHEMA } from "./schema.js";

export interface LlmOptions { baseUrl: string; model: string; apiKey?: string; timeoutMs?: number }

export interface LlmChatResult {
    content: string;
    promptTokens: number;
    completionTokens: number;
    durationMs: number;
}

export class LlmClient {
    constructor(public opts: LlmOptions) { }

    async chatJson(system: string, user: string): Promise<LlmChatResult> {
        const start = Date.now();

        const res = await fetch(`${this.opts.baseUrl.replace(/\/$/, "")}/api/chat`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(this.opts.apiKey ? { Authorization: `Bearer ${this.opts.apiKey}` } : {}),
            },
            body: JSON.stringify({
                model: this.opts.model,
                stream: false,
                format: VERDICT_JSON_SCHEMA,
                options: { temperature: 0 },
                messages: [{ role: "system", content: system }, { role: "user", content: user }],
            }),
            signal: AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
        });

        if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

        const data = (await res.json()) as {
            message?: { content?: string };
            prompt_eval_count?: number;
            eval_count?: number;
        };

        if (!data.message?.content) throw new Error("LLM returned empty content");

        return {
            content: data.message.content,
            promptTokens: data.prompt_eval_count ?? 0,
            completionTokens: data.eval_count ?? 0,
            durationMs: Date.now() - start,
        };
    }
}