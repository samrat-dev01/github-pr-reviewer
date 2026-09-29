import { z } from "zod";

const schema = z.object({
  GITHUB_TOKEN: z.string().min(1, "GITHUB_TOKEN is required"),
  REPOSITORY: z.string().regex(/^[^/]+\/[^/]+$/, "REPOSITORY must be owner/repo"),
  PR_NUMBER: z.coerce.number().int().positive(),
  REPO_ROOT: z.string().optional(),

  // Optional until the LLM step
  LLM_BASE_URL: z.url().default("http://localhost:11434"),
  LLM_MODEL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
});

export interface Config {
  githubToken: string;
  owner: string;
  repo: string;
  repoRoot: string;
  prNumber: number;
  llm: { baseUrl: string; model?: string; apiKey?: string };
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
  return {
    githubToken: d.GITHUB_TOKEN,
    owner,
    repo,
    repoRoot: d.REPO_ROOT ?? process.cwd(),
    prNumber: d.PR_NUMBER,
    llm: { baseUrl: d.LLM_BASE_URL, model: d.LLM_MODEL, apiKey: d.LLM_API_KEY },
  };
}