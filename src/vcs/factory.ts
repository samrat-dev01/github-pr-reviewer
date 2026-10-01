import type { VcsClient } from "./types.js";
import { GitHubClient } from "./platforms/github-client.js";
import { GiteaClient } from "./platforms/gitea-client.js";
import { GitLabClient } from "./platforms/gitlab-client.js";
import type { Config } from "../config.js";

export function createVcsClient(config: Config): VcsClient {
    switch (config.vcs.platform) {
        case "github":
            return new GitHubClient({ token: config.vcs.token, owner: config.owner, repo: config.repo });
        case "gitea":
            return new GiteaClient({ baseUrl: config.vcs.baseUrl!, token: config.vcs.token, owner: config.owner, repo: config.repo });
        case "gitlab":
            return new GitLabClient({ baseUrl: config.vcs.baseUrl!, token: config.vcs.token, projectId: `${config.owner}/${config.repo}` });
    }
}