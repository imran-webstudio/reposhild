import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();

vi.mock("@/lib/db", () => ({
  getPrisma: () => ({
    remediation: { findMany },
  }),
}));

describe("findReinfectedRepos", () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  it("returns infected repos that previously had a commit cleanup", async () => {
    findMany.mockResolvedValue([{ fullName: "acme/app" }, { fullName: "acme/api" }]);
    const { findReinfectedRepos } = await import("@/lib/persistence/history");
    await expect(findReinfectedRepos("user-1", ["acme/app", "acme/web", "acme/api"])).resolves.toEqual([
      "acme/api",
      "acme/app",
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: "user-1",
          mode: "commit",
          fullName: { in: ["acme/app", "acme/web", "acme/api"] },
        }),
      }),
    );
  });

  it("returns empty when nothing was previously cleaned", async () => {
    findMany.mockResolvedValue([]);
    const { findReinfectedRepos } = await import("@/lib/persistence/history");
    await expect(findReinfectedRepos("user-1", ["acme/app"])).resolves.toEqual([]);
  });
});
