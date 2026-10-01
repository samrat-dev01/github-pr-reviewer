import { createHash } from "node:crypto";

export type Category =
    | "quality" | "architecture" | "security" | "dependency"
    | "testing" | "unusual-change" | "complexity";
export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type Source = "static-analyzer" | "repository-analysis" | "rule-engine" | "llm";

export interface Evidence {
    kind: string;
    detail: string;
}

export interface Finding {
    id: string;
    ruleId: string;
    category: Category;
    severity: Severity;
    confidence: number;
    file?: string;
    startLine?: number;
    endLine?: number;
    title: string;
    message: string;
    evidence?: Evidence[];
    suggestion?: string;
    source: Source;
    verified?: boolean;
}

export const SEVERITIES: Severity[] = ["info", "low", "medium", "high", "critical"];
export const severityRank = (s: Severity) => SEVERITIES.indexOf(s);

/** The id excludes line numbers so it stays stable when code shifts between pushes. */
export function newFinding(f: Omit<Finding, "id"> & { key?: string }): Finding {
    const { key, ...rest } = f;
    const id = createHash("sha1")
        .update([f.ruleId, f.file ?? "", key ?? f.title].join("|"))
        .digest("hex")
        .slice(0, 12);
    return { id, ...rest };
}