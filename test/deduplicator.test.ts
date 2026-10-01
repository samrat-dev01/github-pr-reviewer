import { describe, expect, it } from "vitest";
import { deduplicate } from "../src/review/deduplicator.js";
import { newFinding } from "../src/review/types.js";

describe("deduplicate", () => {
    it("merges findings on the same file/line/category from different sources", () => {
        const a = newFinding({
            ruleId: "eslint/no-eval", category: "security", severity: "medium", confidence: 0.8,
            file: "a.ts", startLine: 10, title: "eval used", message: "m", source: "static-analyzer",
        });
        const b = newFinding({
            ruleId: "js/eval", category: "security", severity: "high", confidence: 0.85,
            file: "a.ts", startLine: 11, title: "eval used", message: "m", source: "rule-engine",
        });
        const merged = deduplicate([a, b]);
        expect(merged).toHaveLength(1);
        expect(merged[0].severity).toBe("high"); // keeps the higher-severity one
        expect(merged[0].confidence).toBeGreaterThan(0.85); // boosted by agreement
        expect(merged[0].evidence?.some((e) => e.kind === "also-reported-by")).toBe(true);
    });

    it("does not merge findings on different files", () => {
        const a = newFinding({ ruleId: "r", category: "quality", severity: "low", confidence: 0.8, file: "a.ts", startLine: 1, title: "t", message: "m", source: "rule-engine" });
        const b = newFinding({ ruleId: "r", category: "quality", severity: "low", confidence: 0.8, file: "b.ts", startLine: 1, title: "t", message: "m", source: "rule-engine" });
        expect(deduplicate([a, b])).toHaveLength(2);
    });

    it("does not merge findings more than 3 lines apart", () => {
        const a = newFinding({ ruleId: "r", category: "quality", severity: "low", confidence: 0.8, file: "a.ts", startLine: 1, title: "t", message: "m", source: "rule-engine" });
        const b = newFinding({ ruleId: "r", category: "quality", severity: "low", confidence: 0.8, file: "a.ts", startLine: 10, title: "t", message: "m", source: "rule-engine" });
        expect(deduplicate([a, b])).toHaveLength(2);
    });
});