import { Octokit } from "@octokit/rest";
import type { ChangedFile, CommitInfo, FileStatus, PullRequestInfo } from "./types.js";

export interface GitHubClientOptions {
    token: string;
    owner: string;
    repo: string;
}

export const SUMMARY_MARKER = "<!-- pr-reviewer:summary -->";

export class GitHubClient {
    private octokit: Octokit;
    private owner: string;
    private repo: string;

    constructor(opts: GitHubClientOptions) {
        this.octokit = new Octokit({ auth: opts.token });
        this.owner = opts.owner;
        this.repo = opts.repo;
    }

    async getPullRequest(number: number): Promise<PullRequestInfo> {
        const { data } = await this.octokit.pulls.get({
            owner: this.owner,
            repo: this.repo,
            pull_number: number,
        });
        return {
            number: data.number,
            title: data.title,
            body: data.body ?? "",
            author: data.user?.login ?? "unknown",
            baseSha: data.base.sha,
            headSha: data.head.sha,
            baseRef: data.base.ref,
            headRef: data.head.ref,
            labels: data.labels.map((l) => l.name),
            draft: data.draft ?? false,
        };
    }

    async getPullRequestFiles(number: number): Promise<ChangedFile[]> {
        const files = await this.octokit.paginate(this.octokit.pulls.listFiles, {
            owner: this.owner,
            repo: this.repo,
            pull_number: number,
            per_page: 100,
        });
        return files.map((f) => ({
            path: f.filename,
            previousPath: f.previous_filename,
            status: f.status as FileStatus,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch, // may be undefined
        }));
    }

    async getPullRequestDiff(number: number): Promise<string> {
        const res = await this.octokit.pulls.get({
            owner: this.owner,
            repo: this.repo,
            pull_number: number,
            mediaType: { format: "diff" },
        });
        return res.data as unknown as string;
    }

    async getPullRequestCommits(number: number): Promise<CommitInfo[]> {
        const commits = await this.octokit.paginate(this.octokit.pulls.listCommits, {
            owner: this.owner,
            repo: this.repo,
            pull_number: number,
            per_page: 100,
        });
        return commits.map((c) => ({
            sha: c.sha,
            message: c.commit.message,
            author: c.commit.author?.name ?? "unknown",
            date: c.commit.author?.date ?? "",
        }));
    }

    /** Create the summary comment, or update it if one from a previous run exists. */
    async upsertSummaryComment(number: number, body: string): Promise<void> {
        const fullBody = `${SUMMARY_MARKER}\n${body}`;

        const comments = await this.octokit.paginate(this.octokit.issues.listComments, {
            owner: this.owner,
            repo: this.repo,
            issue_number: number,
            per_page: 100,
        });
        const existing = comments.find((c) => c.body?.includes(SUMMARY_MARKER));

        if (existing) {
            await this.octokit.issues.updateComment({
                owner: this.owner,
                repo: this.repo,
                comment_id: existing.id,
                body: fullBody,
            });
        } else {
            await this.octokit.issues.createComment({
                owner: this.owner,
                repo: this.repo,
                issue_number: number,
                body: fullBody,
            });
        }
    }

    async listReviewComments(number: number): Promise<string[]> {
        const comments = await this.octokit.paginate(this.octokit.pulls.listReviewComments, {
            owner: this.owner, repo: this.repo, pull_number: number, per_page: 100,
        });
        return comments.map((c) => c.body);
    }

    async createReview(
        number: number,
        opts: { commitId: string; comments: { path: string; line: number; body: string }[] },
    ): Promise<void> {
        await this.octokit.pulls.createReview({
            owner: this.owner, repo: this.repo, pull_number: number,
            commit_id: opts.commitId, event: "COMMENT",
            comments: opts.comments.map((c) => ({ path: c.path, line: c.line, side: "RIGHT" as const, body: c.body })),
        });
    }
}