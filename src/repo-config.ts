import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { gitShow } from "./utils/git.js";

export interface ReviewerConfig {
    thresholds: { inline: number; summary: number };
    limits: {
        largeDiffLines: number; largeFileLines: number; maxFunctionLines: number;
        maxComplexity: number; maxParams: number; maxInline: number;
    };
    ignore: string[];
    architecture?: {
        layers: Record<string, { paths?: string[]; packages?: string[] }>;
        rules: { from: string; cannotImport: string[] }[];
    };
    history: { maxCommits: number; moduleDepth: number; minSamples: number };
    llm: { enabled: boolean; maxCalls: number };
}

const DEFAULTS: ReviewerConfig = {
    thresholds: { inline: 0.9, summary: 0.7 },
    limits: { largeDiffLines: 800, largeFileLines: 600, maxFunctionLines: 80, maxComplexity: 15, maxParams: 6, maxInline: 10 },
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/coverage/**", "**/*.min.js", "**/.pr-reviewer/**"],
    history: { maxCommits: 500, moduleDepth: 2, minSamples: 5 },
    llm: { enabled: true, maxCalls: 10 },
};

const num = z.number().optional();
const fileSchema = z.object({
    thresholds: z.object({ inline: num, summary: num }).optional(),
    limits: z.object({
        largeDiffLines: num, largeFileLines: num, maxFunctionLines: num,
        maxComplexity: num, maxParams: num, maxInline: num,
    }).optional(),
    ignore: z.array(z.string()).optional(),
    architecture: z.object({
        layers: z.record(z.string(), z.object({
            paths: z.array(z.string()).optional(),
            packages: z.array(z.string()).optional(),
        })),
        rules: z.array(z.object({ from: z.string(), cannotImport: z.array(z.string()) })).default([]),
    }).optional(),
    history: z.object({ maxCommits: num, moduleDepth: num, minSamples: num }).optional(),
    llm: z.object({ enabled: z.boolean().optional(), maxCalls: num }).optional(),
});

/** Reads .pr-reviewer.yml from the BASE branch so a PR can't edit its own review rules. */
export async function loadRepoConfig(repoRoot: string, baseSha?: string): Promise<ReviewerConfig> {
    let text: string | undefined;
    if (baseSha) text = await gitShow(repoRoot, baseSha, ".pr-reviewer.yml");
    if (text === undefined) {
        try { text = await fs.readFile(path.join(repoRoot, ".pr-reviewer.yml"), "utf8"); } catch { /* none */ }
    }
    const p = fileSchema.parse(text ? (parseYaml(text) ?? {}) : {});
    return {
        thresholds: { ...DEFAULTS.thresholds, ...p.thresholds },
        limits: { ...DEFAULTS.limits, ...p.limits },
        ignore: p.ignore ?? DEFAULTS.ignore,
        architecture: p.architecture,
        history: { ...DEFAULTS.history, ...p.history },
        llm: { ...DEFAULTS.llm, ...p.llm },
    };
}