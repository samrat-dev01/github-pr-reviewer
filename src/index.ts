import { architectureAnalyzer } from "./analyzers/architecture/index.js";
import { dependencyAnalyzer } from "./analyzers/dependencies/index.js";
import { eslintAnalyzer } from "./analyzers/quality/eslint.js";
import { jsTsQualityAnalyzer } from "./analyzers/quality/js-ts.js";
import { gitleaksAnalyzer } from "./analyzers/security/gitleaks.js";
import { semgrepAnalyzer } from "./analyzers/security/semgrep.js";
import { runAnalyzers, type AnalysisContext, type Analyzer } from "./analyzers/types.js";
import { universalAnalyzer } from "./analyzers/universal/index.js";
import { loadConfig } from "./config.js";
import { buildReviewFiles } from "./diff/changed-files.js";
import { GitHubClient } from "./github/client.js";
import { publishReview } from "./github/review.js";
import { LlmClient } from "./llm/client.js";
import { verifyFindings } from "./llm/verifier.js";
import { loadRepoConfig } from "./repo-config.js";
import { buildGraph } from "./repository/graph.js";
import { partition } from "./review/aggregator.js";
import { deduplicate } from "./review/deduplicator.js";
import { formatSummary } from "./review/formatter.js";
import { unusualChangeAnalyzer } from "./unusual-change/analyzer.js";

async function main() {
    const config = loadConfig();
    const github = new GitHubClient({ token: config.githubToken, owner: config.owner, repo: config.repo });

    const pr = await github.getPullRequest(config.prNumber);
    console.log(`PR #${pr.number}: ${pr.title}`);

    const repoCfg = await loadRepoConfig(config.repoRoot, pr.baseSha);
    const files = buildReviewFiles(await github.getPullRequestFiles(pr.number), repoCfg.ignore);

    let graphPromise: ReturnType<typeof buildGraph> | undefined;
    const ctx: AnalysisContext = {
        repoRoot: config.repoRoot, pr, files, config: repoCfg,
        getGraph: () => (graphPromise ??= buildGraph(config.repoRoot, repoCfg.ignore)),
    };

    const analyzers: Analyzer[] = [
        universalAnalyzer, jsTsQualityAnalyzer, eslintAnalyzer, architectureAnalyzer,
        unusualChangeAnalyzer, dependencyAnalyzer, gitleaksAnalyzer, semgrepAnalyzer,
    ];
    let { findings, failures } = await runAnalyzers(analyzers, ctx);
console.log("RULE IDS:", findings.map((f) => f.ruleId));
    // Minimal LLM verification (optional)
    let llm = { enabled: false, calls: 0 };
    if (repoCfg.llm.enabled && config.llm.model) {
        const client = new LlmClient({ baseUrl: config.llm.baseUrl, model: config.llm.model, apiKey: config.llm.apiKey });
        const res = await verifyFindings(findings, ctx, client, repoCfg.llm.maxCalls);
        findings = res.findings;
        llm = { enabled: true, calls: res.calls };
    } else {
        console.log("LLM verification skipped (LLM_MODEL not set)");
    }

    const { inline, summary, suppressed } = partition(deduplicate(findings), files, repoCfg);
    console.log(`inline=${inline.length} summary=${summary.length} suppressed=${suppressed}`);

    await publishReview(github, pr, inline, (fallback) =>
        formatSummary({ files, inline, summary: [...summary, ...fallback], suppressed, failures, llm }),
    );
    console.log("Review published.");
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1; // avoid process.exit(), which triggers the Node 24 Windows assertion
});