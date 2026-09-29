import { z } from "zod";

const SeverityInput = z.string().transform((s) => s.toLowerCase().trim());
const Severity = z.enum(["info", "low", "medium", "high", "critical"]);

export const VerdictSchema = z.object({
    valid: z.boolean(),
    severity: SeverityInput.pipe(Severity),
    confidence: z.coerce.number().min(0).max(1),
    reason: z.string().min(1),
    suggestion: z.string(),
    comment: z.string().min(1),
});
export type Verdict = z.infer<typeof VerdictSchema>;

// JSON schema handed to Ollama's structured-output `format` parameter
export const VERDICT_JSON_SCHEMA = {
    type: "object",
    properties: {
        valid: { type: "boolean" },
        severity: { type: "string", enum: ["info", "low", "medium", "high", "critical"] },
        confidence: { type: "number" },
        reason: { type: "string" },
        suggestion: { type: "string" },
        comment: { type: "string" },
    },
    required: ["valid", "severity", "confidence", "reason", "suggestion", "comment"],
};