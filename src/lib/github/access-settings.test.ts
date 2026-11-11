import { describe, expect, it } from "vitest";
import { githubAccessSettingsUrl } from "./access-settings";
import { listRepositories } from "./scanner";
import type { Octokit } from "octokit";
import { vi } from "vitest";

describe("organization access", () => {
  it("links directly to the OAuth app without exposing secrets", () => {
    expect(githubAccessSettingsUrl("Ov23liExample123")).toBe("https://github.com/settings/connections/applications/Ov23liExample123");
    for (const id of [undefined, "", "../../elsewhere", "https://evil.invalid", "client?secret=value"]) expect(githubAccessSettingsUrl(id)).toBe("https://github.com/settings/applications");
  });
  it("lists authorized organization repositories on every scan, with pagination", async () => {
    const list = vi.fn();const organizationRepo = { full_name: "new-org/backend" };
    const paginate = vi.fn().mockResolvedValueOnce([organizationRepo]).mockResolvedValueOnce([organizationRepo, { full_name: "new-org/frontend" }]);
    const client = { paginate, rest: { repos: { listForAuthenticatedUser: list } } } as unknown as Octokit;
    expect(await listRepositories(client)).toEqual([organizationRepo]);
    expect(await listRepositories(client)).toHaveLength(2);
    expect(paginate).toHaveBeenCalledWith(list, expect.objectContaining({ affiliation: "owner,collaborator,organization_member", visibility: "all", per_page: 100 }));
  });
});
