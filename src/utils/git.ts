import { run } from "./exec.js";

export async function git(repoRoot: string, args: string[]): Promise<string | undefined> {
    const r = await run("git", args, { cwd: repoRoot });
    return r.code === 0 ? r.stdout : undefined;
}

export const gitShow = (repoRoot: string, ref: string, file: string) =>
    git(repoRoot, ["show", `${ref}:${file}`]);