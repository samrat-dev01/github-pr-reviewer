import type { ReviewFile } from "../diff/changed-files.js";
import type { PullRequestInfo } from "../github/types.js";
import type { RepoGraph } from "../repository/graph.js";
import type { ReviewerConfig } from "../repo-config.js";
import type { Finding } from "../review/types.js";

export interface AnalysisContext {
    repoRoot: string;
    pr: PullRequestInfo;
    files: ReviewFile[];
    config: ReviewerConfig;
    getGraph(): Promise<RepoGraph>; // built lazily, shared between analyzers
}

export interface Analyzer {
    name: string;
    run(ctx: AnalysisContext): Promise<Finding[]>;
}

export interface AnalyzerFailure {
    analyzer: string;
    error: string;
}

/** One failing analyzer never stops the review. */
export async function runAnalyzers(analyzers: Analyzer[], ctx: AnalysisContext) {
    const findings: Finding[] = [];
    const failures: AnalyzerFailure[] = [];
    const results = await Promise.allSettled(
        analyzers.map(async (a) => {
            const t = Date.now();
            const r = await a.run(ctx);
            console.log(`[analyzer] ${a.name}: ${r.length} findings (${Date.now() - t}ms)`);
            return r;
        }),
    );
    results.forEach((r, i) => {
        if (r.status === "fulfilled") findings.push(...r.value);
        else {
            const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
            console.warn(`[analyzer] ${analyzers[i].name} failed: ${error}`);
            failures.push({ analyzer: analyzers[i].name, error });
        }
    });
    return { findings, failures };
}