import { describe, expect, it } from "vitest";
import { areaOf, buildBaseline, pairKey } from "../src/unusual-change/baseline.js";
import type { HistoricalCommit } from "../src/repository/history.js";

describe("areaOf", () => {
    it("truncates a path to the given depth", () => {
        expect(areaOf("src/user/service/user.service.ts", 2)).toBe("src/user");
        expect(areaOf("README.md", 2)).toBe(".");
    });
});

describe("pairKey", () => {
    it("is order-independent", () => {
        expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
    });
});

describe("buildBaseline", () => {
    it("counts co-changes between areas across commits", () => {
        const commits: HistoricalCommit[] = [
            { sha: "1", files: ["src/user/a.ts", "src/user/b.ts"] },
            { sha: "2", files: ["src/user/a.ts", ".github/workflows/ci.yml"] },
            { sha: "3", files: ["src/order/a.ts"] },
        ];
        const b = buildBaseline(commits, 2);
        expect(b.areaCommits.get("src/user")).toBe(2);
        expect(b.coChange.get(pairKey("src/user", ".github/workflows"))).toBe(1);
        expect(b.coChange.has(pairKey("src/user", "src/order"))).toBe(false);
    });

    it("skips bulk commits (more than 60 files)", () => {
        const bulk: HistoricalCommit = { sha: "x", files: Array.from({ length: 61 }, (_, i) => `f${i}.ts`) };
        const b = buildBaseline([bulk], 2);
        expect(b.commits).toBe(0);
    });
});