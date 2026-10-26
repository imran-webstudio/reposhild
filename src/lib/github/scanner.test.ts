import { describe, expect, it, vi } from "vitest";
import type { Octokit } from "octokit";
import { inspectRemoteRepo, type ListedRepo } from "@/lib/github/scanner";

const sha = "a".repeat(40);
const repo: ListedRepo = { id: 1, name: "demo", full_name: "owner/demo", private: true, fork: false, archived: false, size: 1, default_branch: "main", pushed_at: null, html_url: "https://github.com/owner/demo", owner: { login: "owner", type: "User" } };
function mockRepo() {
  return {
    rest: {
      git: { getRef: vi.fn().mockResolvedValue({ data: { object: { sha } } }), getTree: vi.fn().mockResolvedValue({ data: { truncated: false, tree: [{ type: "blob", path: "package.json", size: 40, mode: "100644" }] } }) },
      repos: { getContent: vi.fn().mockRejectedValue(new Error("Could not load file")) },
    },
    graphql: vi.fn().mockResolvedValue({ repository: { b0: { text: '{"scripts":{"test":"vitest"}}', isBinary: false } } }),
  };
}
describe("scan coverage and immutable revisions", () => {
  it("pins tree and file queries to the same commit", async () => {
    const client = mockRepo();
    const result = await inspectRemoteRepo(client as unknown as Octokit, repo);
    expect(result.status).toBe("clean"); expect(result.headSha).toBe(sha);
    expect(client.rest.git.getTree).toHaveBeenCalledWith(expect.objectContaining({ tree_sha: sha }));
    expect(client.graphql.mock.calls[0][0]).toContain(`${sha}:package.json`);
    expect(client.graphql.mock.calls[0][0]).not.toContain("HEAD:");
  });
  it("reports failure rather than clean when candidate file reads fail", async () => {
    const client = mockRepo(); client.graphql.mockRejectedValue(new Error("Rate limit"));
    const result = await inspectRemoteRepo(client as unknown as Octokit, repo);
    expect(result.status).toBe("error");
    expect(result.warnings?.join(" ")).toContain("package.json");
    expect(client.rest.repos.getContent).toHaveBeenCalledWith(expect.objectContaining({ ref: sha }));
  });
  it("does not mark a truncated tree clean", async () => {
    const client = mockRepo(); client.rest.git.getTree.mockResolvedValue({ data: { truncated: true, tree: [] } });
    expect((await inspectRemoteRepo(client as unknown as Octokit, repo)).status).toBe("error");
  });
  it("reports unavailable GraphQL blobs as incomplete coverage", async () => {
    const client = mockRepo(); client.graphql.mockResolvedValue({ repository: { b0: null } });
    expect((await inspectRemoteRepo(client as unknown as Octokit, repo)).status).toBe("error");
  });
});
