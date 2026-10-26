import { afterEach, describe, expect, it, vi } from "vitest";
import { isAdminGitHubId } from "@/lib/admin/access";
import { adminQuery } from "@/lib/admin/query";
import { GET } from "@/app/api/admin/route";
const { session, db } = vi.hoisted(() => ({ session: vi.fn(), db: { $transaction: vi.fn() } }));
vi.mock("@/lib/github/session", () => ({ getGitHubToken: session }));
vi.mock("@/lib/db", () => ({ getPrisma: () => db }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("admin authorization", () => {
  it("denies all accounts by default", () => { vi.stubEnv("ADMIN_GITHUB_IDS", ""); expect(isAdminGitHubId("123")).toBe(false); });
  it("requires an exact immutable ID in the allowlist", () => {
    vi.stubEnv("ADMIN_GITHUB_IDS", "123, 456, owner");
    expect(isAdminGitHubId("123")).toBe(true); expect(isAdminGitHubId("12")).toBe(false);
    expect(isAdminGitHubId("owner")).toBe(false); expect(isAdminGitHubId(null)).toBe(false);
  });
  it("returns 401 before querying data for an anonymous request", async () => {
    session.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/api/admin"))).status).toBe(401); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("returns 403 before querying data for a regular signed-in user", async () => {
    vi.stubEnv("ADMIN_GITHUB_IDS", "123"); session.mockResolvedValue({ githubId: "456" });
    expect((await GET(new Request("http://localhost/api/admin"))).status).toBe(403); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("queries data only for an allowlisted ID and prevents caching", async () => {
    vi.stubEnv("ADMIN_GITHUB_IDS", "123"); session.mockResolvedValue({ githubId: "123" }); db.$transaction.mockResolvedValue({ users: [] });
    const response = await GET(new Request("http://localhost/api/admin"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
describe("admin filtering", () => {
  it("combines repository search, user, action, outcome, time, and page filters", () => {
    const result = adminQuery(new URLSearchParams({ q: "owner/demo", action: "cleanup_failed", outcome: "failure", period: "week", userId: "u1", page: "2" }), new Date("2026-10-26T00:00:00Z"));
    expect(result.page).toBe(2); expect(result.activityWhere).toMatchObject({ action: "cleanup_failed", outcome: "failure", userId: "u1", createdAt: { gte: new Date("2026-10-19T00:00:00Z") } });
    expect(result.activityWhere.OR).toHaveLength(2);
  });
  it("bounds pagination and ignores unsupported action filters", () => {
    const result = adminQuery(new URLSearchParams({ page: "Infinity", action: "invented", outcome: "invented" }));
    expect(result.page).toBe(1); expect(result.pageSize).toBe(25); expect(result.activityWhere).toEqual({});
  });
  it("combines user search and active account filtering", () => {
    const result = adminQuery(new URLSearchParams({ view: "users", q: "alice", engagement: "active" }));
    expect(result.userWhere.OR).toHaveLength(3); expect(result.userWhere.lastSeenAt).toBeDefined();
  });
});
