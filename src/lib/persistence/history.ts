import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/lib/db";
import type { RemediationSummary, ScanSummary, StoredScanStatus } from "@/lib/history";
import type { AutoFixStrategy, Finding, RemediationResult, ScannedRepo, Severity } from "@/lib/scanner/types";

export interface AccountProfile {
  login: string;
  githubId?: string | null;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

const STATUSES = new Set<StoredScanStatus>(["RUNNING", "COMPLETED", "FAILED", "ABORTED"]);

export function profileFromGitHub(profile: unknown): AccountProfile | null {
  if (!profile || typeof profile !== "object") return null;
  const record = profile as Record<string, unknown>;
  if (typeof record.login !== "string" || record.login.length === 0) return null;
  return {
    login: record.login,
    githubId: record.id == null ? null : String(record.id),
    name: typeof record.name === "string" ? record.name : null,
    email: typeof record.email === "string" ? record.email : null,
    avatarUrl: typeof record.avatar_url === "string" ? record.avatar_url : null,
  };
}

/** GitHub access tokens are never written. Only the public account identity is stored. */
export async function rememberUser(profile: AccountProfile) {
  const db = getPrisma();
  if (!db || !profile.login) return null;
  return db.user.upsert({
    where: { login: profile.login },
    create: {
      login: profile.login,
      githubId: profile.githubId || null,
      name: profile.name || null,
      email: profile.email || null,
      avatarUrl: profile.avatarUrl || null,
    },
    update: {
      ...(profile.githubId ? { githubId: profile.githubId } : {}),
      ...(profile.name ? { name: profile.name } : {}),
      ...(profile.email ? { email: profile.email } : {}),
      ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
    },
  });
}

export async function beginScan(
  profile: AccountProfile,
  input: {
    lockdownActive: boolean;
    lockdownSummary: string | null;
    rateRemaining: number | null;
    rateLimit: number | null;
  },
): Promise<string | null> {
  const db = getPrisma();
  if (!db) return null;
  const user = await rememberUser(profile);
  if (!user) return null;
  const scan = await db.scan.create({
    data: {
      userId: user.id,
      lockdownActive: input.lockdownActive,
      lockdownSummary: input.lockdownSummary,
      rateRemaining: input.rateRemaining,
      rateLimit: input.rateLimit,
    },
  });
  return scan.id;
}

export async function noteScanListed(scanId: string, repoTotal: number): Promise<void> {
  const db = getPrisma();
  if (!db) return;
  await db.scan.update({ where: { id: scanId }, data: { repoTotal } });
}

export async function saveScannedRepo(scanId: string, repo: ScannedRepo): Promise<void> {
  const db = getPrisma();
  if (!db) return;
  const pushedAt = repo.pushedAt ? new Date(repo.pushedAt) : null;
  await db.scanRepo.create({
    data: {
      scanId,
      githubRepoId: repo.id,
      owner: repo.owner,
      name: repo.name,
      fullName: repo.fullName,
      private: repo.private,
      archived: repo.archived,
      fork: repo.fork,
      isOrg: repo.isOrg,
      defaultBranch: repo.defaultBranch,
      pushedAt: pushedAt && !Number.isNaN(pushedAt.getTime()) ? pushedAt : null,
      lastCommitter: repo.lastCommitter,
      htmlUrl: repo.htmlUrl,
      durationMs: repo.durationMs,
      status: repo.status,
      error: repo.error ?? null,
      skippedReason: repo.skippedReason ?? null,
      warnings: repo.warnings ?? [],
      findings: {
        create: repo.findings.map((finding) => ({
          findingKey: finding.id,
          severity: finding.severity,
          path: finding.path,
          line: finding.line,
          rule: finding.rule,
          ruleId: finding.ruleId,
          strategy: finding.strategy,
          message: finding.message,
          snippet: finding.snippet,
          revealed: finding.revealed,
          hiddenPadding: finding.hiddenPadding,
        })),
      },
      files: {
        create: Object.entries(repo.files).map(([path, text]) => ({
          path,
          text,
          byteSize: Buffer.byteLength(text),
        })),
      },
    },
  });
}

export async function finishScan(
  scanId: string,
  input: {
    status: StoredScanStatus;
    elapsedMs: number;
    error?: string | null;
    rateRemaining?: number | null;
    rateLimit?: number | null;
  },
): Promise<void> {
  const db = getPrisma();
  if (!db) return;
  const repos = await db.scanRepo.findMany({
    where: { scanId },
    select: { status: true, findings: { select: { severity: true } } },
  });
  const infectedCount = repos.filter((repo) => repo.status === "infected").length;
  const criticalCount = repos.reduce(
    (total, repo) => total + repo.findings.filter((finding) => finding.severity === "CRITICAL").length,
    0,
  );
  await db.scan.update({
    where: { id: scanId },
    data: {
      status: input.status,
      finishedAt: new Date(),
      elapsedMs: input.elapsedMs,
      repoScanned: repos.length,
      infectedCount,
      criticalCount,
      error: input.error ?? null,
      ...(input.rateRemaining != null ? { rateRemaining: input.rateRemaining } : {}),
      ...(input.rateLimit != null ? { rateLimit: input.rateLimit } : {}),
    },
  });
}

export async function listHistory(login: string): Promise<{ scans: ScanSummary[]; remediations: RemediationSummary[] }> {
  const db = getPrisma();
  if (!db || !login) return { scans: [], remediations: [] };
  const user = await db.user.findUnique({ where: { login } });
  if (!user) return { scans: [], remediations: [] };
  const [scans, remediations] = await Promise.all([
    db.scan.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: "desc" },
      take: 30,
    }),
    db.remediation.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);
  return {
    scans: scans.map(toSummary),
    remediations: remediations.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      mode: row.mode === "pr" ? "pr" : "commit",
      commitUrl: row.commitUrl,
      prUrl: row.prUrl,
      message: row.message,
      createdAt: row.createdAt.toISOString(),
      fallbackToPr: row.fallbackToPr,
    })),
  };
}

export async function readScan(login: string, scanId: string): Promise<{ scan: ScanSummary; repos: ScannedRepo[] } | null> {
  const db = getPrisma();
  if (!db || !login) return null;
  const scan = await db.scan.findFirst({
    where: { id: scanId, user: { login } },
    include: {
      repos: {
        include: { findings: true, files: true },
        orderBy: { fullName: "asc" },
      },
    },
  });
  if (!scan) return null;
  return {
    scan: toSummary(scan),
    repos: scan.repos.map(toScannedRepo),
  };
}

export async function recordRemediation(login: string, scanId: string | null, result: RemediationResult): Promise<void> {
  const db = getPrisma();
  if (!db || !login) return;
  const user = await db.user.findUnique({ where: { login } });
  if (!user) return;
  await db.remediation.create({
    data: {
      userId: user.id,
      owner: result.owner,
      name: result.name,
      fullName: `${result.owner}/${result.name}`,
      mode: result.mode,
      commitSha: result.commitSha,
      commitUrl: result.commitUrl,
      prUrl: result.prUrl,
      branch: result.branch,
      message: result.message,
      fallbackToPr: result.fallbackToPr,
      changes: result.changes as unknown as Prisma.InputJsonValue,
    },
  });
  if (!scanId) return;

  const repo = await db.scanRepo.findFirst({
    where: { scanId, owner: result.owner, name: result.name, scan: { userId: user.id } },
  });
  if (!repo) return;
  const changed = result.changes.map((change) => change.path);
  await db.$transaction(async (tx) => {
    if (changed.length > 0) {
      await tx.finding.deleteMany({
        where: { scanRepoId: repo.id, path: { in: changed }, strategy: { not: "review-only" } },
      });
    }
    for (const change of result.changes) {
      if (change.action === "delete") {
        await tx.scanFile.deleteMany({ where: { scanRepoId: repo.id, path: change.path } });
        continue;
      }
      if (change.after == null) continue;
      await tx.scanFile.updateMany({
        where: { scanRepoId: repo.id, path: change.path },
        data: { text: change.after, byteSize: Buffer.byteLength(change.after) },
      });
    }
    const remaining = await tx.finding.count({ where: { scanRepoId: repo.id } });
    await tx.scanRepo.update({
      where: { id: repo.id },
      data: { status: remaining > 0 ? "infected" : "clean" },
    });
  });
  await refreshScanCounts(scanId);
}

async function refreshScanCounts(scanId: string): Promise<void> {
  const db = getPrisma();
  if (!db) return;
  const repos = await db.scanRepo.findMany({
    where: { scanId },
    select: { status: true, findings: { select: { severity: true } } },
  });
  await db.scan.update({
    where: { id: scanId },
    data: {
      infectedCount: repos.filter((repo) => repo.status === "infected").length,
      criticalCount: repos.reduce(
        (total, repo) => total + repo.findings.filter((finding) => finding.severity === "CRITICAL").length,
        0,
      ),
    },
  });
}

function toSummary(scan: {
  id: string;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  elapsedMs: number | null;
  repoTotal: number;
  repoScanned: number;
  infectedCount: number;
  criticalCount: number;
  error: string | null;
}): ScanSummary {
  return {
    id: scan.id,
    status: STATUSES.has(scan.status as StoredScanStatus) ? (scan.status as StoredScanStatus) : "FAILED",
    startedAt: scan.startedAt.toISOString(),
    finishedAt: scan.finishedAt ? scan.finishedAt.toISOString() : null,
    elapsedMs: scan.elapsedMs,
    repoTotal: scan.repoTotal,
    repoScanned: scan.repoScanned,
    infectedCount: scan.infectedCount,
    criticalCount: scan.criticalCount,
    error: scan.error,
  };
}

function toScannedRepo(repo: {
  githubRepoId: string;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  isOrg: boolean;
  defaultBranch: string;
  pushedAt: Date | null;
  lastCommitter: string | null;
  htmlUrl: string;
  durationMs: number;
  status: string;
  error: string | null;
  skippedReason: string | null;
  warnings: Prisma.JsonValue;
  findings: Array<{
    findingKey: string;
    severity: string;
    path: string;
    line: number;
    rule: string;
    ruleId: string;
    strategy: string;
    message: string;
    snippet: string;
    revealed: string;
    hiddenPadding: boolean;
  }>;
  files: Array<{ path: string; text: string }>;
}): ScannedRepo {
  const files: Record<string, string> = {};
  for (const file of repo.files) files[file.path] = file.text;
  return {
    id: repo.githubRepoId,
    owner: repo.owner,
    name: repo.name,
    fullName: repo.fullName,
    private: repo.private,
    archived: repo.archived,
    fork: repo.fork,
    isOrg: repo.isOrg,
    defaultBranch: repo.defaultBranch,
    pushedAt: repo.pushedAt ? repo.pushedAt.toISOString() : null,
    lastCommitter: repo.lastCommitter,
    htmlUrl: repo.htmlUrl,
    durationMs: repo.durationMs,
    status: repoStatus(repo.status),
    findings: repo.findings.map(toFinding),
    files,
    error: repo.error ?? undefined,
    skippedReason: repo.skippedReason ?? undefined,
    warnings: Array.isArray(repo.warnings) ? repo.warnings.filter((item): item is string => typeof item === "string") : undefined,
  };
}

function toFinding(finding: {
  findingKey: string;
  severity: string;
  path: string;
  line: number;
  rule: string;
  ruleId: string;
  strategy: string;
  message: string;
  snippet: string;
  revealed: string;
  hiddenPadding: boolean;
}): Finding {
  return {
    id: finding.findingKey,
    severity: severityOf(finding.severity),
    path: finding.path,
    line: finding.line,
    rule: finding.rule,
    ruleId: finding.ruleId,
    strategy: strategyOf(finding.strategy),
    message: finding.message,
    snippet: finding.snippet,
    revealed: finding.revealed,
    hiddenPadding: finding.hiddenPadding,
  };
}

function repoStatus(status: string): ScannedRepo["status"] {
  if (status === "clean" || status === "infected" || status === "skipped" || status === "error") return status;
  return "error";
}

function severityOf(severity: string): Severity {
  if (severity === "CRITICAL" || severity === "HIGH" || severity === "MEDIUM") return severity;
  return "MEDIUM";
}

function strategyOf(strategy: string): AutoFixStrategy {
  if (
    strategy === "delete-file" ||
    strategy === "sanitize-package-json" ||
    strategy === "sanitize-config-tail" ||
    strategy === "sanitize-gitignore" ||
    strategy === "sanitize-vscode-tasks" ||
    strategy === "sanitize-vscode-settings" ||
    strategy === "review-only"
  ) {
    return strategy;
  }
  return "review-only";
}
