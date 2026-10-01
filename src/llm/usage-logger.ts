import fs from "node:fs";
import path from "node:path";

export interface LlmCallUsage {
    timestamp: string;
    model: string;
    ruleId: string;        // which finding this verification call was for
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    durationMs: number;
}

export interface PrRunUsageSummary {
    timestamp: string;
    repository: string;
    prNumber: number;
    model: string;
    calls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

const LOG_PATH = process.env.LLM_USAGE_LOG_PATH ?? path.join(process.cwd(), "llm-usage.jsonl");

function appendLine(obj: unknown): void {
    try {
        fs.appendFileSync(LOG_PATH, JSON.stringify(obj) + "\n", "utf8");
    } catch (e) {
        console.warn(`[usage-logger] failed to write log: ${(e as Error).message}`);
    }
}

export function logLlmCall(entry: Omit<LlmCallUsage, "timestamp">): void {
    appendLine({ timestamp: new Date().toISOString(), ...entry } satisfies LlmCallUsage);
}

export function logPrRunSummary(entry: Omit<PrRunUsageSummary, "timestamp">): void {
    appendLine({ timestamp: new Date().toISOString(), ...entry } satisfies PrRunUsageSummary);
}