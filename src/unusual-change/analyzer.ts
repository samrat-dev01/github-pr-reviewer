import type { Analyzer } from "../analyzers/types.js";
import { loadHistory } from "../repository/history.js";
import { buildBaseline } from "./baseline.js";
import { detectUnusualChanges } from "./detector.js";

export const unusualChangeAnalyzer: Analyzer = {
    name: "unusual-change",
    async run(ctx) {
        // History as of the base branch, so this PR's own commits don't shape the baseline.
        const history = await loadHistory(ctx.repoRoot, ctx.pr.baseSha, ctx.config.history.maxCommits);
        return detectUnusualChanges(ctx.files, buildBaseline(history, ctx.config.history.moduleDepth), ctx.config);
    },
};