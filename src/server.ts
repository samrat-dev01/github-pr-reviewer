import express, { type Request } from "express";
import crypto from "node:crypto";
import { loadConfig } from "./config.js";
import { runReviewPipeline } from "./pipeline.js";
import type { Config } from "./config.js";
import { Platform } from "./vcs/types.js";

declare global {
    namespace Express {
        interface Request {
            rawBody?: Buffer;
        }
    }
}

const app = express();

app.use(
    express.json({
        verify: (req, _res, buf) => {
            (req as Request).rawBody = Buffer.from(buf);
        },
    }),
);

interface PlatformSettings {
    webhookSecret: string;
    vcsBaseUrl?: string;
    vcsToken: string;
}

function getPlatformSettings(platform: Platform): PlatformSettings | undefined {
    const universalToken = process.env.VCS_TOKEN;

    switch (platform) {
        case "github": {
            const token = process.env.GITHUB_TOKEN ?? universalToken;
            if (!token) return undefined;
            return {
                webhookSecret: process.env.GITHUB_WEBHOOK_SECRET ?? process.env.WEBHOOK_SECRET ?? "",
                vcsToken: token,
            };
        }
        case "gitea": {
            const token = process.env.GITEA_TOKEN ?? universalToken;
            if (!token) return undefined;
            return {
                webhookSecret: process.env.GITEA_WEBHOOK_SECRET ?? process.env.WEBHOOK_SECRET ?? "",
                vcsBaseUrl: process.env.GITEA_BASE_URL ?? process.env.VCS_BASE_URL,
                vcsToken: token,
            };
        }
        case "gitlab": {
            const token = process.env.GITLAB_TOKEN ?? universalToken;
            if (!token) return undefined;
            return {
                webhookSecret: process.env.GITLAB_WEBHOOK_SECRET ?? process.env.WEBHOOK_SECRET ?? "",
                vcsBaseUrl: process.env.GITLAB_BASE_URL ?? process.env.VCS_BASE_URL,
                vcsToken: token,
            };
        }
    }
}

interface ParsedEvent {
    repository: string;
    prNumber: number;
    action: string;
}

const RELEVANT_ACTIONS: Record<Platform, Set<string>> = {
    github: new Set(["opened", "synchronize", "reopened"]),
    gitea: new Set(["opened", "synchronized", "reopened"]),
    gitlab: new Set(["open", "update", "reopen"]),
};

function parsePayload(platform: Platform, req: Request): ParsedEvent | null {
    const b = req.body;
    if (platform === "github") {
        if (req.headers["x-github-event"] !== "pull_request") return null;
        return { repository: b.repository?.full_name, prNumber: b.pull_request?.number, action: b.action };
    }
    if (platform === "gitea") {
        if (req.headers["x-gitea-event"] !== "pull_request") return null;
        return { repository: b.repository?.full_name, prNumber: b.number ?? b.pull_request?.number, action: b.action };
    }
    if (platform === "gitlab") {
        if (req.headers["x-gitlab-event"] !== "Merge Request Hook") return null;
        return {
            repository: b.project?.path_with_namespace,
            prNumber: b.object_attributes?.iid,
            action: b.object_attributes?.action,
        };
    }
    return null;
}

/** Each platform signs webhook requests differently. */
function verifySignature(platform: Platform, req: Request, secret: string): boolean {
    if (!secret) {
        console.error(`[webhook] no secret configured for platform "${platform}"`);
        return false;
    }
    if (!req.rawBody) {
        console.error("[webhook] raw request body is missing");
        return false;
    }

    if (platform === "gitea") {
        const signature = req.headers["x-gitea-signature"];
        if (typeof signature !== "string" || !/^[0-9a-f]{64}$/i.test(signature)) return false;
        const expected = crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
        return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"));
    }

    if (platform === "github") {
        const signature = req.headers["x-hub-signature-256"];
        if (typeof signature !== "string" || !signature.startsWith("sha256=")) return false;
        const expected = "sha256=" + crypto.createHmac("sha256", secret).update(req.rawBody).digest("hex");
        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }

    if (platform === "gitlab") {
        // GitLab sends a plain shared token, not an HMAC signature.
        const token = req.headers["x-gitlab-token"];
        return typeof token === "string" && token === secret;
    }

    return false;
}

app.post("/webhook/:platform", async (req, res) => {
    const platform = req.params.platform as Platform;
    console.log(`[webhook] request on /webhook/${platform}`);

    if (!["github", "gitea", "gitlab"].includes(platform)) {
        return res.status(404).send("unknown platform");
    }

    const settings = getPlatformSettings(platform);
    if (!settings) {
        console.error(`[webhook] platform "${platform}" is not configured (missing token env var)`);
        return res.status(503).send("platform not configured");
    }

    if (!verifySignature(platform, req, settings.webhookSecret)) {
        console.error("[webhook] invalid signature");
        return res.status(401).send("invalid signature");
    }

    const parsed = parsePayload(platform, req);
    if (!parsed) {
        return res.status(200).send("ignored: not a recognized PR event");
    }
    if (!RELEVANT_ACTIONS[platform].has(parsed.action)) {
        return res.status(200).send(`ignored action: ${parsed.action}`);
    }
    if (!parsed.repository || !parsed.prNumber) {
        console.error("[webhook] missing PR number or repository in payload");
        return res.status(400).send("invalid payload");
    }

    console.log(`[webhook] PR #${parsed.prNumber} on ${parsed.repository} (${platform}): ${parsed.action}`);

    // Respond immediately so the platform doesn't retry; do the review work after.
    res.status(202).send("accepted");

    try {
        const baseConfig: Config = {
            ...loadConfig(process.env),
            vcs: { platform, token: settings.vcsToken, baseUrl: settings.vcsBaseUrl },
        };
        const [owner, repo] = parsed.repository.split("/");
        await runReviewPipeline(baseConfig, { owner, repo, prNumber: parsed.prNumber });
    } catch (error) {
        console.error(`[webhook] review failed for ${parsed.repository}#${parsed.prNumber}:`, error);
    }
});

const PORT = process.env.PORT ?? 4000;

app.listen(PORT, () => {
    console.log(`Webhook server listening on :${PORT}`);
    console.log(`  POST /webhook/github  → ${getPlatformSettings("github") ? "configured" : "not configured (set GITHUB_TOKEN | VCS_TOKEN)"}`);
    console.log(`  POST /webhook/gitea   → ${getPlatformSettings("gitea") ? "configured" : "not configured (set GITEA_TOKEN | VCS_TOKEN)"}`);
    console.log(`  POST /webhook/gitlab  → ${getPlatformSettings("gitlab") ? "configured" : "not configured (set GITLAB_TOKEN | VCS_TOKEN)"}`);
});