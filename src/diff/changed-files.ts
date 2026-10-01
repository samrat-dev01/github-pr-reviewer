import path from "node:path";
import { minimatch } from "minimatch";
import { addedLines, commentableLines, parsePatch, type Hunk } from "./parser.js";
import { ChangedFile } from "../vcs/types.js";

export type Language =
    | "javascript" | "typescript" | "json" | "yaml" | "markdown"
    | "shell" | "docker" | "css" | "html" | "other";
export type FileKind =
    | "source" | "test" | "config" | "ci" | "docker" | "lockfile"
    | "manifest" | "docs" | "script" | "other";

export interface ReviewFile extends ChangedFile {
    language: Language;
    kind: FileKind;
    hunks: Hunk[];
    added: Map<number, string>;
    commentable: Set<number>;
}

const EXT: Record<string, Language> = {
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "typescript", ".mts": "typescript", ".cts": "typescript",
    ".json": "json", ".yml": "yaml", ".yaml": "yaml", ".md": "markdown",
    ".sh": "shell", ".ps1": "shell", ".css": "css", ".html": "html",
};

export function detectLanguage(p: string): Language {
    if (/^Dockerfile/i.test(path.posix.basename(p))) return "docker";
    return EXT[path.posix.extname(p).toLowerCase()] ?? "other";
}

export function detectKind(p: string, language: Language): FileKind {
    const base = path.posix.basename(p);
    if (/^\.github\/workflows\//.test(p) || /^\.circleci\//.test(p) || base === ".gitlab-ci.yml" || base === "Jenkinsfile") return "ci";
    if (/^Dockerfile/i.test(base) || /^docker-compose/i.test(base) || base === ".dockerignore") return "docker";
    if (["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "npm-shrinkwrap.json"].includes(base)) return "lockfile";
    if (base === "package.json") return "manifest";
    if (/(^|\/)(__tests__|tests?|e2e|__mocks__)\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(base)) return "test";
    if (language === "markdown" || /^docs?\//.test(p)) return "docs";
    if (language === "shell" || base === "Makefile") return "script";
    if (language === "javascript" || language === "typescript") {
        return /\.config\.[cm]?[jt]s$/.test(base) || /^\.eslintrc/.test(base) ? "config" : "source";
    }
    if (/^\.env/.test(base) || /^tsconfig.*\.json$/.test(base) || language === "yaml" || language === "json") return "config";
    return "other";
}

export const isJsTs = (f: { language: Language }) => f.language === "javascript" || f.language === "typescript";

export function buildReviewFiles(changed: ChangedFile[], ignore: string[]): ReviewFile[] {
    return changed
        .filter((f) => !ignore.some((g) => minimatch(f.path, g, { dot: true })))
        .map((f) => {
            const language = detectLanguage(f.path);
            const hunks = f.patch ? parsePatch(f.patch) : [];
            return {
                ...f, language, kind: detectKind(f.path, language),
                hunks, added: addedLines(hunks), commentable: commentableLines(hunks),
            };
        });
}