import type { Octokit } from "octokit";
import { CleanError, httpStatus } from "@/lib/github/errors";
import { inspectOwnerRepo } from "@/lib/github/scanner";
import { planRemediation } from "@/lib/sanitizer";
import type { FileChange, RemediationResult } from "@/lib/scanner/types";

export const REMEDIATION_MESSAGE = "chore(security): remove malicious payload and sanitize scripts";

type TreeMode = "100644" | "100755" | "040000" | "160000" | "120000";

export async function remediateRepository(
  octokit: Octokit,
  owner: string,
  repo: string,
  mode: "commit" | "pr",
): Promise<RemediationResult> {
  const scanned = await inspectOwnerRepo(octokit, owner, repo);
  if (scanned.status === "error") {
    throw new CleanError(scanned.error ?? "The repository could not be read.", 502);
  }
  if (scanned.status === "skipped") {
    throw new CleanError(scanned.skippedReason ?? "The repository has nothing to scan.");
  }

  const changes = planRemediation(scanned.files, scanned.findings);
  if (changes.length === 0) {
    throw new CleanError("Nothing to clean. Those findings do not have an automatic fix.");
  }

  const branch = scanned.defaultBranch;
  const commitSha = await createSanitizedCommit(octokit, owner, repo, branch, changes);

  if (mode === "pr") {
    const opened = await openPullRequest(octokit, owner, repo, branch, commitSha, changes);
    return result({
      owner,
      repo,
      mode: "pr",
      commitSha,
      branch: opened.branch,
      prUrl: opened.url,
      fallbackToPr: false,
      message: `Opened ${opened.url}`,
      changes,
    });
  }

  try {
    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: commitSha,
    });
    return result({
      owner,
      repo,
      mode: "commit",
      commitSha,
      branch,
      prUrl: null,
      fallbackToPr: false,
      message: `Committed to ${branch}.`,
      changes,
    });
  } catch (error) {
    const status = httpStatus(error);
    if (status !== 422 && status !== 403) throw error;
    const opened = await openPullRequest(octokit, owner, repo, branch, commitSha, changes);
    return result({
      owner,
      repo,
      mode: "pr",
      commitSha,
      branch: opened.branch,
      prUrl: opened.url,
      fallbackToPr: true,
      message: `Default branch is protected. Opened ${opened.url}`,
      changes,
    });
  }
}

async function createSanitizedCommit(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  changes: FileChange[],
): Promise<string> {
  const ref = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
  const parentSha = ref.data.object.sha;
  const parent = await octokit.rest.git.getCommit({ owner, repo, commit_sha: parentSha });

  const tree = [];
  for (const change of changes) {
    if (change.action === "delete" || change.after == null) {
      tree.push({
        path: change.path,
        mode: "100644" as TreeMode,
        type: "blob" as const,
        sha: null,
      });
      continue;
    }
    const blob = await octokit.rest.git.createBlob({
      owner,
      repo,
      content: change.after,
      encoding: "utf-8",
    });
    tree.push({
      path: change.path,
      mode: "100644" as TreeMode,
      type: "blob" as const,
      sha: blob.data.sha,
    });
  }

  const nextTree = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: parent.data.tree.sha,
    tree,
  });
  const commit = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: REMEDIATION_MESSAGE,
    tree: nextTree.data.sha,
    parents: [parentSha],
  });
  return commit.data.sha;
}

async function openPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  base: string,
  commitSha: string,
  changes: FileChange[],
): Promise<{ branch: string; url: string }> {
  const branch = `reposhield/sanitize-${Date.now().toString(36)}`;
  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: commitSha,
  });
  const pull = await octokit.rest.pulls.create({
    owner,
    repo,
    title: REMEDIATION_MESSAGE,
    head: branch,
    base,
    body: pullRequestBody(changes),
  });
  return { branch, url: pull.data.html_url };
}

function pullRequestBody(changes: FileChange[]): string {
  const lines = [
    "RepoShield removed supply-chain malware indicators in one commit.",
    "",
    ...changes.map((change) => `- \`${change.path}\` (${change.action}): ${change.rules.join("; ")}`),
    "",
    "Compare the diff with the preview before merging.",
  ];
  return lines.join("\n");
}

function result(input: {
  owner: string;
  repo: string;
  mode: "commit" | "pr";
  commitSha: string;
  branch: string;
  prUrl: string | null;
  fallbackToPr: boolean;
  message: string;
  changes: FileChange[];
}): RemediationResult {
  return {
    owner: input.owner,
    name: input.repo,
    mode: input.mode,
    commitSha: input.commitSha,
    commitUrl: `https://github.com/${input.owner}/${input.repo}/commit/${input.commitSha}`,
    prUrl: input.prUrl,
    branch: input.branch,
    message: input.message,
    changes: input.changes,
    fallbackToPr: input.fallbackToPr,
    demo: false,
  };
}
