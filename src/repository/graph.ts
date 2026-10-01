import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { parseFileIR, type FileIR, type IRImport } from "../parser/ir.js";

export interface GraphEdge {
    from: string; to?: string; module: string; line: number;
    external: boolean; pkg?: string; typeOnly: boolean;
}
export interface RepoGraph {
    files: Set<string>;
    edges: Map<string, GraphEdge[]>;
    irs: Map<string, FileIR>;
}

const EXTS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"];

function resolveImport(from: string, imp: IRImport, files: Set<string>): GraphEdge {
    const base = { from, module: imp.module, line: imp.line, typeOnly: imp.typeOnly };
    if (imp.module.startsWith(".")) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), imp.module));
        const stripped = target.replace(/\.[cm]?jsx?$/, ""); // TS ESM style: ./x.js -> x.ts
        const candidates = [
            target,
            ...EXTS.map((e) => target + e),
            ...EXTS.map((e) => `${target}/index${e}`),
            ...(stripped !== target ? EXTS.map((e) => stripped + e) : []),
        ];
        return { ...base, to: candidates.find((c) => files.has(c)), external: false };
    }
    const name = imp.module.replace(/^node:/, "");
    const pkg = name.startsWith("@") ? name.split("/").slice(0, 2).join("/") : name.split("/")[0];
    return { ...base, external: true, pkg };
}

export async function buildGraph(repoRoot: string, ignore: string[]): Promise<RepoGraph> {
    const paths = (await fg(["**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}"], { cwd: repoRoot, ignore }))
        .map((p) => p.replace(/\\/g, "/"));
    const files = new Set(paths);
    const irs = new Map<string, FileIR>();

    for (let i = 0; i < paths.length; i += 64) {
        await Promise.all(paths.slice(i, i + 64).map(async (p) => {
            try {
                const text = await fs.readFile(path.join(repoRoot, p), "utf8");
                if (text.length < 1_000_000) irs.set(p, parseFileIR(p, text));
            } catch { /* unreadable: skip */ }
        }));
    }

    const edges = new Map<string, GraphEdge[]>();
    for (const [file, ir] of irs) edges.set(file, ir.imports.map((i) => resolveImport(file, i, files)));
    return { files, edges, irs };
}

/** BFS from `to` looking for a way back to `start` via runtime imports. */
export function findCycle(graph: RepoGraph, start: string, to: string): string[] | undefined {
    if (start === to) return [start, start];
    const prev = new Map<string, string>([[to, start]]);
    const queue = [to];
    while (queue.length && prev.size < 5000) {
        const cur = queue.shift()!;
        for (const e of graph.edges.get(cur) ?? []) {
            if (e.external || !e.to || e.typeOnly || prev.has(e.to)) continue;
            prev.set(e.to, cur);
            if (e.to === start) {
                const chain = [start];
                for (let n = cur; n !== start; n = prev.get(n)!) chain.push(n);
                chain.push(start);
                return chain.reverse();
            }
            queue.push(e.to);
        }
    }
    return undefined;
}