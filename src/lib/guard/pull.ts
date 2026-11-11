import { randomUUID } from "node:crypto";
import type { Octokit } from "octokit";
import pLimit from "p-limit";
import { CleanError } from "@/lib/github/errors";
import { detectFile, detectFakeFont } from "@/lib/scanner/rules";
import { REPAIR_MARKER, repairPaddingTail, type PullTarget } from "@/lib/guard/repair";

interface RepairChange { path: string; line: number; before: string; after: string }
export interface PullPreview { target: PullTarget; changes: RepairChange[]; unresolved: { path: string; line: number; rule: string }[] }
const executable = (path: string) => /\.(?:[cm]?[jt]s|sh|bat|ps1)$/i.test(path) || !path.split("/").at(-1)?.includes(".");

/** Read immutable Git objects only. No dependencies, scripts or checked-out source are run. */
export async function previewPullRepair(octokit: Octokit, target: PullTarget): Promise<PullPreview> {
  const { owner, repo, branch, head } = target;
  const metadata = await octokit.rest.repos.get({ owner, repo });
  if (metadata.data.archived || metadata.data.disabled) throw new CleanError("This repository is archived or disabled. Review its status before repairing.", 409);
  const ref = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
  if (ref.data.object.sha !== head) throw new CleanError("The remote branch changed. Retry your guarded pull to open a fresh repair request.", 409);
  const tree = await octokit.rest.git.getTree({ owner, repo, tree_sha: head, recursive: "true" });
  if (tree.data.truncated || tree.data.tree.length > 30000) throw new CleanError("The repository exceeds the complete repair scan limit; review it manually.", 409);
  const blobs = tree.data.tree.filter((entry) => entry.type === "blob");
  if (tree.data.tree.some((entry) => entry.mode === "160000")) throw new CleanError("Submodules require separate review before this branch can be repaired.", 409);
  if (blobs.some((entry) => !entry.path || !entry.sha || entry.size == null || entry.size > 8 * 1024 * 1024) ||
      blobs.reduce((sum, entry) => sum + (entry.size ?? 0), 0) > 128 * 1024 * 1024) {
    throw new CleanError("The repository exceeds the repair byte limit. Nothing was changed.", 409);
  }
  const changes: RepairChange[] = [];
  const unresolved: PullPreview["unresolved"] = [];
  const limit = pLimit(6);
  await Promise.all(blobs.map((entry) => limit(async () => {
    const path = entry.path!;
    // Only these file classes have a supported automatic edit. The local gate scans the full result again.
    if (!executable(path) && !/package\.json$|\.gitattributes$|\.vscode\/tasks\.json$|\.(?:ttf|otf|woff2?)$|(?:^|\/)(?:\.npm-ws\.json|\.npm-ws-runner\.js)$/.test(path)) return;
    const blob = await octokit.rest.git.getBlob({ owner, repo, file_sha: entry.sha! });
    if (blob.data.encoding !== "base64") throw new CleanError(`Could not inspect ${path}. Nothing was changed.`, 409);
    const bytes = Buffer.from(blob.data.content, "base64");
    if (bytes.length !== entry.size) throw new CleanError(`Incomplete file: ${path}. Nothing was changed.`, 409);
    if (/\.(?:ttf|otf|woff2?)$/i.test(path)) {
      const finding = detectFakeFont(path, bytes);
      if (finding) unresolved.push({ path, line: finding.line, rule: finding.rule });
      return;
    }
    if (/(?:^|\/)\.npm-ws(?:-runner\.js|\.json)$/.test(path)) {
      unresolved.push({ path, line: 1, rule: "Known persistence artifact requires manual quarantine" });return;
    }
    if (bytes.subarray(0, 4096).includes(0)) return;
    const before = bytes.toString("utf8");
    if (!Buffer.from(before).equals(bytes)) throw new CleanError(`Non-UTF-8 source requires manual review: ${path}`, 409);
    const after = executable(path) ? repairPaddingTail(before) : before;
    const remaining = detectFile(path, after, Buffer.byteLength(after));
    unresolved.push(...remaining.map(({ path: file, line, rule }) => ({ path: file, line, rule })));
    if (after !== before) {
      if (entry.mode !== "100644" && entry.mode !== "100755") throw new CleanError(`Non-regular file requires manual repair: ${path}`, 409);
      changes.push({ path, line: before.slice(0, firstDifference(before, after)).split("\n").length, before, after });
    }
  })));
  changes.sort((a, b) => a.path.localeCompare(b.path));
  unresolved.sort((a, b) => a.path.localeCompare(b.path));
  return { target, changes, unresolved };
}
function firstDifference(a: string, b: string) { let index = 0; while (index < a.length && a[index] === b[index]) index++; return index; }

export async function applyPullRepair(octokit: Octokit, target: PullTarget, mode: "commit" | "pr") {
  // Re-read/re-plan instead of accepting edits or paths from the browser.
  const preview = await previewPullRepair(octokit, target);
  if (preview.unresolved.length) throw new CleanError("Some findings need manual review. No automatic repair was written.", 409);
  if (!preview.changes.length) throw new CleanError("No supported payload remains at this branch tip. Historical findings or tags require separate review.", 409);
  const { owner, repo, branch, head } = target;
  const repairBranch = mode === "pr" ? `reposhield/pull-repair-${randomUUID()}` : branch;
  if (mode === "pr") await octokit.rest.git.createRef({ owner, repo, ref: `refs/heads/${repairBranch}`, sha: head });
  const response = await octokit.graphql<{ createCommitOnBranch: { commit: { oid: string; url: string } } }>(
    `mutation ($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid url } } }`,
    { input: {
      branch: { repositoryNameWithOwner: `${owner}/${repo}`, branchName: repairBranch }, expectedHeadOid: head,
      message: { headline: "chore(security): repair blocked RepoShield pull", body: REPAIR_MARKER },
      fileChanges: { additions: preview.changes.map((change) => ({ path: change.path, contents: Buffer.from(change.after).toString("base64") })) },
    } },
  );
  const commit = response.createCommitOnBranch?.commit;
  if (!commit?.oid) throw new CleanError("GitHub did not confirm the repair commit. Check the branch before retrying.", 502);
  let prUrl: string | null = null;
  if (mode === "pr") {
    const pr = await octokit.rest.pulls.create({ owner, repo, head: repairBranch, base: branch,
      title: "Repair the blocked RepoShield pull",
      body: ["Recognized padding-hidden payloads were removed from:", ...preview.changes.map((change) => `- ${JSON.stringify(change.path)}:${change.line}`),
        "", "Merge using a merge commit or rebase that preserves the repair commit and its footer. The CLI recomputes its complete tree before accepting historical findings.",
        "Historical payloads and existing tags remain in Git. The local guard must inspect the final snapshot before checkout."].join("\n") });
    prUrl = pr.data.html_url;
  }
  return { commitSha: commit.oid, commitUrl: commit.url, prUrl, branch: repairBranch,
    message: mode === "pr" ? "Repair PR opened. Merge it, then retry your guarded pull." : "Repair committed. Retry your guarded pull; the CLI will independently verify it.",
    paths: preview.changes.map(({ path, line }) => ({ path, line })) };
}
