import path from "node:path";
import { isJsTs } from "../../diff/changed-files.js";
import { newFinding, type Finding } from "../../review/types.js";
import { run } from "../../utils/exec.js";
import type { Analyzer } from "../types.js";

interface EslintFile {
    filePath: string;
    messages: { ruleId: string | null; severity: number; message: string; line?: number; endLine?: number }[];
}

export const eslintAnalyzer: Analyzer = {
    name: "eslint",
    async run(ctx) {
        if (process.env.ENABLE_ESLINT !== "true") return [];
        const files = ctx.files.filter((f) => isJsTs(f) && f.status !== "removed");
        if (!files.length) return [];

        const r = await run(
            "npx",
            ["--no-install", "eslint", "--format", "json", "--no-error-on-unmatched-pattern", ...files.map((f) => f.path)],
            { cwd: ctx.repoRoot, timeoutMs: 180_000 },
        );
        if (r.missing) throw new Error("npx not found; skipped");
        let parsed: EslintFile[];
        try { parsed = JSON.parse(r.stdout); } catch { throw new Error(`eslint produced no JSON: ${r.stderr.slice(0, 200)}`); }

        const byPath = new Map(files.map((f) => [f.path, f]));
        const out: Finding[] = [];
        for (const res of parsed) {
            const rel = path.relative(ctx.repoRoot, res.filePath).split(path.sep).join("/");
            const f = byPath.get(rel);
            if (!f) continue;
            for (const m of res.messages) {
                if (!m.line || !f.added.has(m.line)) continue; // only lines touched by this PR
                out.push(newFinding({
                    ruleId: `eslint/${m.ruleId ?? "parse-error"}`, category: "quality",
                    severity: m.severity === 2 ? "medium" : "low", confidence: 0.8,
                    file: rel, startLine: m.line, endLine: m.endLine, title: `ESLint: ${m.ruleId ?? "error"}`,
                    message: m.message, source: "static-analyzer", key: `${m.ruleId}:${m.message.slice(0, 40)}`,
                }));
            }
        }
        return out;
    },
};