import { isJsTs } from "../../diff/changed-files.js";
import { newFinding, type Finding, type Severity } from "../../review/types.js";
import { run } from "../../utils/exec.js";
import type { Analyzer } from "../types.js";

interface SemgrepResult {
    check_id: string; path: string; start: { line: number }; end: { line: number };
    extra: { message: string; severity: string; metadata?: { confidence?: string } };
}
const SEV: Record<string, Severity> = { ERROR: "high", WARNING: "medium", INFO: "low" };
const CONF: Record<string, number> = { HIGH: 0.9, MEDIUM: 0.8, LOW: 0.6 };

export const semgrepAnalyzer: Analyzer = {
    name: "semgrep",
    async run(ctx) {
        const files = ctx.files.filter((f) => isJsTs(f) && f.status !== "removed");
        if (!files.length) return [];
        const configs = (process.env.SEMGREP_CONFIGS ?? "p/javascript,p/typescript,p/security-audit").split(",");

        const r = await run("semgrep", [
            "scan", ...configs.flatMap((c) => ["--config", c]),
            "--json", "--quiet", "--metrics=off", "--timeout", "30",
            ...files.slice(0, 200).map((f) => f.path),
        ], { cwd: ctx.repoRoot, timeoutMs: 300_000 });
        if (r.missing) throw new Error("semgrep is not installed; skipped");

        let results: SemgrepResult[];
        try { results = JSON.parse(r.stdout).results ?? []; }
        catch { throw new Error(`semgrep produced no JSON: ${r.stderr.slice(0, 200)}`); }

        const byPath = new Map(files.map((f) => [f.path, f]));
        const out: Finding[] = [];
        for (const x of results) {
            const f = byPath.get(x.path);
            if (!f || !f.added.has(x.start.line)) continue; // only lines this PR added
            out.push(newFinding({
                ruleId: `semgrep/${x.check_id}`, category: "security",
                severity: SEV[x.extra.severity] ?? "medium",
                confidence: CONF[(x.extra.metadata?.confidence ?? "").toUpperCase()] ?? 0.75,
                file: x.path, startLine: x.start.line, endLine: x.end.line,
                title: `Semgrep: ${x.check_id.split(".").pop()}`, message: x.extra.message.slice(0, 400),
                source: "static-analyzer", key: x.check_id,
            }));
        }
        return out;
    },
};