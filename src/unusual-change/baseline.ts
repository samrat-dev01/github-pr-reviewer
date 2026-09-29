import type { HistoricalCommit } from "../repository/history.js";

export interface Baseline {
    commits: number;
    areaCommits: Map<string, number>;
    coChange: Map<string, number>;
    p90Files: number;
}

const SKIP = /(^|\/)(node_modules|dist)\/|\.md$|package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$/;

/** An "area" is the first N directories of a path (src/user, .github/workflows, ...). */
export function areaOf(file: string, depth: number): string {
    const parts = file.split("/");
    return parts.length <= 1 ? "." : parts.slice(0, Math.min(depth, parts.length - 1)).join("/");
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function buildBaseline(history: HistoricalCommit[], depth: number): Baseline {
    const usable = history.filter((c) => c.files.length > 0 && c.files.length <= 60); // skip bulk commits
    const areaCommits = new Map<string, number>();
    const coChange = new Map<string, number>();

    for (const c of usable) {
        const areas = [...new Set(c.files.filter((f) => !SKIP.test(f)).map((f) => areaOf(f, depth)))];
        for (const a of areas) areaCommits.set(a, (areaCommits.get(a) ?? 0) + 1);
        for (let i = 0; i < areas.length; i++) {
            for (let j = i + 1; j < areas.length; j++) {
                const k = pairKey(areas[i], areas[j]);
                coChange.set(k, (coChange.get(k) ?? 0) + 1);
            }
        }
    }
    const sizes = usable.map((c) => c.files.length).sort((a, b) => a - b);
    return { commits: usable.length, areaCommits, coChange, p90Files: sizes[Math.floor(0.9 * (sizes.length - 1))] ?? 0 };
}