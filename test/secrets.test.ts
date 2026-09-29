import { describe, expect, it } from "vitest";
import { redact, isPlaceholder, mask } from "../src/utils/secrets.js";

describe("redact", () => {
    it("removes AWS-style access keys", () => {
        expect(redact("key = AKIAABCDEFGHIJKLMNOP")).toContain("[REDACTED]");
    });
    it("removes private key blocks", () => {
        expect(redact("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END-----")).toContain("[REDACTED]");
    });
    it("leaves normal code untouched", () => {
        const code = "const x = computeTotal(price, tax);";
        expect(redact(code)).toBe(code);
    });
});

describe("isPlaceholder", () => {
    it("flags obvious placeholders", () => {
        expect(isPlaceholder("your_api_key_here")).toBe(true);
        expect(isPlaceholder("example_token_xxx")).toBe(true);
    });
    it("does not flag real-looking values", () => {
        expect(isPlaceholder("sk_live_9f8a7b6c5d4e3f2a1b0c")).toBe(false);
    });
});

describe("mask", () => {
    it("keeps a short prefix only", () => {
        expect(mask("sk_live_9f8a7b6c5d4e3f2a1b0c")).toBe("sk_l…****");
    });
});