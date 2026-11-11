import { describe, expect, it, vi } from "vitest";
import type { Octokit } from "octokit";
import { applyPullRepair, previewPullRepair } from "./pull";
const head = "a".repeat(40);
const target = { owner: "test", repo: "backend", branch: "release/fix", head };
const infected = "init();" + "\t".repeat(180) + "var z='-1000';var NX,SX,spin,splitLane,peel;(function(){var a=['x'];" + "x".repeat(300) + "})(global,require);\n";
function fixture(options: { moved?: boolean; truncated?: boolean; source?: string; submodule?: boolean } = {}) {
  const source = options.source ?? infected;
  const api = {
    rest: {
      repos: { get: vi.fn().mockResolvedValue({ data: { archived: false, disabled: false } }) },
      git: {
        getRef: vi.fn().mockResolvedValue({ data: { object: { sha: options.moved ? "b".repeat(40) : head } } }),
        getTree: vi.fn().mockResolvedValue({ data: { truncated: !!options.truncated, tree: options.submodule ? [{ path: "sub", type: "commit", mode: "160000" }] : [{ path: "init", sha: "c".repeat(40), type: "blob", mode: "100755", size: Buffer.byteLength(source) }] } }),
        getBlob: vi.fn().mockResolvedValue({ data: { encoding: "base64", content: Buffer.from(source).toString("base64") } }),
        createRef: vi.fn().mockResolvedValue({}),
      },
      pulls: { create: vi.fn().mockResolvedValue({ data: { html_url: "https://github.com/test/backend/pull/1" } }) },
    },
    graphql: vi.fn().mockResolvedValue({ createCommitOnBranch: { commit: { oid: "d".repeat(40), url: "https://github.com/test/backend/commit/repair" } } }),
  };
  return { api, octokit: api as unknown as Octokit };
}
describe("pull repair delegation", () => {
  it("previews immutable blobs without any GitHub write", async () => {
    const { api, octokit } = fixture();const result = await previewPullRepair(octokit, target);
    expect(result.changes[0].after).toBe("init();\n");expect(result.unresolved).toEqual([]);
    expect(api.rest.git.getTree).toHaveBeenCalledWith(expect.objectContaining({ tree_sha: head }));
    expect(api.graphql).not.toHaveBeenCalled();expect(api.rest.git.createRef).not.toHaveBeenCalled();
  });
  it("writes exact edits and the verifiable footer using expectedHeadOid", async () => {
    const { api, octokit } = fixture();await applyPullRepair(octokit, target, "commit");
    const input = api.graphql.mock.calls[0][1].input;
    expect(input.expectedHeadOid).toBe(head);expect(input.branch.branchName).toBe(target.branch);
    expect(input.message.body).toBe("RepoShield-Repair: padding-tail-v1");
    expect(Buffer.from(input.fileChanges.additions[0].contents, "base64").toString()).toBe("init();\n");
  });
  it("opens a PR against the requested non-default branch", async () => {
    const { api, octokit } = fixture();const result = await applyPullRepair(octokit, target, "pr");
    expect(api.rest.git.createRef).toHaveBeenCalledWith(expect.objectContaining({ sha: head }));
    expect(api.rest.pulls.create).toHaveBeenCalledWith(expect.objectContaining({ base: "release/fix" }));
    expect(result.prUrl).toContain("/pull/1");
  });
  it("never writes for stale, incomplete, submodule, or unsupported snapshots", async () => {
    for (const options of [{ moved: true }, { truncated: true }, { submodule: true }, { source: infected.replace("var NX,SX,spin,splitLane,peel;", "var NX;") }]) {
      const { api, octokit } = fixture(options);
      await expect(applyPullRepair(octokit, target, "commit")).rejects.toThrow();
      expect(api.graphql).not.toHaveBeenCalled();expect(api.rest.git.createRef).not.toHaveBeenCalled();
    }
  });
  it("does not fall back to an unguarded write after a concurrent branch change", async () => {
    const { api, octokit } = fixture();api.graphql.mockRejectedValue(new Error("expectedHeadOid mismatch"));
    await expect(applyPullRepair(octokit, target, "commit")).rejects.toThrow("expectedHeadOid");
    expect(api.graphql).toHaveBeenCalledTimes(1);expect(api.rest.git.createRef).not.toHaveBeenCalled();
  });
});
