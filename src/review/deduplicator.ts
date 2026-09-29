import { severityRank, type Finding } from "./types.js";

function sameTopic(a: Finding, b: Finding): boolean {
    if (a.file !== b.file || a.category !== b.category) return false;
    if (a.startLine && b.startLine) {
        return Math.abs(a.startLine - b.startLine) <= 3 && (a.ruleId === b.ruleId || a.source !== b.source);
    }
    return !a.startLine && !b.startLine && a.ruleId === b.ruleId && a.title === b.title;
}

export function deduplicate(findings: Finding[]): Finding[] {
    const sorted = [...findings].sort(
        (a, b) => (a.file ?? "").localeCompare(b.file ?? "") || (a.startLine ?? 0) - (b.startLine ?? 0),
    );
    const groups: Finding[][] = [];
    for (const f of sorted) {
        const g = groups.find((g) => sameTopic(g[0], f));
        if (g) g.push(f); else groups.push([f]);
    }
    return groups.map((g) => {
        if (g.length === 1) return g[0];
        const [best, ...rest] = [...g].sort(
            (a, b) => severityRank(b.severity) - severityRank(a.severity) || b.confidence - a.confidence,
        );
        return {
            ...best,
            confidence: Math.min(0.99, best.confidence + 0.05 * rest.length), // independent agreement
            evidence: [...(best.evidence ?? []), ...rest.map((o) => ({ kind: "also-reported-by", detail: `${o.ruleId} (${o.source})` }))],
        };
    });
}