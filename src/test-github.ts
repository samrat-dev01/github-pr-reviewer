import "dotenv/config";
import { Octokit } from "@octokit/rest";

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

const owner = 'samrat-dev01';
const repo = 'dsa';

const commits = await octokit.paginate(
  octokit.rest.repos.listCommits,
  {
    owner,
    repo,
    per_page: 100,
  }
);

console.log(`Total commits: ${commits.length}`);

for (const commit of commits) {
  console.log({
    sha: commit.sha,
    message: commit.commit.message,
    author: commit.author?.login ?? commit.commit.author?.name,
    date: commit.commit.author?.date,
  });
}