import { z } from "zod";
import { Platform } from "./vcs/types.js";


const schema = z.object({
  // Generic VCS auth — works for any platform
  VCS_TOKEN: z.string().min(1, "VCS_TOKEN is required").optional(),
  GITHUB_TOKEN: z.string().min(1).optional(), // kept for backward compatibility

  REPOSITORY: z.string().regex(/^[^/]+\/[^/]+$/, "REPOSITORY must be owner/repo"),
  PR_NUMBER: z.coerce.number().int().positive(),
  REPO_ROOT: z.string().optional(),

  LLM_BASE_URL: z.string().url().default("http://localhost:11434"),
  LLM_MODEL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),

  VCS_PLATFORM: z.enum(["github", "gitea", "gitlab"]).default("github"),
  VCS_BASE_URL: z.string().url().optional(), // required for gitea/gitlab, checked below
})
  .refine((d) => d.VCS_TOKEN ?? d.GITHUB_TOKEN, {
    message: "VCS_TOKEN (or GITHUB_TOKEN for the github platform) is required",
    path: ["VCS_TOKEN"],
  })
  .refine((d) => d.VCS_PLATFORM === "github" || !!d.VCS_BASE_URL, {
    message: "VCS_BASE_URL is required when VCS_PLATFORM is gitea or gitlab",
    path: ["VCS_BASE_URL"],
  });

export interface Config {
  owner: string;
  repo: string;
  repoRoot: string;
  prNumber: number;
  llm: { baseUrl: string; model?: string; apiKey?: string };
  vcs: { platform: Platform; token: string; baseUrl?: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const d = parsed.data;
  const [owner, repo] = d.REPOSITORY.split("/");
  const token = d.VCS_TOKEN ?? d.GITHUB_TOKEN!; // refine() guarantees one is set

  return {
    owner,
    repo,
    repoRoot: d.REPO_ROOT ?? process.cwd(),
    prNumber: d.PR_NUMBER,
    llm: { baseUrl: d.LLM_BASE_URL, model: d.LLM_MODEL, apiKey: d.LLM_API_KEY },
    vcs: { platform: d.VCS_PLATFORM, token, baseUrl: d.VCS_BASE_URL },
  };
}