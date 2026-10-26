import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { GET } from "@/app/api/admin/route";
import { getPrisma } from "@/lib/db";
import { recordRemediation, rememberUser } from "@/lib/persistence/history";
import type { RemediationResult } from "@/lib/scanner/types";
const { session } = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/github/session", () => ({ getGitHubToken: session }));

// Opt-in only: requires a migrated PostgreSQL database. All created rows are removed by ID.
describe.runIf(process.env.RUN_DB_TESTS === "1")("admin PostgreSQL integration", () => {
  let db: PrismaClient;
  const stamp = Date.now().toString();
  const prefix = `audit-check-${stamp}`;
  const ids: string[] = [];
  let scanId: string;
  let scanRepoId: string;
  const githubId = `900${stamp}`;
  beforeAll(async () => {
    vi.stubEnv("ADMIN_GITHUB_IDS", "900000000001");
    session.mockResolvedValue({ githubId: "900000000001" });
    db = getPrisma()!;
    const first = await db.user.create({ data: { login: prefix, githubId, lastSeenAt: new Date() } }); ids.push(first.id);
    const second = await db.user.create({ data: { login: `${prefix}-inactive`, githubId: `901${stamp}`, lastSeenAt: new Date(Date.now() - 40 * 86400000) } }); ids.push(second.id);
    const scan = await db.scan.create({ data: { userId: first.id, status: "COMPLETED", repoTotal: 1, repoScanned: 1, infectedCount: 1 } }); scanId = scan.id;
    const repo = await db.scanRepo.create({ data: {
      scanId, githubRepoId: "123", owner: prefix, name: "demo", fullName: `${prefix}/demo`, private: true, archived: false,
      fork: false, isOrg: false, defaultBranch: "main", headSha: "a".repeat(40), htmlUrl: "https://github.com/example/demo", durationMs: 1, status: "infected",
      findings: { create: { findingKey: "test", severity: "CRITICAL", path: "api.js", line: 1, rule: "fixture", ruleId: "fixture", strategy: "delete-file", message: "fixture", snippet: "fixture", revealed: "fixture", hiddenPadding: false } },
      files: { create: { path: "api.js", text: "fixture", byteSize: 7 } },
    } }); scanRepoId = repo.id;
    await db.activity.createMany({ data: [
      { userId: first.id, action: "sign_in", outcome: "success" },
      { userId: first.id, action: "scan_finished", outcome: "failure", target: `${prefix}/demo` },
      { userId: second.id, action: "history_viewed", outcome: "success", target: `${prefix}/demo` },
    ] });
  });
  afterAll(async () => {
    if (db && ids.length) await db.user.deleteMany({ where: { id: { in: ids } } });
    vi.unstubAllEnvs();
    if (db) await db.$disconnect();
  });
  it("searches real user rows and applies active filters", async () => {
    const response = await GET(new Request(`http://localhost/api/admin?view=users&q=${prefix}&engagement=active`));
    expect(response.status).toBe(200);
    const body = await response.json(); expect(body.total).toBe(1); expect(body.users[0].login).toBe(prefix);
    expect(body.users[0]._count.scans).toBe(1); expect(body.users[0].email).toBeUndefined();
  });
  it("combines SQL action, outcome, user, time, and target filters", async () => {
    const response = await GET(new Request(`http://localhost/api/admin?view=activity&q=${prefix}&action=scan_finished&outcome=failure&userId=${ids[0]}&period=week`));
    const body = await response.json(); expect(response.status).toBe(200); expect(body.total).toBe(1);
    expect(body.activities[0].target).toBe(`${prefix}/demo`); expect(body.activities[0].user.id).toBe(ids[0]);
  });
  it("bounds requested pages using the actual matching record count", async () => {
    const response = await GET(new Request(`http://localhost/api/admin?view=users&q=${prefix}&page=1000`));
    const body = await response.json(); expect(body.page).toBe(1); expect(body.total).toBe(2); expect(body.users).toHaveLength(2);
  });
  it("keeps real stored findings and files intact after opening a fix PR", async () => {
    await recordRemediation(githubId, scanId, {
      owner: prefix, name: "demo", mode: "pr", commitSha: "b".repeat(40), commitUrl: "https://github.com/example/demo/commit/b",
      prUrl: "https://github.com/example/demo/pull/1", branch: "fix", message: "pending", fallbackToPr: false,
      changes: [{ path: "api.js", action: "delete", before: "fixture", after: null, strategies: ["delete-file"], rules: ["fixture"] }],
    } satisfies RemediationResult);
    expect(await db.finding.count({ where: { scanRepoId } })).toBe(1);
    expect(await db.scanFile.count({ where: { scanRepoId } })).toBe(1);
    expect((await db.scanRepo.findUnique({ where: { id: scanRepoId } }))?.status).toBe("infected");
  });
  it("preserves an existing account across a real username change", async () => {
    const renamed = await rememberUser({ githubId, login: `${prefix}-renamed` });
    expect(renamed?.id).toBe(ids[0]);
    expect(await db.scan.count({ where: { userId: renamed!.id } })).toBe(1);
  });
});
