import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadRepoConfig } from "../src/repo-config.js";

describe("loadRepoConfig", () => {
    it("falls back to defaults when no config file exists", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cfg-"));
        const cfg = await loadRepoConfig(dir);
        expect(cfg.thresholds.inline).toBe(0.9);
        expect(cfg.architecture).toBeUndefined();
    });

    it("merges a real .pr-reviewer.yml over the defaults", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cfg-"));
        await fs.writeFile(
            path.join(dir, ".pr-reviewer.yml"),
            "thresholds:\n  inline: 0.99\narchitecture:\n  layers:\n    controller: { paths: ['src/controller/**'] }\n  rules:\n    - from: controller\n      cannotImport: [database]\n",
        );
        const cfg = await loadRepoConfig(dir);
        expect(cfg.thresholds.inline).toBe(0.99);
        expect(cfg.thresholds.summary).toBe(0.7); // untouched default
        expect(cfg.architecture?.rules[0].from).toBe("controller");
    });
});