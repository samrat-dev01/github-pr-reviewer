import fs from "node:fs/promises";
import path from "node:path";
import { newFinding, type Finding } from "../../review/types.js";
import { SECRET_PATTERNS, isPlaceholder, mask } from "../../utils/secrets.js";
import { run } from "../../utils/exec.js";
import type { Analyzer } from "../types.js";

const ENV_RE = /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g;

export const universalAnalyzer: Analyzer = {
    name: "universal",
    async run(ctx) {
        const out: Finding[] = [];
        const { files, config, pr } = ctx;

        // Large diff
        const total = files.reduce((n, f) => n + f.additions + f.deletions, 0);
        if (total > config.limits.largeDiffLines) {
            out.push(newFinding({
                ruleId: "universal/large-diff", category: "quality", severity: "medium", confidence: 0.95,
                title: "Large change",
                message: `This PR changes ${total} lines across ${files.length} files. Large PRs are harder to review; consider splitting if it mixes unrelated changes.`,
                source: "rule-engine",
                evidence: [{ kind: "metric", detail: `${total} changed lines (limit ${config.limits.largeDiffLines})` }],
            }));
        }

        for (const f of files) {
            const base = path.posix.basename(f.path);

            if (f.kind === "ci") {
                out.push(newFinding({
                    ruleId: "universal/ci-change", category: "security", severity: "medium", confidence: 0.85,
                    file: f.path, title: "CI/CD configuration changed",
                    message: "Workflow changes can alter what runs with repository secrets and permissions. Verify this change is intentional.",
                    source: "rule-engine",
                }));
            }
            if (f.kind === "docker") {
                out.push(newFinding({
                    ruleId: "universal/docker-change", category: "security", severity: "low", confidence: 0.8,
                    file: f.path, title: "Container configuration changed",
                    message: "Docker configuration affects the build and runtime environment. Verify base images, exposed ports and user permissions.",
                    source: "rule-engine",
                }));
            }
            if (f.status === "added" && /^\.env/.test(base) && !/\.(example|sample|template)$/.test(base)) {
                out.push(newFinding({
                    ruleId: "universal/env-file-committed", category: "security", severity: "high", confidence: 0.9,
                    file: f.path, title: "Environment file added",
                    message: "Environment files often contain secrets. Confirm it holds no real credentials or add it to .gitignore.",
                    source: "rule-engine",
                }));
            }
            if (f.status === "added" && f.kind === "script") {
                out.push(newFinding({
                    ruleId: "universal/new-script", category: "security", severity: "low", confidence: 0.8,
                    file: f.path, title: "New shell script added",
                    message: "A new script was added. Review what it executes and with which privileges.",
                    source: "rule-engine",
                }));
            }

            // Large source files (measured on disk)
            if (f.kind === "source" && f.status !== "removed") {
                try {
                    const lines = (await fs.readFile(path.join(ctx.repoRoot, f.path), "utf8")).split("\n").length;
                    if (lines > config.limits.largeFileLines) {
                        out.push(newFinding({
                            ruleId: "universal/large-file", category: "quality", severity: "low", confidence: 0.8,
                            file: f.path, title: "Large file",
                            message: `This file has ${lines} lines (limit ${config.limits.largeFileLines}). Consider splitting it by responsibility.`,
                            source: "rule-engine",
                        }));
                    }
                } catch { /* file unreadable: skip */ }
            }

            // Secret-like strings in added lines
            if (f.kind === "lockfile" || f.status === "removed") continue;
            for (const [line, text] of f.added) {
                for (const p of SECRET_PATTERNS) {
                    const m = text.match(p.re);
                    if (!m) continue;
                    if (p.id === "generic-secret" && isPlaceholder(m[0])) break;
                    out.push(newFinding({
                        ruleId: `universal/secret/${p.id}`, category: "security", severity: "high",
                        confidence: f.kind === "test" ? p.confidence * 0.8 : p.confidence,
                        file: f.path, startLine: line, title: `Possible secret: ${p.label}`,
                        message: `A string that looks like a ${p.label.toLowerCase()} was added (${mask(m[0])}). If real, revoke it and load it from a secret store instead.`,
                        source: "rule-engine", key: `${p.id}:${line}`,
                    }));
                    break;
                }
            }
        }

        // Source changed, no tests changed
        const src = files.filter((f) => f.kind === "source" && f.status !== "removed");
        const changedLines = src.reduce((n, f) => n + f.additions, 0);
        if (src.length && changedLines >= 5 && !files.some((f) => f.kind === "test")) {
            out.push(newFinding({
                ruleId: "universal/source-without-tests", category: "testing", severity: "low", confidence: 0.72,
                title: "Source changes without test changes",
                message: "Production code changed but no test files were modified. Verify existing tests cover the new behavior.",
                evidence: src.slice(0, 5).map((f) => ({ kind: "file", detail: f.path })),
                source: "rule-engine",
            }));
        }

        // New environment variables (checked against the base commit)
        const names = new Set<string>();
        for (const f of files) {
            if (f.kind !== "source") continue;
            for (const text of f.added.values()) for (const m of text.matchAll(ENV_RE)) names.add((m[1] ?? m[2])!);
        }
        const fresh: string[] = [];
        for (const n of [...names].slice(0, 15)) {
            const r = await run("git", ["grep", "-q", "-F", "-e", n, pr.baseSha], { cwd: ctx.repoRoot });
            if (r.code === 1) fresh.push(n); // exit 1 = not found at base
        }
        if (fresh.length) {
            out.push(newFinding({
                ruleId: "universal/new-env-var", category: "quality", severity: "low", confidence: 0.75,
                title: "New environment variables",
                message: `New environment variables referenced: ${fresh.join(", ")}. Make sure they are documented and provisioned in deployment config.`,
                source: "rule-engine",
            }));
        }
        return out;
    },
};