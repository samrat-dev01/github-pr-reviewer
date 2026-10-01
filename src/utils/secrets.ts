export const SECRET_PATTERNS: { id: string; label: string; re: RegExp; confidence: number }[] = [
    { id: "private-key", label: "Private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, confidence: 0.97 },
    { id: "aws-access-key", label: "AWS access key ID", re: /\bAKIA[0-9A-Z]{16}\b/g, confidence: 0.95 },
    { id: "github-token", label: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, confidence: 0.95 },
    { id: "slack-token", label: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, confidence: 0.93 },
    {
        id: "generic-secret",
        label: "Hardcoded credential-like value",
        re: /\b[a-z0-9_]*(?:api[_-]?key|secret|token|passwd|password)[a-z0-9_]*\s*[:=]\s*['"][^'"\s]{12,}['"]/gi,
        confidence: 0.75,
    },
];

export const isPlaceholder = (s: string) => /example|placeholder|your[_-]|xxx|\*\*\*|<.+>|changeme|dummy/i.test(s);

export function mask(s: string): string {
    return s.length <= 8 ? "****" : `${s.slice(0, 4)}…****`;
}

/** Remove secret-looking strings before anything is sent to the LLM. */
export function redact(text: string): string {
    let out = text;
    for (const p of SECRET_PATTERNS) out = out.replace(p.re, "[REDACTED]");
    return out;
}