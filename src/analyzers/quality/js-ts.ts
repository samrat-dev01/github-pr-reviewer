import fs from "node:fs/promises";
import path from "node:path";
import { isJsTs, type ReviewFile } from "../../diff/changed-files.js";
import { parseFileIR } from "../../parser/ir.js";
import { newFinding, type Category, type Finding, type Severity } from "../../review/types.js";
import type { Analyzer } from "../types.js";

interface LineRule {
    id: string; re: RegExp; category: Category; severity: Severity; confidence: number;
    title: string; message: string; skipTests?: boolean;
}

const LINE_RULES: LineRule[] = [
    { id: "js/eval", re: /\beval\s*\(/, category: "security", severity: "high", confidence: 0.85, title: "Use of eval()", message: "eval() executes arbitrary strings as code. Prefer a safe alternative such as JSON.parse or a lookup table." },
    { id: "js/new-function", re: /\bnew\s+Function\s*\(/, category: "security", severity: "high", confidence: 0.85, title: "Dynamic code via new Function()", message: "new Function() compiles strings into code at runtime, which is risky with untrusted input." },
    { id: "js/shell-interpolation", re: /\b(?:exec|execSync)\s*\(\s*`[^`]*\$\{/, category: "security", severity: "high", confidence: 0.8, title: "Shell command built from interpolated string", message: "Interpolating values into a shell command can allow command injection. Use execFile with an argument array." },
    { id: "js/inner-html", re: /\.innerHTML\s*=(?!=)|dangerouslySetInnerHTML/, category: "security", severity: "medium", confidence: 0.75, title: "Raw HTML injection", message: "Assigning raw HTML can enable XSS if any part is user-controlled. Sanitize or use text APIs." },
    { id: "js/tls-disabled", re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/, category: "security", severity: "high", confidence: 0.9, title: "TLS verification disabled", message: "Disabling certificate verification exposes connections to interception." },
    { id: "js/debugger", re: /^\s*debugger\s*;?\s*$/, category: "quality", severity: "low", confidence: 0.9, title: "debugger statement", message: "Remove debugger statements before merging.", skipTests: true },
    { id: "js/suppression", re: /@ts-ignore|@ts-nocheck|eslint-disable(?!-next-line)/, category: "quality", severity: "low", confidence: 0.8, title: "Type/lint check suppressed", message: "A compiler or lint check is suppressed. Prefer fixing the cause or add a short justification.", skipTests: true },
];

function touches(added: Map<number, string>, a: number, b: number): boolean {
    for (const ln of added.keys()) if (ln >= a && ln <= b) return true;
    return false;
}

export const jsTsQualityAnalyzer: Analyzer = {
    name: "js-ts-quality",
    async run(ctx) {
        const out: Finding[] = [];
        const { limits } = ctx.config;

        for (const f of ctx.files as ReviewFile[]) {
            if (!isJsTs(f) || f.status === "removed") continue;
            let text: string;
            try { text = await fs.readFile(path.join(ctx.repoRoot, f.path), "utf8"); } catch { continue; }

            const ir = parseFileIR(f.path, text);
            for (const s of ir.symbols) {
                if (s.type === "class" || !touches(f.added, s.line, s.endLine)) continue;
                const size = s.endLine - s.line + 1;
                if (size > limits.maxFunctionLines) {
                    out.push(newFinding({
                        ruleId: "js/large-function", category: "quality", severity: "medium",
                        confidence: size > limits.maxFunctionLines * 1.5 ? 0.9 : 0.85,
                        file: f.path, startLine: s.line, endLine: s.endLine, title: `Large function: ${s.name}`,
                        message: `\`${s.name}\` is ${size} lines long (limit ${limits.maxFunctionLines}). Consider extracting cohesive parts.`,
                        evidence: [{ kind: "metric", detail: `${size} lines` }], source: "rule-engine", key: `${s.name}`,
                    }));
                }
                if (s.complexity > limits.maxComplexity) {
                    out.push(newFinding({
                        ruleId: "js/high-complexity", category: "complexity", severity: "medium",
                        confidence: s.complexity > limits.maxComplexity * 1.5 ? 0.9 : 0.85,
                        file: f.path, startLine: s.line, endLine: s.endLine, title: `High complexity: ${s.name}`,
                        message: `\`${s.name}\` has cyclomatic complexity ${s.complexity} (limit ${limits.maxComplexity}). Branch-heavy code is hard to test and review.`,
                        evidence: [{ kind: "metric", detail: `complexity ${s.complexity}` }], source: "rule-engine", key: `${s.name}`,
                    }));
                }
                if (s.params > limits.maxParams) {
                    out.push(newFinding({
                        ruleId: "js/too-many-params", category: "quality", severity: "low", confidence: 0.8,
                        file: f.path, startLine: s.line, title: `Too many parameters: ${s.name}`,
                        message: `\`${s.name}\` takes ${s.params} parameters (limit ${limits.maxParams}). Consider an options object.`,
                        source: "rule-engine", key: `${s.name}`,
                    }));
                }
            }

            for (const [line, content] of f.added) {
                const t = content.trim();
                if (t.startsWith("//") || t.startsWith("*")) continue;
                for (const r of LINE_RULES) {
                    if (r.skipTests && f.kind === "test") continue;
                    if (!r.re.test(content)) continue;
                    out.push(newFinding({
                        ruleId: r.id, category: r.category, severity: r.severity, confidence: r.confidence,
                        file: f.path, startLine: line, title: r.title, message: r.message,
                        evidence: [{ kind: "code", detail: t.slice(0, 160) }], source: "rule-engine", key: t.slice(0, 60),
                    }));
                }
            }
        }
        return out;
    },
};