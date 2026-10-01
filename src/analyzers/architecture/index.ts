import { minimatch } from "minimatch";
import { isJsTs } from "../../diff/changed-files.js";
import { findCycle } from "../../repository/graph.js";
import { newFinding, type Finding } from "../../review/types.js";
import type { Analyzer } from "../types.js";

export const architectureAnalyzer: Analyzer = {
    name: "architecture",
    async run(ctx) {
        const arch = ctx.config.architecture;
        const graph = await ctx.getGraph();
        const out: Finding[] = [];

        const layerOfFile = (p: string) =>
            arch && Object.entries(arch.layers).find(([, l]) => l.paths?.some((g) => minimatch(p, g, { dot: true })))?.[0];
        const layerOfPkg = (pkg: string) =>
            arch && Object.entries(arch.layers).find(([, l]) => l.packages?.includes(pkg))?.[0];

        for (const f of ctx.files) {
            if (!isJsTs(f) || f.status === "removed") continue;
            const fromLayer = layerOfFile(f.path);

            for (const e of graph.edges.get(f.path) ?? []) {
                if (!f.added.has(e.line)) continue; // only imports introduced by this PR

                const toLayer = e.external ? (e.pkg ? layerOfPkg(e.pkg) : undefined) : e.to ? layerOfFile(e.to) : undefined;
                if (arch && fromLayer && toLayer && fromLayer !== toLayer) {
                    for (const rule of arch.rules) {
                        if (rule.from === fromLayer && rule.cannotImport.includes(toLayer)) {
                            out.push(newFinding({
                                ruleId: "architecture/forbidden-import", category: "architecture", severity: "high", confidence: 0.95,
                                file: f.path, startLine: e.line, title: `Layer violation: ${fromLayer} → ${toLayer}`,
                                message: `\`${f.path}\` (layer "${fromLayer}") imports \`${e.module}\` (layer "${toLayer}"), which the repository's architecture rules disallow.`,
                                evidence: [{ kind: "rule", detail: `${rule.from} cannotImport [${rule.cannotImport.join(", ")}]` }],
                                suggestion: `Go through an allowed layer instead of importing "${toLayer}" directly.`,
                                source: "repository-analysis", key: e.module,
                            }));
                        }
                    }
                }

                if (!e.external && e.to && !e.typeOnly) {
                    const cycle = findCycle(graph, f.path, e.to);
                    if (cycle) {
                        out.push(newFinding({
                            ruleId: "architecture/circular-dependency", category: "architecture", severity: "medium", confidence: 0.9,
                            file: f.path, startLine: e.line, title: "Circular dependency introduced",
                            message: `This import creates a dependency cycle: ${cycle.join(" → ")}.`,
                            suggestion: "Extract the shared code into a separate module both sides can import.",
                            source: "repository-analysis", key: e.module,
                        }));
                    }
                }
            }
        }
        return out;
    },
};