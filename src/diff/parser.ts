export interface DiffLine {
    type: "add" | "del" | "context";
    content: string;
    oldLine?: number;
    newLine?: number;
}
export interface Hunk {
    oldStart: number; oldLines: number; newStart: number; newLines: number;
    lines: DiffLine[];
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parsePatch(patch: string): Hunk[] {
    const hunks: Hunk[] = [];
    let cur: Hunk | undefined;
    let oldLine = 0;
    let newLine = 0;
    for (const raw of patch.split("\n")) {
        const m = HUNK_RE.exec(raw);
        if (m) {
            cur = {
                oldStart: +m[1], oldLines: m[2] === undefined ? 1 : +m[2],
                newStart: +m[3], newLines: m[4] === undefined ? 1 : +m[4], lines: [],
            };
            hunks.push(cur);
            oldLine = cur.oldStart;
            newLine = cur.newStart;
            continue;
        }
        if (!cur) continue;
        const c = raw[0];
        const content = raw.slice(1);
        if (c === "+") cur.lines.push({ type: "add", content, newLine: newLine++ });
        else if (c === "-") cur.lines.push({ type: "del", content, oldLine: oldLine++ });
        else if (c === " ") cur.lines.push({ type: "context", content, oldLine: oldLine++, newLine: newLine++ });
        // "\ No newline at end of file" and blanks are ignored
    }
    return hunks;
}

/** new-file line number -> content, for added lines only */
export function addedLines(hunks: Hunk[]): Map<number, string> {
    const m = new Map<number, string>();
    for (const h of hunks) for (const l of h.lines) if (l.type === "add" && l.newLine) m.set(l.newLine, l.content);
    return m;
}

/** Lines GitHub accepts inline comments on (RIGHT side of the diff) */
export function commentableLines(hunks: Hunk[]): Set<number> {
    const s = new Set<number>();
    for (const h of hunks) for (const l of h.lines) if (l.type !== "del" && l.newLine) s.add(l.newLine);
    return s;
}