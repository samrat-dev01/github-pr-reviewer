import { git } from "../utils/git.js";
import { run } from "../utils/exec.js";

export interface HistoricalCommit { sha: string; files: string[] }

export async function loadHistory(repoRoot: string, ref: string, maxCommits: number): Promise<HistoricalCommit[]> {
    if ((await git(repoRoot, ["rev-parse", "--is-shallow-repository"]))?.trim() === "true") {
        throw new Error("shallow clone: history unavailable (use fetch-depth: 0); unusual-change detection skipped");
    }
    const r = await run("git", ["log", ref, "--no-merges", `-n${maxCommits}`, "--name-only", "--pretty=format:@@@%H"], { cwd: repoRoot });
    if (r.code !== 0) throw new Error(`git log failed: ${r.stderr.slice(0, 200)}`);

    const commits: HistoricalCommit[] = [];
    let cur: HistoricalCommit | undefined;
    for (const line of r.stdout.split("\n")) {
        if (line.startsWith("@@@")) {
            cur = { sha: line.slice(3).trim(), files: [] };
            commits.push(cur);
        } else if (line.trim() && cur) cur.files.push(line.trim());
    }
    return commits;
}