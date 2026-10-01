import { describe, expect, it } from "vitest";
import { detectLanguage, detectKind, buildReviewFiles } from "../src/diff/changed-files.js";

describe("detectLanguage", () => {
    it("detects TS/JS variants and Dockerfiles", () => {
        expect(detectLanguage("src/a.ts")).toBe("typescript");
        expect(detectLanguage("src/a.tsx")).toBe("typescript");
        expect(detectLanguage("src/a.js")).toBe("javascript");
        expect(detectLanguage("Dockerfile")).toBe("docker");
        expect(detectLanguage("Dockerfile.prod")).toBe("docker");
    });
});

describe("detectKind", () => {
    it("classifies workflows, lockfiles, tests, manifests", () => {
        expect(detectKind(".github/workflows/ci.yml", "yaml")).toBe("ci");
        expect(detectKind("package-lock.json", "json")).toBe("lockfile");
        expect(detectKind("package.json", "json")).toBe("manifest");
        expect(detectKind("src/user.test.ts", "typescript")).toBe("test");
        expect(detectKind("__tests__/user.ts", "typescript")).toBe("test");
        expect(detectKind("src/user.service.ts", "typescript")).toBe("source");
    });
});

describe("buildReviewFiles", () => {
    it("filters files matching an ignore glob", () => {
        const files = buildReviewFiles(
            [
                { path: "src/a.ts", status: "modified", additions: 1, deletions: 0 },
                { path: "dist/bundle.js", status: "modified", additions: 1, deletions: 0 },
            ],
            ["**/dist/**"],
        );
        expect(files).toHaveLength(1);
        expect(files[0].path).toBe("src/a.ts");
    });
});