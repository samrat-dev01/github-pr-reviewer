export type Platform = "github" | "gitea" | "gitlab";

export interface PullRequestInfo {
    number: number;
    title: string;
    body: string;
    author: string;
    baseSha: string;
    headSha: string;
    baseRef: string;
    headRef: string;
    labels: string[];
    draft: boolean;
}

export type FileStatus = "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";

export interface ChangedFile {
    path: string;
    previousPath?: string;
    status: FileStatus;
    additions: number;
    deletions: number;
    patch?: string;
}

export interface CommitInfo {
    sha: string;
    message: string;
    author: string;
    date: string;
}

export interface InlineComment {
    path: string;
    line: number;
    body: string;
}

/** Every platform client implements this. Nothing else in the codebase should know which platform it's talking to. */
export interface VcsClient {
    getPullRequest(id: number): Promise<PullRequestInfo>;
    getPullRequestFiles(id: number): Promise<ChangedFile[]>;
    getPullRequestCommits(id: number): Promise<CommitInfo[]>;
    upsertSummaryComment(id: number, body: string): Promise<void>;
    createReview(id: number, opts: { commitId: string; comments: InlineComment[] }): Promise<void>;
    listReviewCommentBodies(id: number): Promise<string[]>;
}