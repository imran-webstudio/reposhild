import type { Octokit } from "octokit";
import { CleanError, httpStatus, publicError } from "@/lib/github/errors";
import { inspectOwnerRepo } from "@/lib/github/scanner";
import { planRemediation } from "@/lib/sanitizer";
import type { FileChange, RemediationResult } from "@/lib/scanner/types";

export const REMEDIATION_MESSAGE = "chore(security): remove malicious payload and sanitize scripts";

type TreeMode = "100644" | "100755" | "040000" | "160000" | "120000";

interface Head {
  sha: string;
  treeSha: string;
}

export async function remediateRepository(
  octokit: Octokit,
  owner: string,
  repo: string,
  mode: "commit" | "pr",
): Promise<RemediationResult> {
  try {
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

    await assertCanPush(octokit, owner, repo);
    const base = scanned.defaultBranch;

    if (mode === "pr") {
      const opened = await commitOnNewBranchAndOpenPr(octokit, owner, repo, base, changes);
      return result({
        owner,
        repo,
        mode: "pr",
        commitSha: opened.commitSha,
        branch: opened.branch,
        prUrl: opened.url,
        fallbackToPr: false,
        message: `Opened ${opened.url}`,
        changes,
      });
    }

    try {
      const commitSha = await writeCommit(octokit, owner, repo, base, changes);
      return result({
        owner,
        repo,
        mode: "commit",
        commitSha,
        branch: base,
        prUrl: null,
        fallbackToPr: false,
        message: `Committed to ${base}.`,
        changes,
      });
    } catch (error) {
      const status = httpStatus(error);
      if (status !== 422 && status !== 403) throw error;
      const opened = await commitOnNewBranchAndOpenPr(octokit, owner, repo, base, changes);
      return result({
        owner,
        repo,
        mode: "pr",
        commitSha: opened.commitSha,
        branch: opened.branch,
        prUrl: opened.url,
        fallbackToPr: true,
        message: `Default branch is protected. Opened ${opened.url}`,
        changes,
      });
    }
  } catch (error) {
    if (error instanceof CleanError) throw error;
    throw wrapWriteError(error, owner, repo);
  }
}

async function assertCanPush(octokit: Octokit, owner: string, repo: string): Promise<void> {
  const { data } = await octokit.rest.repos.get({ owner, repo });
  if (data.archived) {
    throw new CleanError(`${owner}/${repo} is archived. Unarchive it on GitHub before cleaning.`, 409);
  }
  if (data.disabled) {
    throw new CleanError(`${owner}/${repo} is disabled, so GitHub will not accept a commit.`, 409);
  }
  const access = data.permissions;
  if (access && !access.push && !access.admin && !access.maintain) {
    throw new CleanError(
      `Signed-in GitHub account can read ${owner}/${repo} but cannot push. GitHub hides that as Not Found on blob writes. Grant write access on that repository (org owner or collaborator) and approve the OAuth app for the org if asked.`,
      403,
    );
  }
}

async function writeCommit(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  changes: FileChange[],
): Promise<string> {
  const head = await readHead(octokit, owner, repo, branch);
  try {
    return await graphqlCommit(octokit, owner, repo, branch, head.sha, changes);
  } catch (error) {
    try {
      return await gitDataCommit(octokit, owner, repo, branch, head, changes);
    } catch (second) {
      throw wrapWriteError(second, owner, repo);
    }
  }
}

async function commitOnNewBranchAndOpenPr(
  octokit: Octokit,
  owner: string,
  repo: string,
  base: string,
  changes: FileChange[],
): Promise<{ branch: string; url: string; commitSha: string }> {
  const head = await readHead(octokit, owner, repo, base);
  const branch = `reposhield/sanitize-${Date.now().toString(36)}`;
  try {
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branch}`,
      sha: head.sha,
    });
  } catch (error) {
    throw wrapWriteError(error, owner, repo);
  }
  const commitSha = await writeCommit(octokit, owner, repo, branch, changes);
  const pull = await octokit.rest.pulls.create({
    owner,
    repo,
    title: REMEDIATION_MESSAGE,
    head: branch,
    base,
    body: pullRequestBody(changes),
  });
  return { branch, url: pull.data.html_url, commitSha };
}

async function readHead(octokit: Octokit, owner: string, repo: string, branch: string): Promise<Head> {
  const ref = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
  const parent = await octokit.rest.git.getCommit({ owner, repo, commit_sha: ref.data.object.sha });
  return { sha: ref.data.object.sha, treeSha: parent.data.tree.sha };
}

async function graphqlCommit(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  expectedHeadOid: string,
  changes: FileChange[],
): Promise<string> {
  const additions = changes
    .filter((change) => change.action !== "delete" && change.after != null)
    .map((change) => ({
      path: change.path,
      contents: Buffer.from(change.after ?? "", "utf8").toString("base64"),
    }));
  const deletions = changes
    .filter((change) => change.action === "delete" || change.after == null)
    .map((change) => ({ path: change.path }));

  const data = await octokit.graphql<{
    createCommitOnBranch: { commit: { oid: string } | null };
  }>(
    `mutation ($input: CreateCommitOnBranchInput!) {
      createCommitOnBranch(input: $input) {
        commit { oid }
      }
    }`,
    {
      input: {
        branch: {
          repositoryNameWithOwner: `${owner}/${repo}`,
          branchName: branch,
        },
        message: { headline: REMEDIATION_MESSAGE },
        fileChanges: {
          ...(additions.length > 0 ? { additions } : {}),
          ...(deletions.length > 0 ? { deletions } : {}),
        },
        expectedHeadOid,
      },
    },
  );
  const oid = data.createCommitOnBranch?.commit?.oid;
  if (!oid) throw new CleanError(`GitHub did not return a commit for ${owner}/${repo}.`, 502);
  return oid;
}

async function gitDataCommit(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  head: Head,
  changes: FileChange[],
): Promise<string> {
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
      content: Buffer.from(change.after, "utf8").toString("base64"),
      encoding: "base64",
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
    base_tree: head.treeSha,
    tree,
  });
  const commit = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: REMEDIATION_MESSAGE,
    tree: nextTree.data.sha,
    parents: [head.sha],
  });
  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: commit.data.sha,
  });
  return commit.data.sha;
}

function wrapWriteError(error: unknown, owner: string, repo: string): CleanError {
  const status = httpStatus(error);
  const detail = graphqlMessage(error);
  if (status === 404 || /not found/i.test(detail)) {
    return new CleanError(
      `GitHub refused to write ${owner}/${repo} (Not Found). That almost always means the signed-in account cannot push — GitHub hides missing write access as 404 on create-blob. Grant write access, unarchive the repo, and approve the OAuth app for the org.`,
      403,
    );
  }
  if (status === 403 || /resource not accessible|permission|forbidden|archived/i.test(detail)) {
    return new CleanError(`GitHub forbade writing to ${owner}/${repo}. ${detail}`, 403);
  }
  return new CleanError(detail, status && status >= 400 ? status : 502);
}

function graphqlMessage(error: unknown): string {
  if (typeof error === "object" && error && "errors" in error) {
    const errors = (error as { errors?: Array<{ message?: string }> }).errors;
    if (Array.isArray(errors) && errors.length > 0) {
      return errors.map((item) => item.message).filter(Boolean).join("; ") || publicError(error);
    }
  }
  return publicError(error);
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
  };
}
