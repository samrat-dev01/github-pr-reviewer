export interface GiteaClientOptions {
    baseUrl: string;   // e.g. "https://gitea.example.com"
    token: string;
    owner: string;
    repo: string;
}

import type { ChangedFile, CommitInfo, FileStatus, InlineComment } from "../types.js";

/** Splits a combined `git diff`-style output (as returned by Gitea's /pulls/{index}.diff)
 *  into per-file entries, in the same shape as GitHub's listFiles(). */
function parseUnifiedDiffIntoFiles(diffText: string): ChangedFile[] {
    const files: ChangedFile[] = [];
    // Split on "diff --git a/X b/Y" headers, keeping the header with each chunk.
    const chunks = diffText.split(/^diff --git /m).filter(Boolean);

    for (const chunk of chunks) {
        const body = "diff --git " + chunk;
        const headerMatch = /^diff --git a\/(.+?) b\/(.+?)$/m.exec(body);
        if (!headerMatch) continue;
        const [, aPath, bPath] = headerMatch;

        const isNew = /^new file mode/m.test(body);
        const isDeleted = /^deleted file mode/m.test(body);
        const renameMatch = /^rename from (.+)$/m.exec(body);
        const isRenamed = !!renameMatch;

        let status: FileStatus = "modified";
        if (isNew) status = "added";
        else if (isDeleted) status = "removed";
        else if (isRenamed) status = "renamed";

        // The actual patch content starts at the first "@@" hunk header.
        const hunkStart = body.indexOf("\n@@");
        const patch = hunkStart >= 0 ? body.slice(hunkStart + 1) : undefined;

        const additions = patch ? (patch.match(/^\+(?!\+\+)/gm) ?? []).length : 0;
        const deletions = patch ? (patch.match(/^-(?!--)/gm) ?? []).length : 0;

        files.push({
            path: bPath === "/dev/null" ? aPath : bPath,
            previousPath: isRenamed ? aPath : undefined,
            status,
            additions,
            deletions,
            patch,
        });
    }

    return files;
}

export const SUMMARY_MARKER = "<!-- pr-reviewer:summary -->";

export class GiteaClient {
    constructor(private opts: GiteaClientOptions) { }

    private api(path: string) {
        return `${this.opts.baseUrl.replace(/\/$/, "")}/api/v1${path}`;
    }
    private headers() {
        return { Authorization: `token ${this.opts.token}`, "Content-Type": "application/json" };
    }

    async getPullRequest(index: number) {
        const res = await fetch(this.api(`/repos/${this.opts.owner}/${this.opts.repo}/pulls/${index}`), { headers: this.headers() });
        if (!res.ok) throw new Error(`Gitea getPullRequest ${res.status}`);
        const d = await res.json();
        return {
            number: d.number, title: d.title, body: d.body ?? "", author: d.user?.login ?? "unknown",
            baseSha: d.base.sha, headSha: d.head.sha, baseRef: d.base.ref, headRef: d.head.ref,
            labels: (d.labels ?? []).map((l: { name: string }) => l.name), draft: !!d.draft,
        };
    }

    async getPullRequestFiles(index: number) {
        // Gitea exposes a diff endpoint rather than a per-file "files" list like GitHub's.
        const res = await fetch(this.api(`/repos/${this.opts.owner}/${this.opts.repo}/pulls/${index}.diff`), { headers: this.headers() });
        if (!res.ok) throw new Error(`Gitea diff fetch ${res.status}`);
        const diffText = await res.text();
        return parseUnifiedDiffIntoFiles(diffText); // small helper: split combined diff by "diff --git" and reuse your existing patch parser per file
    }

    async getPullRequestCommits(index: number): Promise<CommitInfo[]> {
        const res = await fetch(
            this.api(`/repos/${this.opts.owner}/${this.opts.repo}/pulls/${index}/commits`),
            { headers: this.headers() },
        );
        if (!res.ok) throw new Error(`Gitea commits fetch ${res.status}`);
        const commits = await res.json();
        return commits.map((c: {
            sha: string;
            commit: { message: string; author: { name: string; date: string } };
        }) => ({
            sha: c.sha,
            message: c.commit.message,
            author: c.commit.author?.name ?? "unknown",
            date: c.commit.author?.date ?? "",
        }));
    }

    async createReview(index: number, opts: { commitId: string; comments: InlineComment[] }): Promise<void> {
        if (!opts.comments.length) return;
        const res = await fetch(
            this.api(`/repos/${this.opts.owner}/${this.opts.repo}/pulls/${index}/reviews`),
            {
                method: "POST",
                headers: this.headers(),
                body: JSON.stringify({
                    commit_id: opts.commitId,
                    event: "COMMENT",
                    comments: opts.comments.map((c) => ({
                        path: c.path,
                        new_position: c.line,
                        body: c.body,
                    })),
                }),
            },
        );
        if (!res.ok) throw new Error(`Gitea createReview ${res.status}: ${await res.text()}`);
    }

    async listReviewCommentBodies(index: number): Promise<string[]> {
        const res = await fetch(
            this.api(`/repos/${this.opts.owner}/${this.opts.repo}/pulls/${index}/reviews`),
            { headers: this.headers() },
        );
        if (!res.ok) throw new Error(`Gitea list reviews ${res.status}`);
        const reviews = await res.json();

        const bodies: string[] = [];
        for (const r of reviews) {
            const cRes = await fetch(
                this.api(`/repos/${this.opts.owner}/${this.opts.repo}/pulls/${index}/reviews/${r.id}/comments`),
                { headers: this.headers() },
            );
            if (!cRes.ok) continue; // skip a bad review rather than failing the whole list
            const comments = await cRes.json();
            bodies.push(...comments.map((c: { body: string }) => c.body));
        }
        return bodies;
    }

    async upsertSummaryComment(index: number, body: string) {
        const fullBody = `${SUMMARY_MARKER}\n${body}`;
        const listRes = await fetch(
            this.api(`/repos/${this.opts.owner}/${this.opts.repo}/issues/${index}/comments`),
            { headers: this.headers() },
        );
        if (!listRes.ok) {
            throw new Error(`Gitea list comments failed: ${listRes.status} ${await listRes.text()}`);
        }
        const comments = await listRes.json();
        if (!Array.isArray(comments)) {
            throw new Error(`Gitea list comments returned non-array: ${JSON.stringify(comments).slice(0, 300)}`);
        }

        const existing = comments.find((c: { body: string }) => c.body?.includes(SUMMARY_MARKER));

        if (existing) {
            const res = await fetch(
                this.api(`/repos/${this.opts.owner}/${this.opts.repo}/issues/comments/${existing.id}`),
                { method: "PATCH", headers: this.headers(), body: JSON.stringify({ body: fullBody }) },
            );
            if (!res.ok) throw new Error(`Gitea update comment failed: ${res.status} ${await res.text()}`);
        } else {
            const res = await fetch(
                this.api(`/repos/${this.opts.owner}/${this.opts.repo}/issues/${index}/comments`),
                { method: "POST", headers: this.headers(), body: JSON.stringify({ body: fullBody }) },
            );
            if (!res.ok) throw new Error(`Gitea create comment failed: ${res.status} ${await res.text()}`);
        }
    }

    async createInlineComment(index: number, path: string, line: number, body: string) {
        // Gitea's inline PR review comments live under /pulls/{index}/reviews
        await fetch(this.api(`/repos/${this.opts.owner}/${this.opts.repo}/pulls/${index}/reviews`), {
            method: "POST", headers: this.headers(),
            body: JSON.stringify({ event: "COMMENT", comments: [{ path, new_position: line, body }] }),
        });
    }
}