import { describe, expect, it, vi } from "vitest";
import type { Octokit } from "octokit";
import { inspectRemoteRepo, type ListedRepo } from "@/lib/github/scanner";
import { planRemediation } from "@/lib/sanitizer";
import { REFERENCED_FONT_BYTE_CAP } from "@/lib/scanner/fonts";

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

  it("deletes a referenced font that is not a font and keeps a real one", async () => {
    const tasks = JSON.stringify({
      version: "2.0.0",
      tasks: [{
        label: "eslint-check",
        command: "node",
        args: ["./public/fonts/fa-solid-300.ttf", "./public/fonts/real.ttf"],
        runOptions: { runOn: "folderOpen" },
      }],
    });
    const script = Buffer.from("module.exports = 1\n");
    const real = Buffer.from([0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0]);
    const getBlob = vi.fn(async ({ file_sha }: { file_sha: string }) => ({
      data: {
        encoding: "base64",
        content: (file_sha === "fontsha" ? script : real).toString("base64"),
      },
    }));
    const client = {
      rest: {
        git: {
          getRef: vi.fn().mockResolvedValue({ data: { object: { sha } } }),
          getTree: vi.fn().mockResolvedValue({
            data: {
              truncated: false,
              tree: [
                { type: "blob", path: ".vscode/tasks.json", size: tasks.length, mode: "100644", sha: "tasksha" },
                { type: "blob", path: "public/fonts/fa-solid-300.ttf", size: script.length, mode: "100644", sha: "fontsha" },
                { type: "blob", path: "public/fonts/real.ttf", size: real.length, mode: "100644", sha: "realsha" },
              ],
            },
          }),
          getBlob,
        },
        repos: { getContent: vi.fn() },
      },
      graphql: vi.fn().mockResolvedValue({ repository: { b0: { text: tasks, isBinary: false } } }),
    };
    const result = await inspectRemoteRepo(client as unknown as Octokit, repo);
    expect(getBlob.mock.calls.map((call) => call[0].file_sha).sort()).toEqual(["fontsha", "realsha"]);
    expect(result.findings.find((finding) => finding.path === "public/fonts/fa-solid-300.ttf")?.strategy).toBe("delete-file");
    expect(result.findings.some((finding) => finding.path === "public/fonts/real.ttf")).toBe(false);
    expect(result.fileModes?.["public/fonts/fa-solid-300.ttf"]).toBe("100644");
    const plan = planRemediation(result.files, result.findings);
    expect(plan.find((change) => change.path === "public/fonts/fa-solid-300.ttf")?.action).toBe("delete");
    expect(JSON.parse(plan.find((change) => change.path === ".vscode/tasks.json")?.after ?? "{}").tasks).toEqual([]);
  });

  it("leaves a referenced font in place when it is too large to verify", async () => {
    const tasks = JSON.stringify({
      tasks: [{ label: "open", command: "node public/fonts/huge.ttf", runOn: "folderOpen" }],
    });
    const getBlob = vi.fn();
    const client = {
      rest: {
        git: {
          getRef: vi.fn().mockResolvedValue({ data: { object: { sha } } }),
          getTree: vi.fn().mockResolvedValue({
            data: {
              truncated: false,
              tree: [
                { type: "blob", path: ".vscode/tasks.json", size: tasks.length, mode: "100644", sha: "tasksha" },
                { type: "blob", path: "public/fonts/huge.ttf", size: REFERENCED_FONT_BYTE_CAP + 1, mode: "100644", sha: "hugesha" },
              ],
            },
          }),
          getBlob,
        },
        repos: { getContent: vi.fn() },
      },
      graphql: vi.fn().mockResolvedValue({ repository: { b0: { text: tasks, isBinary: false } } }),
    };
    const result = await inspectRemoteRepo(client as unknown as Octokit, repo);
    expect(getBlob).not.toHaveBeenCalled();
    expect(result.findings.find((finding) => finding.path === "public/fonts/huge.ttf")?.strategy).toBe("review-only");
    const plan = planRemediation(result.files, result.findings);
    expect(plan.some((change) => change.path === "public/fonts/huge.ttf")).toBe(false);
    expect(plan.some((change) => change.path === ".vscode/tasks.json")).toBe(true);
  });
});
