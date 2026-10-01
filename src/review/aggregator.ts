import type { ReviewFile } from "../diff/changed-files.js";
import type { ReviewerConfig } from "../repo-config.js";
import { severityRank, type Finding } from "./types.js";

export function partition(findings: Finding[], files: ReviewFile[], cfg: ReviewerConfig) {
    const commentable = new Map(files.map((f) => [f.path, f.commentable]));
    const inline: Finding[] = [];
    const summary: Finding[] = [];
    let suppressed = 0;

    const ranked = [...findings].sort(
        (a, b) => severityRank(b.severity) - severityRank(a.severity) || b.confidence - a.confidence,
    );
    for (const f of ranked) {
        if (f.severity === "info") { suppressed++; continue; }
        if (f.confidence < cfg.thresholds.summary && f.severity !== "critical") { suppressed++; continue; }

        const canInline =
            f.confidence >= cfg.thresholds.inline && severityRank(f.severity) >= severityRank("medium") &&
            !!f.file && !!f.startLine && !!commentable.get(f.file)?.has(f.startLine) &&
            inline.length < cfg.limits.maxInline;
        (canInline ? inline : summary).push(f);
    }
    return { inline, summary, suppressed };
}