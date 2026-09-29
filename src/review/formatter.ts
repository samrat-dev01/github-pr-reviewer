import type { AnalyzerFailure } from "../analyzers/types.js";
import type { ReviewFile } from "../diff/changed-files.js";
import type { Category, Finding } from "./types.js";

const LABEL: Record<Category, string> = {
    quality: "Code Quality", architecture: "Architecture", security: "Security",
    dependency: "Dependencies", testing: "Testing", "unusual-change": "Unusual Changes", complexity: "Complexity",
};
const DEEP = new Set(["javascript", "typescript"]);
export const findingMarker = (id: string) => `<!-- pr-reviewer:finding:${id} -->`;

export function formatInlineComment(f: Finding): string {
    return [
        `**${LABEL[f.category]}: ${f.title}** (\`${f.ruleId}\`, confidence ${Math.round(f.confidence * 100)}%)`,
        "",
        f.message,
        ...(f.suggestion ? ["", `**Suggestion:** ${f.suggestion}`] : []),
        "",
        findingMarker(f.id),
    ].join("\n");
}

export function formatSummary(i: {
    files: ReviewFile[]; inline: Finding[]; summary: Finding[]; suppressed: number;
    failures: AnalyzerFailure[]; llm: { enabled: boolean; calls: number };
}): string {
    const all = [...i.inline, ...i.summary];
    const langs = [...new Set(i.files.map((f) => f.language).filter((l) => l !== "other"))];
    const deep = langs.filter((l) => DEEP.has(l));
    const generic = langs.filter((l) => !DEEP.has(l));
    const add = i.files.reduce((n, f) => n + f.additions, 0);
    const del = i.files.reduce((n, f) => n + f.deletions, 0);

    const lines = [
        "## AI PR Review", "",
        `Files analyzed: **${i.files.length}** (+${add} / -${del}) · Findings: **${all.length}** (${i.inline.length} inline)`,
        `Deep analysis: ${deep.join(", ") || "none"}${generic.length ? ` · Generic checks only: ${generic.join(", ")}` : ""}`,
        "", "| Category | Findings |", "|---|---|",
        ...(Object.keys(LABEL) as Category[]).map((c) => `| ${LABEL[c]} | ${all.filter((f) => f.category === c).length} |`),
    ];

    if (i.summary.length) {
        lines.push("", "### Worth a look", "");
        for (const f of i.summary) {
            const loc = f.file ? ` (\`${f.file}${f.startLine ? `:${f.startLine}` : ""}\`)` : "";
            lines.push(`- **[${f.severity}] ${f.title}**${loc}: ${f.message}${f.suggestion ? ` _Suggestion: ${f.suggestion}_` : ""}`);
        }
    }
    lines.push("", `<sub>${i.suppressed} low-confidence or informational signals suppressed. LLM verification: ${i.llm.enabled ? `${i.llm.calls} call(s)` : "off"}.</sub>`);

    if (i.failures.length) {
        lines.push("", "<details><summary>Analyzer notes</summary>", "");
        for (const f of i.failures) lines.push(`- \`${f.analyzer}\`: ${f.error}`);
        lines.push("", "</details>");
    }
    return lines.join("\n");
}