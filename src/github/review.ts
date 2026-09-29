import type { Finding } from "../review/types.js";
import { findingMarker, formatInlineComment } from "../review/formatter.js";
import type { GitHubClient } from "./client.js";
import type { PullRequestInfo } from "./types.js";

/** Posts inline comments (skipping ones already posted), then the summary. */
export async function publishReview(
    github: GitHubClient,
    pr: PullRequestInfo,
    inline: Finding[],
    buildSummary: (fallback: Finding[]) => string,
): Promise<void> {
    let fallback: Finding[] = [];
    const existing = await github.listReviewComments(pr.number);
    const fresh = inline.filter((f) => !existing.some((b) => b.includes(findingMarker(f.id))));

    if (fresh.length) {
        try {
            await github.createReview(pr.number, {
                commitId: pr.headSha,
                comments: fresh.map((f) => ({ path: f.file!, line: f.startLine!, body: formatInlineComment(f) })),
            });
        } catch (e) {
            console.warn(`[publish] inline review failed, moving to summary: ${(e as Error).message}`);
            fallback = fresh; // e.g. 422 when a line is not in the diff
        }
    }
    await github.upsertSummaryComment(pr.number, buildSummary(fallback));
}