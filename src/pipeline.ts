import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logPrRunSummary } from "./llm/usage-logger.js";
import {
    runAnalyzers,
    type AnalysisContext,
    type Analyzer,
} from "./analyzers/types.js";
import { architectureAnalyzer } from "./analyzers/architecture/index.js";
import { dependencyAnalyzer } from "./analyzers/dependencies/index.js";
import { eslintAnalyzer } from "./analyzers/quality/eslint.js";
import { jsTsQualityAnalyzer } from "./analyzers/quality/js-ts.js";
import { gitleaksAnalyzer } from "./analyzers/security/gitleaks.js";
import { semgrepAnalyzer } from "./analyzers/security/semgrep.js";
import { universalAnalyzer } from "./analyzers/universal/index.js";
import { buildReviewFiles } from "./diff/changed-files.js";
import { createVcsClient } from "./vcs/factory.js";
import { publishReview } from "./vcs/review.js";
import { LlmClient } from "./llm/client.js";
import { verifyFindings } from "./llm/verifier.js";
import { loadRepoConfig } from "./repo-config.js";
import { buildGraph } from "./repository/graph.js";
import { partition } from "./review/aggregator.js";
import { deduplicate } from "./review/deduplicator.js";
import { formatSummary } from "./review/formatter.js";
import { unusualChangeAnalyzer } from "./unusual-change/analyzer.js";
import type { Config } from "./config.js";

const execFileAsync = promisify(execFile);

export interface PipelineTarget {
    owner: string;
    repo: string;
    prNumber: number;
    /** An already-checked-out working copy (used by the CLI). If omitted, the
     *  pipeline clones one into a temp directory itself and removes it afterward
     *  (used by the webhook server, which has no pre-checked-out repo). */
    repoRoot?: string;
}

export async function runReviewPipeline(
    baseConfig: Config,
    target: PipelineTarget,
): Promise<void> {
    
    const config: Config = {
        ...baseConfig,
        owner: target.owner,
        repo: target.repo,
        prNumber: target.prNumber,
    };

    const vcs = createVcsClient(config);
    const pr = await vcs.getPullRequest(config.prNumber);
    console.log(`PR #${pr.number}: ${pr.title}`);

    let tempDir: string | undefined;
    let repoRoot = target.repoRoot;

    if (!repoRoot) {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pr-review-"));
        repoRoot = tempDir;
        await cloneAndCheckout(config, pr, repoRoot);
    }

    try {
        const repoCfg = await loadRepoConfig(repoRoot, pr.baseSha);
        const files = buildReviewFiles(
            await vcs.getPullRequestFiles(pr.number),
            repoCfg.ignore,
        );

        let graphPromise: ReturnType<typeof buildGraph> | undefined;
        const root = repoRoot;
        const ctx: AnalysisContext = {
            repoRoot: root,
            pr,
            files,
            config: repoCfg,
            getGraph: () => (graphPromise ??= buildGraph(root, repoCfg.ignore)),
        };

        const analyzers: Analyzer[] = [
            universalAnalyzer,
            jsTsQualityAnalyzer,
            eslintAnalyzer,
            architectureAnalyzer,
            unusualChangeAnalyzer,
            dependencyAnalyzer,
            gitleaksAnalyzer,
            semgrepAnalyzer,
        ];

        let { findings, failures } = await runAnalyzers(analyzers, ctx);

        console.log(
            "RULE IDS:",
            findings.map(
                (f) =>
                    `${f.ruleId}${typeof f.startLine === "number" ? `:${f.startLine}` : ""}`,
            ),
        );

        let llm = { enabled: false, calls: 0 };

        if (repoCfg.llm.enabled && config.llm.model) {
            const client = new LlmClient({
                baseUrl: config.llm.baseUrl,
                model: config.llm.model,
                apiKey: config.llm.apiKey,
            });

            const res = await verifyFindings(
                findings,
                ctx,
                client,
                repoCfg.llm.maxCalls,
            );

            findings = res.findings;
            llm = { enabled: true, calls: res.calls };

            logPrRunSummary({
                repository: `${config.owner}/${config.repo}`,
                prNumber: config.prNumber,
                model: config.llm.model,
                calls: res.calls,
                promptTokens: res.promptTokens,
                completionTokens: res.completionTokens,
                totalTokens: res.promptTokens + res.completionTokens,
            });
        } else {
            console.log("LLM verification skipped (LLM_MODEL not set)");
        }

        const { inline, summary, suppressed } = partition(
            deduplicate(findings),
            files,
            repoCfg,
        );
        console.log(
            `inline=${inline.length} summary=${summary.length} suppressed=${suppressed}`,
        );

        await publishReview(vcs, pr, inline, (fallback) =>
            formatSummary({
                files,
                inline,
                summary: [...summary, ...fallback],
                suppressed,
                failures,
                llm,
            }),
        );
        console.log("Review published.");
    } finally {
        if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
    }
}

/** Clones the repo fresh (full history, matching `fetch-depth: 0` in Actions)
 *  and checks out the PR's exact head commit. Only used when no repoRoot is given. */
async function cloneAndCheckout(
    config: Config,
    pr: { headSha: string; number: number },
    dest: string,
): Promise<void> {
    const authedUrl = buildAuthedCloneUrl(config);
    await execFileAsync("git", ["clone", "--quiet", authedUrl, dest]);

    const refspec =
        config.vcs.platform === "gitlab"
            ? `merge-requests/${pr.number}/head`
            : `pull/${pr.number}/head`;
    await execFileAsync("git", ["fetch", "--quiet", "origin", refspec], {
        cwd: dest,
    });
    await execFileAsync("git", ["checkout", "--quiet", pr.headSha], {
        cwd: dest,
    });
}

function buildAuthedCloneUrl(config: Config): string {
    const { platform, baseUrl, token } = config.vcs;
    if (platform === "github") {
        return `https://x-access-token:${token}@github.com/${config.owner}/${config.repo}.git`;
    }
    const host = (baseUrl ?? "").replace(/^https?:\/\//, "");
    return `https://oauth2:${token}@${host}/${config.owner}/${config.repo}.git`;
}
