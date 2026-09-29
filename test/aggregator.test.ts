import { describe, expect, it } from "vitest";
import { partition } from "../src/review/aggregator.js";
import { newFinding } from "../src/review/types.js";
import type { ReviewerConfig } from "../src/repo-config.js";
import type { ReviewFile } from "../src/diff/changed-files.js";

const cfg: ReviewerConfig = {
    thresholds: { inline: 0.9, summary: 0.7 },
    limits: { largeDiffLines: 800, largeFileLines: 600, maxFunctionLines: 80, maxComplexity: 15, maxParams: 6, maxInline: 2 },
    ignore: [], history: { maxCommits: 500, moduleDepth: 2, minSamples: 5 }, llm: { enabled: true, maxCalls: 10 },
};

const file = (path: string, lines: number[]): ReviewFile => ({
    path, status: "modified", additions: 1, deletions: 0,
    language: "typescript", kind: "source", hunks: [], added: new Map(),
    commentable: new Set(lines),
});

describe("partition", () => {
    it("puts high-confidence, in-diff findings inline", () => {
        const f = newFinding({ ruleId: "r", category: "security", severity: "high", confidence: 0.95, file: "a.ts", startLine: 5, title: "t", message: "m", source: "rule-engine" });
        const { inline, summary } = partition([f], [file("a.ts", [5])], cfg);
        expect(inline).toHaveLength(1);
        expect(summary).toHaveLength(0);
    });

    it("demotes to summary when the line is not commentable", () => {
        const f = newFinding({ ruleId: "r", category: "security", severity: "high", confidence: 0.95, file: "a.ts", startLine: 99, title: "t", message: "m", source: "rule-engine" });
        const { inline, summary } = partition([f], [file("a.ts", [5])], cfg);
        expect(inline).toHaveLength(0);
        expect(summary).toHaveLength(1);
    });

    it("suppresses info severity and low-confidence findings", () => {
        const info = newFinding({ ruleId: "r1", category: "quality", severity: "info", confidence: 0.99, title: "t", message: "m", source: "rule-engine" });
        const low = newFinding({ ruleId: "r2", category: "quality", severity: "medium", confidence: 0.4, title: "t", message: "m", source: "rule-engine" });
        const { inline, summary, suppressed } = partition([info, low], [], cfg);
        expect(inline).toHaveLength(0);
        expect(summary).toHaveLength(0);
        expect(suppressed).toBe(2);
    });

    it("respects maxInline even when more findings qualify", () => {
        const findings = [1, 2, 3].map((n) =>
            newFinding({ ruleId: `r${n}`, category: "security", severity: "high", confidence: 0.95, file: "a.ts", startLine: n, title: "t", message: "m", source: "rule-engine" }),
        );
        const { inline, summary } = partition(findings, [file("a.ts", [1, 2, 3])], cfg);
        expect(inline).toHaveLength(2); // cfg.limits.maxInline = 2
        expect(summary).toHaveLength(1);
    });

    it("always allows critical severity even below the summary threshold", () => {
        const f = newFinding({ ruleId: "r", category: "security", severity: "critical", confidence: 0.5, title: "t", message: "m", source: "rule-engine" });
        const { summary, suppressed } = partition([f], [], cfg);
        expect(summary).toHaveLength(1);
        expect(suppressed).toBe(0);
    });
});