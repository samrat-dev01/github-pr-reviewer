import fs from "node:fs/promises";
import path from "node:path";
import { newFinding, type Finding } from "../../review/types.js";
import { gitShow } from "../../utils/git.js";
import type { Analyzer } from "../types.js";

type DepMap = Record<string, string>;
interface Manifest { scripts?: DepMap;[k: string]: unknown }
const SECTIONS = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"] as const;
const LIFECYCLE = ["preinstall", "install", "postinstall", "prepare"];
const major = (r: string) => r.match(/(\d+)/)?.[1];
const exact = (r: string) => r.match(/\d+\.\d+\.\d+/)?.[0];
const NON_REGISTRY = /^(git\+|git:|github:|https?:|file:|link:)|^[\w-]+\/[\w.-]+(#.*)?$/;

async function osvCheck(items: { name: string; version: string }[]): Promise<Map<string, string[]>> {
    const found = new Map<string, string[]>();
    if (!items.length) return found;
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: items.map((i) => ({ version: i.version, package: { name: i.name, ecosystem: "npm" } })) }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`OSV returned ${res.status}`);
    const data = (await res.json()) as { results: { vulns?: { id: string }[] }[] };
    data.results.forEach((r, i) => {
        if (r.vulns?.length) found.set(`${items[i].name}@${items[i].version}`, r.vulns.map((v) => v.id));
    });
    return found;
}

export const dependencyAnalyzer: Analyzer = {
    name: "dependencies",
    async run(ctx) {
        const out: Finding[] = [];
        const manifests = ctx.files.filter((f) => f.kind === "manifest" && f.status !== "removed");
        const lockChanged = ctx.files.some((f) => f.kind === "lockfile");

        if (lockChanged && !manifests.length) {
            out.push(newFinding({
                ruleId: "dependency/lockfile-only", category: "dependency", severity: "medium", confidence: 0.85,
                title: "Lockfile changed without package.json",
                message: "The lockfile changed but package.json did not. Verify the resolved dependency changes are intentional.",
                source: "rule-engine",
            }));
        }

        const osvQueue: { name: string; version: string; file: string }[] = [];

        for (const m of manifests) {
            let head: Manifest;
            let base: Manifest = {};
            try { head = JSON.parse(await fs.readFile(path.join(ctx.repoRoot, m.path), "utf8")); } catch { continue; }
            if (m.status !== "added") {
                const b = await gitShow(ctx.repoRoot, ctx.pr.baseSha, m.path);
                try { if (b) base = JSON.parse(b); } catch { /* treat as empty */ }
            }

            const added: string[] = [];
            const majors: string[] = [];
            for (const s of SECTIONS) {
                const h = (head[s] ?? {}) as DepMap;
                const b = (base[s] ?? {}) as DepMap;
                for (const [name, range] of Object.entries(h)) {
                    if (b[name] === range) continue;
                    const v = exact(range);
                    if (v) osvQueue.push({ name, version: v, file: m.path });
                    if (NON_REGISTRY.test(range)) {
                        out.push(newFinding({
                            ruleId: "dependency/non-registry", category: "dependency", severity: "medium", confidence: 0.85,
                            file: m.path, title: `Non-registry dependency: ${name}`,
                            message: `\`${name}\` is installed from \`${range}\` instead of the npm registry, so it bypasses registry integrity and advisory checks.`,
                            source: "rule-engine", key: name,
                        }));
                    }
                    if (b[name] === undefined) added.push(`${name}@${range}${s === "dependencies" ? "" : ` (${s})`}`);
                    else if (major(range) && major(b[name]) && Number(major(range)) > Number(major(b[name]))) {
                        majors.push(`${name}: ${b[name]} → ${range}`);
                    }
                }
            }
            if (added.length) {
                out.push(newFinding({
                    ruleId: "dependency/new-dependency", category: "dependency", severity: "low", confidence: 0.8,
                    file: m.path, title: `${added.length} new dependenc${added.length === 1 ? "y" : "ies"}`,
                    message: `New dependencies: ${added.join(", ")}. Confirm they are needed, maintained and appropriately licensed.`,
                    source: "rule-engine",
                }));
            }
            if (majors.length) {
                out.push(newFinding({
                    ruleId: "dependency/major-upgrade", category: "dependency", severity: "medium", confidence: 0.85,
                    file: m.path, title: "Major version upgrades",
                    message: `Major upgrades can include breaking changes: ${majors.join("; ")}.`,
                    source: "rule-engine",
                }));
            }
            for (const k of LIFECYCLE) {
                const now = head.scripts?.[k];
                if (now && now !== base.scripts?.[k]) {
                    out.push(newFinding({
                        ruleId: "dependency/install-script", category: "security", severity: "high", confidence: 0.9,
                        file: m.path, title: `Install lifecycle script changed: ${k}`,
                        message: `The \`${k}\` script runs automatically during install and is now \`${now.slice(0, 120)}\`. Verify it is intentional.`,
                        source: "rule-engine", key: k,
                    }));
                }
            }
            if (!lockChanged && (added.length || majors.length)) {
                out.push(newFinding({
                    ruleId: "dependency/manifest-without-lockfile", category: "dependency", severity: "low", confidence: 0.75,
                    file: m.path, title: "Dependencies changed without lockfile update",
                    message: "package.json dependencies changed but no lockfile change is included.",
                    source: "rule-engine",
                }));
            }
        }

        // Known vulnerabilities (OSV), using versions taken from package.json ranges
        const vulns = await osvCheck(osvQueue.slice(0, 100));
        for (const [pkg, ids] of vulns) {
            const q = osvQueue.find((i) => `${i.name}@${i.version}` === pkg)!;
            out.push(newFinding({
                ruleId: "dependency/known-vulnerability", category: "dependency", severity: "high", confidence: 0.8,
                file: q.file, title: `Known advisories: ${pkg}`,
                message: `${pkg} has advisories in OSV: ${ids.slice(0, 5).join(", ")}. The version comes from the package.json range, so confirm against the lockfile.`,
                source: "static-analyzer", key: pkg,
            }));
        }
        return out;
    },
};