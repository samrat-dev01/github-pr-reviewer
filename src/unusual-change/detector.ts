import type { ReviewFile } from "../diff/changed-files.js";
import type { ReviewerConfig } from "../repo-config.js";
import { newFinding, type Finding } from "../review/types.js";
import { areaOf, pairKey, type Baseline } from "./baseline.js";

const SENSITIVE_PATH = /(auth|security|payment|permission|middleware|secret)/i;
const EXCLUDED = new Set(["test", "docs", "lockfile", "manifest"]);

export function detectUnusualChanges(files: ReviewFile[], b: Baseline, cfg: ReviewerConfig): Finding[] {
    if (b.commits < 20) return []; // not enough history for a baseline
    const { moduleDepth: depth, minSamples } = cfg.history;
    const out: Finding[] = [];

    const byArea = new Map<string, ReviewFile[]>();
    for (const f of files) {
        if (EXCLUDED.has(f.kind)) continue;
        const a = areaOf(f.path, depth);
        byArea.set(a, [...(byArea.get(a) ?? []), f]);
    }

    // Primary area = the one with most source files that has enough history.
    let primary: string | undefined;
    let best = 0;
    for (const [area, fs] of byArea) {
        const n = fs.filter((f) => f.kind === "source").length;
        if (n > best && (b.areaCommits.get(area) ?? 0) >= minSamples) { best = n; primary = area; }
    }

    if (primary) {
        const primaryCommits = b.areaCommits.get(primary)!;
        for (const [area, fs] of byArea) {
            if (area === primary) continue;
            const co = b.coChange.get(pairKey(primary, area)) ?? 0;
            if (co / primaryCommits >= 0.05) continue; // these areas usually change together
            const sensitive = fs.some((f) => f.kind === "ci" || f.kind === "docker") || SENSITIVE_PATH.test(area);
            if ((b.areaCommits.get(area) ?? 0) === 0 && !sensitive) continue; // brand-new area, not an anomaly

            out.push(newFinding({
                ruleId: "unusual-change/outside-module-pattern", category: "unusual-change",
                severity: sensitive ? "medium" : "low",
                confidence: Math.min(0.95, 0.6 + Math.min(0.3, primaryCommits / 300) + (sensitive ? 0.05 : 0)),
                file: fs[0].path, title: `Changes outside the usual pattern for ${primary}`,
                message: `This PR modifies files in \`${area}\`, which is outside the typical change pattern for \`${primary}\`. Verify these changes are intentional.`,
                evidence: [
                    { kind: "history", detail: `Of ${primaryCommits} recent commits touching ${primary}, ${co} also touched ${area}.` },
                    ...fs.slice(0, 5).map((f) => ({ kind: "file", detail: f.path })),
                ],
                source: "repository-analysis", key: area,
            }));
        }
    }

    if (files.length > Math.max(30, 3 * b.p90Files)) {
        out.push(newFinding({
            ruleId: "unusual-change/pr-size", category: "unusual-change", severity: "info", confidence: 0.7,
            title: "PR touches many more files than usual",
            message: `This PR changes ${files.length} files; recent commits typically change ${b.p90Files} or fewer.`,
            source: "repository-analysis",
        }));
    }
    return out;
}