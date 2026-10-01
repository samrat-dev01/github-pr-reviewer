import type { VcsClient, PullRequestInfo, ChangedFile, InlineComment } from "../types.js";

export interface GitLabClientOptions {
    baseUrl: string;   // e.g. "https://gitlab.com" or self-hosted URL
    token: string;
    projectId: string; // GitLab uses numeric or URL-encoded "owner%2Frepo" project IDs
}

export class GitLabClient implements VcsClient {
    constructor(private opts: GitLabClientOptions) { }

    private api(path: string) {
        return `${this.opts.baseUrl.replace(/\/$/, "")}/api/v4/projects/${encodeURIComponent(this.opts.projectId)}${path}`;
    }
    private headers() {
        return { "PRIVATE-TOKEN": this.opts.token, "Content-Type": "application/json" };
    }

    async getPullRequest(iid: number): Promise<PullRequestInfo> {
        const res = await fetch(this.api(`/merge_requests/${iid}`), { headers: this.headers() });
        if (!res.ok) throw new Error(`GitLab MR fetch ${res.status}`);
        const d = await res.json();
        return {
            number: d.iid, title: d.title, body: d.description ?? "", author: d.author?.username ?? "unknown",
            baseSha: d.diff_refs?.base_sha, headSha: d.diff_refs?.head_sha,
            baseRef: d.target_branch, headRef: d.source_branch,
            labels: d.labels ?? [], draft: !!d.draft || /^draft:/i.test(d.title),
        };
    }

    async getPullRequestFiles(iid: number): Promise<ChangedFile[]> {
        const res = await fetch(this.api(`/merge_requests/${iid}/diffs`), { headers: this.headers() });
        if (!res.ok) throw new Error(`GitLab MR diffs fetch ${res.status}`);
        const diffs = await res.json();
        return diffs.map((d: { new_path: string; old_path: string; new_file: boolean; deleted_file: boolean; renamed_file: boolean; diff: string }) => ({
            path: d.new_path,
            previousPath: d.renamed_file ? d.old_path : undefined,
            status: d.new_file ? "added" : d.deleted_file ? "removed" : d.renamed_file ? "renamed" : "modified",
            additions: (d.diff.match(/^\+/gm) ?? []).length,
            deletions: (d.diff.match(/^-/gm) ?? []).length,
            patch: d.diff,
        }));
    }

    async getPullRequestCommits(iid: number) {
        const res = await fetch(this.api(`/merge_requests/${iid}/commits`), { headers: this.headers() });
        const commits = await res.json();
        return commits.map((c: { id: string; title: string; author_name: string; created_at: string }) => ({
            sha: c.id, message: c.title, author: c.author_name, date: c.created_at,
        }));
    }

    async upsertSummaryComment(iid: number, body: string) {
        const marker = "<!-- pr-reviewer:summary -->";
        const fullBody = `${marker}\n${body}`;
        const listRes = await fetch(this.api(`/merge_requests/${iid}/notes`), { headers: this.headers() });
        const notes = await listRes.json();
        const existing = notes.find((n: { body: string }) => n.body?.includes(marker));

        if (existing) {
            await fetch(this.api(`/merge_requests/${iid}/notes/${existing.id}`), {
                method: "PUT", headers: this.headers(), body: JSON.stringify({ body: fullBody }),
            });
        } else {
            await fetch(this.api(`/merge_requests/${iid}/notes`), {
                method: "POST", headers: this.headers(), body: JSON.stringify({ body: fullBody }),
            });
        }
    }

    async createReview(iid: number, opts: { commitId: string; comments: InlineComment[] }) {
        const pr = await this.getPullRequest(iid);
        for (const c of opts.comments) {
            await fetch(this.api(`/merge_requests/${iid}/discussions`), {
                method: "POST", headers: this.headers(),
                body: JSON.stringify({
                    body: c.body,
                    position: {
                        position_type: "text",
                        base_sha: pr.baseSha, start_sha: pr.baseSha, head_sha: pr.headSha,
                        new_path: c.path, new_line: c.line,
                    },
                }),
            });
        }
    }

    async listReviewCommentBodies(iid: number): Promise<string[]> {
        const res = await fetch(this.api(`/merge_requests/${iid}/discussions`), { headers: this.headers() });
        const discussions = await res.json();
        return discussions.flatMap((d: { notes: { body: string }[] }) => d.notes.map((n) => n.body));
    }
}