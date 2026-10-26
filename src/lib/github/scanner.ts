import { Octokit } from "octokit";
import pLimit from "p-limit";
import { httpStatus } from "@/lib/github/errors";
import { isHighRiskPath, shouldSkipBlob } from "@/lib/github/paths";
import { analyzeRepositoryFiles } from "@/lib/scanner/engine";
import type { FetchedFile, RateLimitSnapshot, ScannedRepo } from "@/lib/scanner/types";

/** How many repositories hit GitHub at once. Each one is one tree call plus one GraphQL call. */
const REPO_CONCURRENCY = 40;

export interface ListedRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  size: number;
  default_branch: string | null;
  pushed_at: string | null;
  html_url: string;
  owner: { login: string; type: string };
}

export function createOctokit(token: string, onRate?: (rate: RateLimitSnapshot) => void): Octokit {
  // The bundled throttle plugin queues every GraphQL call behind a 1-per-second write limiter.
  // That serializes blob fetches. Repo concurrency is controlled below instead.
  const octokit = new Octokit({
    auth: token,
    userAgent: "RepoShield/1.0",
    throttle: { enabled: false },
  });
  if (onRate) {
    octokit.hook.after("request", async (response: { headers?: Record<string, string | number | undefined> }) => {
      const headers = response?.headers ?? {};
      const remaining = headers["x-ratelimit-remaining"];
      const limit = headers["x-ratelimit-limit"];
      if (remaining == null || limit == null) return;
      const reset = headers["x-ratelimit-reset"];
      onRate({
        remaining: Number(remaining),
        limit: Number(limit),
        resetAt: reset ? new Date(Number(reset) * 1000).toISOString() : null,
      });
    });
  }
  return octokit;
}

export async function readRateLimit(octokit: Octokit): Promise<RateLimitSnapshot> {
  const { data } = await octokit.rest.rateLimit.get();
  const core = data.resources.core;
  const graphql = data.resources.graphql;
  const bucket = graphql && graphql.remaining < core.remaining ? graphql : core;
  return {
    remaining: bucket.remaining,
    limit: bucket.limit,
    resetAt: new Date(bucket.reset * 1000).toISOString(),
  };
}

export async function listRepositories(octokit: Octokit): Promise<ListedRepo[]> {
  const repos = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
    per_page: 100,
    affiliation: "owner,collaborator,organization_member",
    visibility: "all",
    sort: "pushed",
  });
  return repos as ListedRepo[];
}

export async function scanRepositories(
  octokit: Octokit,
  onRepo: (update: { scanned: number; total: number; elapsedMs: number; repo: ScannedRepo }) => void | Promise<void>,
  signal?: AbortSignal,
  onListed?: (total: number) => void | Promise<void>,
): Promise<void> {
  const repos = await listRepositories(octokit);
  await onListed?.(repos.length);
  if (signal?.aborted) return;
  const started = Date.now();
  const limit = pLimit(REPO_CONCURRENCY);
  let scanned = 0;

  await Promise.all(
    repos.map((repo) =>
      limit(async () => {
        if (signal?.aborted) return;
        const result = await inspectRemoteRepo(octokit, repo);
        scanned += 1;
        await onRepo({
          scanned,
          total: repos.length,
          elapsedMs: Date.now() - started,
          repo: result,
        });
      }),
    ),
  );
}

export async function inspectOwnerRepo(octokit: Octokit, owner: string, repo: string): Promise<ScannedRepo> {
  const response = await octokit.rest.repos.get({ owner, repo });
  return inspectRemoteRepo(octokit, response.data as unknown as ListedRepo);
}

export async function inspectRemoteRepo(octokit: Octokit, repo: ListedRepo): Promise<ScannedRepo> {
  const started = Date.now();
  const base = repoShell(repo);
  if (!repo.default_branch || repo.size === 0) {
    return {
      ...base,
      durationMs: Date.now() - started,
      status: "skipped",
      skippedReason: repo.size === 0 ? "Empty repository" : "No default branch",
    };
  }

  try {
    const ref = await octokit.rest.git.getRef({ owner: repo.owner.login, repo: repo.name, ref: `heads/${repo.default_branch}` });
    const headSha = ref.data.object.sha;
    const loaded = await loadHighRiskFiles(octokit, repo.owner.login, repo.name, headSha);
    const analyzed = analyzeRepositoryFiles(loaded.files);
    return {
      ...base,
      headSha,
      fileModes: loaded.fileModes,
      lastCommitter: loaded.committer ?? base.lastCommitter,
      durationMs: Date.now() - started,
      status: analyzed.findings.length > 0 ? "infected" : loaded.warnings.length > 0 ? "error" : "clean",
      error: loaded.warnings.length > 0 ? "Scan coverage is incomplete. Resolve the warnings and scan again." : undefined,
      findings: analyzed.findings,
      files: analyzed.files,
      warnings: loaded.warnings,
    };
  } catch (error) {
    const status = httpStatus(error);
    if (status === 409 || status === 404) {
      return {
        ...base,
        durationMs: Date.now() - started,
        status: "skipped",
        skippedReason: status === 409 ? "Empty repository" : "Repository is not readable",
      };
    }
    return {
      ...base,
      durationMs: Date.now() - started,
      status: "error",
      error: error instanceof Error ? error.message : "Scan failed",
    };
  }
}

async function loadHighRiskFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
): Promise<{ files: FetchedFile[]; fileModes: Record<string, string>; committer: string | null; warnings: string[] }> {
  const tree = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: branch,
    recursive: "true",
  });

  const warnings: string[] = [];
  if (tree.data.truncated) {
    warnings.push("Git tree was truncated by GitHub. Some deep paths were not scanned.");
  }

  const candidates: Array<{ path: string; size: number }> = [];
  const fileModes: Record<string, string> = {};
  for (const item of tree.data.tree) {
    if (item.type !== "blob" || !item.path) continue;
    const size = item.size ?? 0;
    if (shouldSkipBlob(item.path, size)) continue;
    if (!isHighRiskPath(item.path, size)) continue;
    candidates.push({ path: item.path, size });
    fileModes[item.path] = item.mode ?? "100644";
  }

  const { texts, committer } = await fetchBlobs(octokit, owner, repo, candidates.map((item) => item.path), branch);
  const sizeByPath = new Map(candidates.map((item) => [item.path, item.size]));
  const files: FetchedFile[] = [];
  for (const [path, text] of texts) {
    files.push({ path, text, byteSize: sizeByPath.get(path) ?? text.length });
  }
  const missing = candidates.filter((item) => !texts.has(item.path));
  if (missing.length > 0) warnings.push(`${missing.length} file(s) could not be inspected: ${missing.slice(0, 5).map((item) => item.path).join(", ")}`);
  return { files, fileModes, committer, warnings };
}

async function fetchBlobs(
  octokit: Octokit,
  owner: string,
  repo: string,
  paths: string[],
  revision: string,
): Promise<{ texts: Map<string, string>; committer: string | null }> {
  const texts = new Map<string, string>();
  if (paths.length === 0) return { texts, committer: null };
  const chunks: string[][] = [];
  for (let index = 0; index < paths.length; index += 20) chunks.push(paths.slice(index, index + 20));

  const portions = await Promise.all(
    chunks.map((chunk, index) => fetchChunk(octokit, owner, repo, chunk, index === 0, revision)),
  );
  let committer: string | null = null;
  for (const portion of portions) {
    if (portion.committer) committer = portion.committer;
    for (const [path, text] of portion.texts) texts.set(path, text);
  }
  return { texts, committer };
}

async function fetchChunk(
  octokit: Octokit,
  owner: string,
  repo: string,
  paths: string[],
  withAuthor: boolean,
  revision: string,
): Promise<{ texts: Map<string, string>; committer: string | null }> {
  try {
    return await queryBlobs(octokit, owner, repo, paths, withAuthor, revision);
  } catch {
    if (paths.length > 1) {
      const mid = Math.ceil(paths.length / 2);
      const left = await fetchChunk(octokit, owner, repo, paths.slice(0, mid), withAuthor, revision);
      const right = await fetchChunk(octokit, owner, repo, paths.slice(mid), false, revision);
      for (const [path, text] of right.texts) left.texts.set(path, text);
      return { texts: left.texts, committer: left.committer ?? right.committer };
    }
    const text = await fetchBlobRest(octokit, owner, repo, paths[0], revision);
    const texts = new Map<string, string>();
    if (text != null) texts.set(paths[0], text);
    return { texts, committer: null };
  }
}

async function queryBlobs(
  octokit: Octokit,
  owner: string,
  repo: string,
  paths: string[],
  withAuthor: boolean,
  revision: string,
): Promise<{ texts: Map<string, string>; committer: string | null }> {
  const query = blobQuery(paths, withAuthor, revision);
  const data = await octokit.graphql<{ repository: Record<string, unknown> | null }>(query, {
    owner,
    name: repo,
  });
  const repository = data.repository;
  const texts = new Map<string, string>();
  paths.forEach((path, index) => {
    const text = readBlob(repository?.[`b${index}`]);
    if (text != null) texts.set(path, text);
  });
  return { texts, committer: withAuthor ? readCommitter(repository ?? null) : null };
}

function blobQuery(paths: string[], withAuthor: boolean, revision: string): string {
  const fields = paths
    .map((filePath, index) => {
      const expression = graphqlString(`${revision}:${filePath}`);
      return `b${index}: object(expression: "${expression}") { ... on Blob { text byteSize isBinary } }`;
    })
    .join("\n");
  const author = withAuthor
    ? "defaultBranchRef { target { ... on Commit { author { name user { login } } } } }"
    : "";
  return `query ($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      ${author}
      ${fields}
    }
  }`;
}

async function fetchBlobRest(octokit: Octokit, owner: string, repo: string, path: string, revision: string): Promise<string | null> {
  try {
    const response = await octokit.rest.repos.getContent({ owner, repo, path, ref: revision });
    if (Array.isArray(response.data) || response.data.type !== "file" || !("content" in response.data)) return null;
    if (response.data.encoding === "base64" && response.data.content) {
      return Buffer.from(response.data.content.replace(/\n/g, ""), "base64").toString("utf8");
    }
    return null;
  } catch {
    return null;
  }
}

function readBlob(node: unknown): string | null {
  if (!node || typeof node !== "object") return null;
  const blob = node as { text?: string | null; isBinary?: boolean | null };
  if (blob.isBinary || typeof blob.text !== "string") return null;
  return blob.text;
}

function readCommitter(repository: Record<string, unknown> | null): string | null {
  const ref = repository?.defaultBranchRef;
  if (!ref || typeof ref !== "object") return null;
  const target = (ref as { target?: unknown }).target;
  if (!target || typeof target !== "object") return null;
  const author = (target as { author?: unknown }).author;
  if (!author || typeof author !== "object") return null;
  const record = author as { name?: string | null; user?: { login?: string | null } | null };
  return record.user?.login || record.name || null;
}

function graphqlString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function repoShell(repo: ListedRepo): ScannedRepo {
  return {
    id: String(repo.id),
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    private: repo.private,
    archived: repo.archived,
    fork: repo.fork,
    isOrg: repo.owner.type === "Organization",
    defaultBranch: repo.default_branch ?? "main",
    pushedAt: repo.pushed_at,
    lastCommitter: null,
    htmlUrl: repo.html_url,
    durationMs: 0,
    status: "clean",
    findings: [],
    files: {},
    warnings: [],
  };
}
