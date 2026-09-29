import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { newFinding, type Finding } from "../../review/types.js";
import { run } from "../../utils/exec.js";
import type { Analyzer } from "../types.js";

interface Leak { RuleID: string; Description: string; File: string; StartLine: number; EndLine: number }

export const gitleaksAnalyzer: Analyzer = {
    name: "gitleaks",
    async run(ctx) {
        const report = path.join(os.tmpdir(), `gitleaks-${process.pid}-${Date.now()}.json`);
        try {
            const r = await run("gitleaks", [
                "git", `--log-opts=${ctx.pr.baseSha}..${ctx.pr.headSha}`,
                "--report-format", "json", "--report-path", report,
                "--redact", "--no-banner", "--exit-code", "0",
            ], { cwd: ctx.repoRoot });
            if (r.missing) throw new Error("gitleaks is not installed; skipped");

            let leaks: Leak[] = [];
            try { leaks = JSON.parse(await fs.readFile(report, "utf8")) ?? []; }
            catch { if (r.code !== 0) throw new Error(`gitleaks failed: ${r.stderr.slice(0, 200)}`); }

            const changed = new Set(ctx.files.map((f) => f.path));
            const out: Finding[] = [];
            for (const l of leaks) {
                if (!changed.has(l.File)) continue;
                out.push(newFinding({
                    ruleId: `gitleaks/${l.RuleID}`, category: "security", severity: "high", confidence: 0.9,
                    file: l.File, startLine: l.StartLine, endLine: l.EndLine, title: `Secret detected: ${l.RuleID}`,
                    message: `Gitleaks flagged a potential secret (${l.Description}). Revoke it if real and move it to a secret store.`,
                    source: "static-analyzer", key: `${l.RuleID}:${l.StartLine}`,
                }));
            }
            return out;
        } finally {
            await fs.rm(report, { force: true });
        }
    },
};