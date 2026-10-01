import { describe, expect, it } from "vitest";
import { parsePatch, addedLines } from "../src/diff/parser.js";
import { parseFileIR } from "../src/parser/ir.js";

describe("diff parser", () => {
    it("maps added lines to new-file numbers", () => {
        const patch = "@@ -1,2 +1,3 @@\n a\n+b\n c";
        expect([...addedLines(parsePatch(patch)).entries()]).toEqual([[2, "b"]]);
    });
});

describe("ts ir", () => {
    it("extracts imports, functions and complexity", () => {
        const ir = parseFileIR("a.ts", `import x from "./x";\nfunction f(a){ if(a && a.b){ return 1 } return 2 }`);
        expect(ir.imports[0].module).toBe("./x");
        expect(ir.symbols[0]).toMatchObject({ name: "f", params: 1, complexity: 3 });
    });
});