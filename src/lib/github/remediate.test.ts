import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Octokit } from "octokit";
import { inspectOwnerRepo } from "@/lib/github/scanner";
import { remediateRepository } from "@/lib/github/remediate";
import type { ScannedRepo } from "@/lib/scanner/types";
vi.mock("@/lib/github/scanner", () => ({ inspectOwnerRepo: vi.fn() }));
const sha = "a".repeat(40);
const fixture = { status: "infected", defaultBranch: "main", headSha: sha, warnings: [], files: { "api.js": "synthetic test fixture" }, findings: [{ id: "dropper", path: "api.js", severity: "CRITICAL", rule: "dropper", ruleId: "dropper", strategy: "delete-file", line: 1, message: "fixture", snippet: "", revealed: "", hiddenPadding: false }] } as unknown as ScannedRepo;
function client() {
  return { rest: { git: {
    getRef: vi.fn().mockResolvedValue({ data: { object: { sha } } }),
    getCommit: vi.fn().mockResolvedValue({ data: { tree: { sha: "tree" } } }),
    createRef: vi.fn().mockResolvedValue({}), createTree: vi.fn(), createCommit: vi.fn(), updateRef: vi.fn(),
  }, repos: { get: vi.fn().mockResolvedValue({ data: { permissions: { push: true } } }) }, pulls: { create: vi.fn().mockResolvedValue({ data: { html_url: "https://github.com/owner/demo/pull/1" } }) } }, graphql: vi.fn().mockResolvedValue({ createCommitOnBranch: { commit: { oid: "b".repeat(40) } } }) };
}
beforeEach(() => { vi.mocked(inspectOwnerRepo).mockResolvedValue(fixture); });
describe("remediation revision safety", () => {
  it("rejects a preview of an older revision before writing", async () => {
    const api = client();
    await expect(remediateRepository(api as unknown as Octokit, "owner", "demo", "commit", "c".repeat(40))).rejects.toMatchObject({ status: 409 });
    expect(api.graphql).not.toHaveBeenCalled(); expect(api.rest.git.createRef).not.toHaveBeenCalled();
  });
  it("rejects a branch change between scan and writing", async () => {
    const api = client(); api.rest.git.getRef.mockResolvedValueOnce({ data: { object: { sha } } }).mockResolvedValue({ data: { object: { sha: "c".repeat(40) } } });
    await expect(remediateRepository(api as unknown as Octokit, "owner", "demo", "commit", sha)).rejects.toMatchObject({ status: 409 });
    expect(api.graphql).not.toHaveBeenCalled();
  });
  it("uses the scanned revision as the expected commit head", async () => {
    const api = client(); const result = await remediateRepository(api as unknown as Octokit, "owner", "demo", "commit", sha);
    expect(result.mode).toBe("commit");
    expect(api.graphql).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ input: expect.objectContaining({ expectedHeadOid: sha }) }));
  });
  it("branches a fix PR from the scanned revision", async () => {
    const api = client(); const result = await remediateRepository(api as unknown as Octokit, "owner", "demo", "pr", sha);
    expect(result.mode).toBe("pr"); expect(api.rest.git.createRef).toHaveBeenCalledWith(expect.objectContaining({ sha }));
  });
});
