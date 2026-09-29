# PR Reviewer (JS/TS)

An evidence-driven GitHub Pull Request reviewer for JavaScript and TypeScript codebases.
It runs deterministic analysis first, understands repository structure and history, and uses an LLM only to verify ambiguous findings.

```text
Deterministic analysis → Repository intelligence → Finding aggregation
        → Minimal LLM verification → GitHub PR review
```

The LLM is optional. With no LLM configured, the reviewer works fully deterministically.

---

## Table of contents

1. [What it does](#1-what-it-does)
2. [How it works](#2-how-it-works)
3. [Requirements](#3-requirements)
4. [Installation](#4-installation)
5. [Configuration](#5-configuration)
6. [Run it locally (recommended first)](#6-run-it-locally-recommended-first)
7. [Run it in GitHub Actions](#7-run-it-in-github-actions)
8. [Setting up the LLM (Ollama)](#8-setting-up-the-llm-ollama)
9. [Actual usage: what developers see](#9-actual-usage-what-developers-see)
10. [Reading a review](#10-reading-a-review)
11. [Repository config: `.pr-reviewer.yml`](#11-repository-config-pr-revieweryml)
12. [Rules reference](#12-rules-reference)
13. [Testing checklist](#13-testing-checklist)
14. [Tuning after real use](#14-tuning-after-real-use)
15. [Troubleshooting](#15-troubleshooting)
16. [Security model](#16-security-model)
17. [Known limitations](#17-known-limitations)
18. [Project structure](#18-project-structure)

---

## 1. What it does

On every pull request it checks:

| Area | Examples |
|---|---|
| Code quality | Large functions, high cyclomatic complexity, too many parameters, `debugger`, lint/type suppressions |
| Security | `eval`, `new Function`, shell-command interpolation, raw HTML injection, disabled TLS, hardcoded secrets, Semgrep and Gitleaks results |
| Architecture | Forbidden layer imports (defined by you), circular dependencies |
| Dependencies | New/removed/major-upgraded packages, non-registry sources, install-script changes, lockfile mismatches, known vulnerabilities (OSV) |
| Testing | Source changed without any test change |
| Unusual changes | Files outside the typical change pattern for a module, based on git history |
| Risky changes | Large diffs, CI/Docker changes, committed `.env` files, new scripts, new environment variables |

Design principles:

- Every finding has a rule ID, evidence, a confidence score and a source.
- Unusual change does not mean bad change. The tool flags change patterns, never people.
- Low-confidence signals are suppressed. Comment spam is treated as a bug.
- Unsupported languages are never presented as deeply analyzed.

---

## 2. How it works

```text
Developer pushes → GitHub PR → GitHub Actions
   → checkout (PR head, full history)
   → reviewer runs
        1. Fetch PR + changed files (GitHub API)
        2. Parse diffs (line-accurate)
        3. Run analyzers in parallel (a failing analyzer never stops the review)
             universal · js-ts-quality · eslint (opt-in) · architecture
             unusual-change · dependencies · gitleaks · semgrep
        4. Optional LLM verification of medium-confidence findings only
        5. Deduplicate → apply thresholds → split inline vs summary
   → post inline comments + one summary comment (updated in place)
```

Key facts:

- Source code comes from the checked-out workspace.
- PR metadata and diffs come from the GitHub API.
- Results go back through the GitHub API.
- The reviewer never executes the PR's code.
- The LLM can only confirm, downgrade or reject findings that deterministic analysis already produced. It cannot add new ones.

---

## 3. Requirements

| Requirement | Notes |
|---|---|
| Node.js 22+ | Node 24 also works |
| npm | |
| Git | Full history is needed for the unusual-change detector |
| GitHub token | Fine-grained PAT locally; `GITHUB_TOKEN` in Actions |
| Optional: Semgrep | `pipx install semgrep` |
| Optional: Gitleaks | Download from the Gitleaks releases page |
| Optional: LLM | Ollama (local or cloud) |

Missing optional tools are reported under "Analyzer notes" in the review and never cause a failure.

---

## 4. Installation

```bash
git clone <your-reviewer-repo> pr-reviewer
cd pr-reviewer
npm install
```

Verify the setup:

```bash
npm run typecheck
npm test
```

> **Important:** `typescript` must stay on the 5.x line, pinned exactly. Newer major versions do not expose the compiler API used by `src/parser/ir.ts`.
> ```bash
> npm i typescript@5.9 --save-exact
> ```

### npm scripts

| Script | Purpose |
|---|---|
| `npm run review:local` | Run the reviewer using values from `.env` |
| `npm run review:pr` | Run the reviewer using real environment variables (used by Actions) |
| `npm run typecheck` | TypeScript type check |
| `npm test` | Unit tests (Vitest) |

---

## 5. Configuration

### 5.1 Environment variables

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | Yes | Token used for GitHub API calls |
| `REPOSITORY` | Yes | `owner/repo` of the repository being reviewed |
| `PR_NUMBER` | Yes | Pull request number |
| `REPO_ROOT` | No | Path to the checked-out target repo (defaults to the current directory) |
| `LLM_BASE_URL` | No | Ollama base URL (default `http://localhost:11434`) |
| `LLM_MODEL` | No | Model name. If unset, LLM verification is skipped |
| `LLM_API_KEY` | No | Bearer token for hosted/cloud LLM endpoints |
| `ENABLE_ESLINT` | No | Set to `true` to run ESLint (see security note) |
| `SEMGREP_CONFIGS` | No | Comma-separated Semgrep rulesets (default `p/javascript,p/typescript,p/security-audit`) |

### 5.2 Local `.env` file

Create `.env` in the reviewer folder. **Never commit it.**

```env
GITHUB_TOKEN=github_pat_xxxxxxxxxxxxxxxx
REPOSITORY=your-username/your-repo
PR_NUMBER=1
REPO_ROOT=C:\path\to\your-repo-clone

# Optional
LLM_BASE_URL=http://localhost:11434
LLM_MODEL=qwen3-coder:30b
```

`.env` contains placeholders like `yourname/sandbox-repo` only in examples. Replace them with real values.

### 5.3 Creating the GitHub token (local use)

GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate.

- Repository access: **Only select repositories** → choose the repo you're reviewing
- Permissions:
  - **Pull requests: Read and write**
  - **Contents: Read**

Copy it immediately; GitHub shows it once. In Actions you don't need a PAT because the built-in `GITHUB_TOKEN` is used.

---

## 6. Run it locally (recommended first)

Always prove the tool works locally before setting up Actions.

**Step 1: get a PR to test on.** Use a small sandbox repo. Create a branch, change a file, and open a PR. Note its number.

**Step 2: clone the target repo with full history.**

```bash
git clone https://github.com/you/sandbox-repo.git
cd sandbox-repo
gh pr checkout 1            # or: git fetch origin pull/1/head && git checkout FETCH_HEAD
git fetch --unshallow       # harmless if already complete
```

The checked-out branch must be the PR head. The reviewer reads files from disk and uses GitHub's diff for line numbers, so a mismatch places comments on the wrong lines.

**Step 3: configure `.env`** in the reviewer folder as shown in section 5.2 (with `REPO_ROOT` pointing to the clone).

**Step 4: run.**

```bash
cd pr-reviewer
npm run review:local
```

Expected output:

```text
PR #1: your PR title
[analyzer] universal: 3 findings (40ms)
[analyzer] js-ts-quality: 1 findings (120ms)
[analyzer] semgrep failed: semgrep is not installed; skipped     <- normal if not installed
LLM verification skipped (LLM_MODEL not set)
inline=1 summary=2 suppressed=4
Review published.
```

Open the PR on GitHub. You should see a summary comment and possibly inline comments.

**Step 5: run it again.** The summary comment should be **updated**, not duplicated, and inline comments already posted should not be reposted.

---

## 7. Run it in GitHub Actions

### 7.1 Publish the reviewer

Push this project to its own repository, e.g. `your-org/pr-reviewer`.

### 7.2 Add the workflow to each target repo

Create `.github/workflows/pr-review.yml` in the **target** repo:

```yaml
name: PR Auto Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      # Target repo at the PR head commit
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: ${{ github.event.pull_request.head.sha }}
          persist-credentials: false

      # The reviewer itself
      - uses: actions/checkout@v4
        with:
          repository: your-org/pr-reviewer
          path: .pr-reviewer
          token: ${{ secrets.REVIEWER_REPO_TOKEN }}   # only if the reviewer repo is private
          persist-credentials: false

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      # Install ONLY the reviewer's dependencies, never the target repo's
      - run: npm ci --ignore-scripts
        working-directory: .pr-reviewer

      # Optional tools; the reviewer skips any that are missing
      - run: pipx install semgrep
      - run: |
          VERSION=8.x.y   # set to the latest release from github.com/gitleaks/gitleaks/releases
          curl -sSL "https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/gitleaks_${VERSION}_linux_x64.tar.gz" | tar -xz gitleaks
          sudo mv gitleaks /usr/local/bin/

      - run: npm run review:pr
        working-directory: .pr-reviewer
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          REPOSITORY: ${{ github.repository }}
          REPO_ROOT: ${{ github.workspace }}
          LLM_BASE_URL: ${{ vars.LLM_BASE_URL }}
          LLM_MODEL: ${{ vars.LLM_MODEL }}
          LLM_API_KEY: ${{ secrets.LLM_API_KEY }}
```

### 7.3 Add secrets and variables

Target repo → Settings → Secrets and variables → Actions:

| Name | Type | Purpose |
|---|---|---|
| `LLM_API_KEY` | Secret | Only for hosted LLMs |
| `REVIEWER_REPO_TOKEN` | Secret | Only if the reviewer repo is private |
| `LLM_BASE_URL` | Variable | LLM endpoint |
| `LLM_MODEL` | Variable | Model name |

### 7.4 Watch the first run

Open a PR, then check the **Actions** tab. The logs show each analyzer's result and timing.

### 7.5 Fork PRs

For PRs from forks, GitHub gives `GITHUB_TOKEN` read-only access, so the reviewer cannot post comments. Fork support needs a different design and is not covered here.

---

## 8. Setting up the LLM (Ollama)

The LLM is used only to verify findings with confidence between 0.5 and 0.9. Ollama's chat API is the same for local and cloud usage; only `LLM_BASE_URL` and `LLM_MODEL` change.

### Option A: Local Ollama

```bash
ollama pull qwen3-coder:30b          # or a smaller/newer Qwen that fits your hardware
```

Test that structured JSON output works:

```bash
curl http://localhost:11434/api/chat -d '{
  "model": "qwen3-coder:30b",
  "stream": false,
  "format": "json",
  "messages": [{"role":"user","content":"Reply with JSON: {\"ok\": true}"}]
}'
```

Set `LLM_MODEL=qwen3-coder:30b` in `.env`.

Model names change frequently. Check the Ollama model library for the current Qwen coder models, and pick a size that fits your GPU/RAM.

**Local models and GitHub Actions:** hosted runners cannot reach `localhost` on your machine. You need either:

- a **self-hosted runner** on the machine running Ollama (`runs-on: self-hosted`), for **private repos only**, or
- a hosted/cloud model endpoint instead.

### Option B: Hosted or cloud model

Set `LLM_BASE_URL` to the provider's Ollama-compatible endpoint, `LLM_MODEL` to the model name, and `LLM_API_KEY` if required. This works on normal `ubuntu-latest` runners.

### Option C: No LLM

Leave `LLM_MODEL` unset. All deterministic analysis still runs.

### LLM behavior guarantees

- Only findings that already exist are sent, with about 30 lines of surrounding code.
- Text that looks like secrets is redacted first. Secret findings are never sent.
- Output must match a strict JSON schema. One retry, then the finding is kept unchanged.
- The model can confirm, adjust severity, rewrite the comment, or reject a finding. It cannot add findings.
- If the LLM is down, the review proceeds without it.

---

## 9. Actual usage: what developers see

Developers install nothing and change nothing about their workflow.

```text
1. Developer pushes a branch and opens a PR
2. GitHub Actions runs "PR Auto Review" (typically 1-3 minutes)
3. On the PR they see:
     - Inline comments on specific lines (high confidence only, max 10)
     - One summary comment (counts by category, "Worth a look" list, notes)
4. On every new push:
     - The summary comment is updated in place
     - Only new inline comments are added (existing ones are not repeated)
```

The reviewer only **comments**. It never approves, requests changes, or blocks merges.

### Typical team workflow

1. **Open PR:** the review appears.
2. **Read the summary first:** it lists what deserves attention and why.
3. **Handle inline comments:** fix them, or reply if it's a false positive.
4. **Push fixes:** the summary refreshes.
5. **Human review continues:** the reviewer supplements reviewers; it does not replace them.

---

## 10. Reading a review

### Summary comment

```text
## AI PR Review

Files analyzed: 14 (+320 / -45) · Findings: 4 (1 inline)
Deep analysis: typescript, javascript · Generic checks only: yaml, shell

| Category        | Findings |
| Security        | 1        |
| Architecture    | 1        |
| Code Quality    | 1        |
| Unusual Changes | 1        |
...

### Worth a look
- [medium] Changes outside the usual pattern for src/user (`Dockerfile`): ...

3 low-confidence or informational signals suppressed. LLM verification: 2 call(s).
```

### Inline comment

```text
Architecture: Layer violation: controller → repository
(architecture/forbidden-import, confidence 95%)

src/user/user.controller.ts (layer "controller") imports ../repo/user.repository
(layer "repository"), which the repository's architecture rules disallow.

Suggestion: Go through an allowed layer instead of importing "repository" directly.
```

### Confidence thresholds (defaults)

| Confidence | Result |
|---|---|
| ≥ 0.90 and severity ≥ medium and line is in the diff | Inline comment |
| 0.70 – 0.89 | Summary only |
| < 0.70 | Suppressed |
| Severity `info` | Suppressed |

If several analyzers report the same problem, the reviewer posts one finding with combined evidence and slightly higher confidence.

### Analyzer notes

If a tool is missing or fails, it appears in a collapsed "Analyzer notes" section. The review still completes.

---

## 11. Repository config: `.pr-reviewer.yml`

Optional. Place it in the root of the **target** repo. The reviewer reads it from the **base branch**, so a PR cannot loosen its own review rules.

```yaml
thresholds:
  inline: 0.9
  summary: 0.7

limits:
  largeDiffLines: 800
  largeFileLines: 600
  maxFunctionLines: 80
  maxComplexity: 15
  maxParams: 6
  maxInline: 10

ignore:
  - "**/node_modules/**"
  - "**/dist/**"
  - "**/*.generated.ts"

history:
  maxCommits: 500      # how much history builds the baseline
  moduleDepth: 2       # "src/user/x.ts" -> module "src/user"
  minSamples: 5        # minimum history before a module is judged

llm:
  enabled: true
  maxCalls: 10

architecture:
  layers:
    controller: { paths: ["src/**/controller/**", "src/**/*.controller.ts"] }
    service:    { paths: ["src/**/service/**", "src/**/*.service.ts"] }
    repository: { paths: ["src/**/repository/**", "src/**/*.repository.ts"] }
    database:   { packages: ["pg", "mysql2", "mongoose", "@prisma/client"] }
  rules:
    - { from: controller, cannotImport: [repository, database] }
    - { from: service,    cannotImport: [controller] }
    - { from: repository, cannotImport: [controller, service] }
```

Notes:

- Layers match either **file paths** (glob) or **npm packages**.
- Architecture findings only appear for imports **added by the PR**, not pre-existing ones.
- Without an `architecture` section, only circular-dependency detection runs.

---

## 12. Rules reference

| Rule ID | Category | Default severity |
|---|---|---|
| `universal/large-diff` | quality | medium |
| `universal/large-file` | quality | low |
| `universal/ci-change` | security | medium |
| `universal/docker-change` | security | low |
| `universal/env-file-committed` | security | high |
| `universal/new-script` | security | low |
| `universal/secret/*` | security | high |
| `universal/source-without-tests` | testing | low |
| `universal/new-env-var` | quality | low |
| `js/large-function` | quality | medium |
| `js/high-complexity` | complexity | medium |
| `js/too-many-params` | quality | low |
| `js/eval`, `js/new-function` | security | high |
| `js/shell-interpolation` | security | high |
| `js/inner-html` | security | medium |
| `js/tls-disabled` | security | high |
| `js/debugger` | quality | low |
| `js/suppression` | quality | low |
| `eslint/*` (opt-in) | quality | low/medium |
| `architecture/forbidden-import` | architecture | high |
| `architecture/circular-dependency` | architecture | medium |
| `dependency/new-dependency` | dependency | low |
| `dependency/major-upgrade` | dependency | medium |
| `dependency/non-registry` | dependency | medium |
| `dependency/install-script` | security | high |
| `dependency/lockfile-only` | dependency | medium |
| `dependency/manifest-without-lockfile` | dependency | low |
| `dependency/known-vulnerability` | dependency | high |
| `gitleaks/*` | security | high |
| `semgrep/*` | security | varies |
| `unusual-change/outside-module-pattern` | unusual-change | low/medium |
| `unusual-change/pr-size` | unusual-change | info |

---

## 13. Testing checklist

### Automated

```bash
npm run typecheck
npm test
```

### Seed a sandbox PR with one deliberate problem per analyzer

Commit each separately and re-run after each.

| Add this | Expect this finding |
|---|---|
| `eval(userInput)` in a `.ts` file | `js/eval` (inline) |
| `const apiKey = "sk_live_abcdef1234567890"` | `universal/secret/generic-secret` |
| A 100-line function with many `if`s | `js/large-function`, `js/high-complexity` |
| Edit a `.github/workflows/*.yml` file | `universal/ci-change` |
| Add a dependency in `package.json`, no lockfile | `dependency/new-dependency`, `manifest-without-lockfile` |
| Add a `"postinstall"` script | `dependency/install-script` |
| Change `src/` code without touching tests | `universal/source-without-tests` |
| Add a `.env` file | `universal/env-file-committed` |
| Import a forbidden layer (with `.pr-reviewer.yml`) | `architecture/forbidden-import` |
| A imports B, B imports A | `architecture/circular-dependency` |
| Change `src/user/*` plus `Dockerfile` and `auth/*` | `unusual-change/outside-module-pattern` |
| Docs-only change | Almost nothing (false-positive check) |

The unusual-change detector needs history: at least 20 usable commits, and at least 5 touching the module. A brand-new repo stays silent by design.

### Behavior checks

- **Idempotency:** run twice; there must be one summary comment and no repeated inline comments.
- **Graceful degradation:** uninstall Semgrep or set a wrong `LLM_BASE_URL`; the review must still post, with notes.
- **Bad input:** break a `package.json` (invalid JSON); the reviewer must skip it without crashing.
- **Unsupported files:** a `.py` file must appear under "Generic checks only", never as deeply analyzed.
- **LLM:** with `LLM_MODEL` set, medium-confidence findings (e.g. `.innerHTML =`) should show `[llm]` log lines. Rejected findings should disappear.

---

## 14. Tuning after real use

| Problem | Fix |
|---|---|
| Too many comments | Raise `thresholds.inline` / `thresholds.summary`, or lower `limits.maxInline` |
| A rule misfires repeatedly | Raise its thresholds, adjust the limit, or remove the rule; save the case as a benchmark fixture |
| Generated or vendored code flagged | Add its glob to `ignore` |
| Architecture false positives | Tighten the `paths` globs for layers |
| Everything feels too quiet | Lower `thresholds.summary` slightly (not below about 0.6) |

Recommended rollout: for the first 1–2 weeks, treat the reviewer as advisory and record which findings people found useful versus wrong. Adjust before trusting inline comments broadly.

---

## 15. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `401 Bad credentials` | `.env` still has placeholder or wrong token. Create a real fine-grained token |
| `404` on the PR | Wrong `REPOSITORY`/`PR_NUMBER`, or the token lacks access to that repo |
| `403` when commenting | Token lacks **Pull requests: Read and write**, or the PR is from a fork |
| `ts.ScriptKind` / TypeScript API errors | Wrong TypeScript major version. Pin `typescript@5.9` and reinstall |
| Comments land on the wrong lines | Checked-out branch is not the PR head |
| Inline comments missing but summary shows findings | The line isn't part of the diff; the finding is moved to the summary automatically |
| Unusual-change never fires | Repo is shallow or has too little history. Use `fetch-depth: 0` and a repo with enough commits |
| `semgrep`/`gitleaks` "not installed" | Optional tools. Install them or ignore the note |
| LLM never used | `LLM_MODEL` unset, or findings aren't in the 0.5–0.9 confidence band |
| `Assertion failed ... async.c` on Windows | Node 24 exit quirk after a failed request. It's harmless and disappears once the run succeeds |
| ESLint findings absent | ESLint is opt-in: set `ENABLE_ESLINT=true` (trusted repos only) |

---

## 16. Security model

- PR code is untrusted. The reviewer never executes it, and installs only its own dependencies with `npm ci --ignore-scripts`.
- ESLint is disabled by default because it loads the repo's own config, which is code from the PR. Enable it only for trusted repos.
- Child processes run with an environment stripped of token/secret/key/password variables.
- Repo config (`.pr-reviewer.yml`) is read from the base branch so a PR cannot weaken its own review.
- Secrets are redacted before any text goes to the LLM, and secret findings are never sent.
- Workflow permissions are limited to `contents: read` and `pull-requests: write`.
- Self-hosted runners must only run on private repos you control.
- Historical analysis is repository-level only. It never scores or profiles developers.

---

## 17. Known limitations

- **JS/TS only.** Other languages get generic checks (diff, file kind, dependencies, secrets), not deep analysis.
- **Path aliases** (`@/foo`) are not resolved, so architecture rules can miss those imports.
- **Dependency vulnerabilities** use versions parsed from `package.json` ranges, not the lockfile. `npm audit` is not integrated yet.
- **Stale inline comments** from earlier pushes are not auto-resolved when a finding disappears.
- **Fork PRs** cannot receive comments (read-only token).
- **Comment-only commits** still trigger a run. There is no path-based skip yet.
- Gitleaks CLI flags may differ between versions; check `gitleaks git --help` if it errors.

---

## 18. Project structure

```text
pr-reviewer/
├── src/
│   ├── index.ts                 # pipeline entry point
│   ├── config.ts                # environment config (zod)
│   ├── repo-config.ts           # .pr-reviewer.yml loader (from base branch)
│   ├── github/                  # client, types, review publishing
│   ├── diff/                    # patch parser, file classification
│   ├── parser/ir.ts             # TS compiler API → language-neutral IR
│   ├── analyzers/
│   │   ├── types.ts             # Analyzer contract + fault-tolerant runner
│   │   ├── universal/           # language-independent rules
│   │   ├── quality/             # JS/TS rules, ESLint (opt-in)
│   │   ├── architecture/        # layer rules, cycles
│   │   ├── dependencies/        # package.json, lockfile, OSV
│   │   └── security/            # Gitleaks, Semgrep
│   ├── repository/              # import graph, git history
│   ├── unusual-change/          # baseline + detector
│   ├── llm/                     # Ollama client, verifier, schema
│   ├── review/                  # types, dedup, thresholds, formatter
│   └── utils/                   # safe exec, git, secret patterns
├── test/
├── .env                         # local only, never committed
├── package.json
└── tsconfig.json
```

### Adding a new analyzer

1. Create a file exporting an `Analyzer` (`{ name, run(ctx) → Finding[] }`).
2. Build findings with `newFinding({...})`. Always set `ruleId`, `category`, `severity`, `confidence`, `source`, and evidence where possible.
3. Register it in the `analyzers` array in `src/index.ts`.
4. Only report issues on lines the PR added, using `file.added`.

### Roadmap

1. Benchmark harness: fixtures with expected findings, for measurable tuning
2. Historical PR replay: run against 50–100 past PRs and measure precision and false positives
3. Path alias resolution and `npm audit` / lockfile-exact OSV checks
4. Auto-resolving stale comments
5. Additional language adapters (Python next)
6. GitHub App / SaaS mode