import { loadConfig } from "./config.js";
import { runReviewPipeline } from "./pipeline.js";

async function main() {
    const config = loadConfig();
    await runReviewPipeline(config, {
        owner: config.owner,
        repo: config.repo,
        prNumber: config.prNumber,
        repoRoot: config.repoRoot, // already checked out: by you locally, or by actions/checkout in CI
    });
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});