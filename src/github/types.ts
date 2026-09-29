export interface PullRequestInfo {
  number: number;
  title: string;
  body: string;
  author: string;
  baseSha: string;
  headSha: string;
  baseRef: string;
  headRef: string;
  labels: string[];
  draft: boolean;
}

export type FileStatus =
  | "added"
  | "removed"
  | "modified"
  | "renamed"
  | "copied"
  | "changed"
  | "unchanged";

export interface ChangedFile {
  path: string;
  previousPath?: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  /** Unified diff patch for this file. Undefined for binary or very large files. */
  patch?: string;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
}