# Deployment examples

Pick the file matching your platform, copy it into the TARGET repo (the
repo whose PRs should be reviewed — not this `pr-reviewer` repo), and
replace `YOUR_USERNAME` with your actual GitHub username for `pr-reviewer`.

| Platform | Copy this file to | Requires |
|---|---|---|
| GitHub | `.github/workflows/pr-review.yml` | `LLM_API_KEY` secret (and `REVIEWER_REPO_TOKEN` if `pr-reviewer` is private) |
| Gitea (Actions enabled) | `.gitea/workflows/pr-review.yml` | `VCS_TOKEN`, `LLM_API_KEY` secrets + a registered `act_runner` |
| Gitea (Actions disabled) | n/a — use `src/webhook-server.ts` instead, registered as a repo webhook | `VCS_TOKEN`, `WEBHOOK_SECRET`, `LLM_API_KEY` env vars on the server |
| GitLab | `.gitlab-ci.yml` | `VCS_TOKEN`, `LLM_API_KEY` CI/CD variables |

Also copy `pr-reviewer.yml` to `.pr-reviewer.yml` in the target repo's
root if you want custom thresholds or architecture rules — optional,
sensible defaults apply if omitted.