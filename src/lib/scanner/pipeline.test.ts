import { describe, expect, it } from "vitest";
import { DEMO_REPOS } from "@/lib/demo/fixtures";
import { isHighRiskPath, shouldSkipBlob } from "@/lib/github/paths";
import { analyzeRepositoryFiles } from "@/lib/scanner/engine";
import { planRemediation } from "@/lib/sanitizer";

function analyze(files: Record<string, string>) {
  return analyzeRepositoryFiles(
    Object.entries(files).map(([path, text]) => ({ path, text, byteSize: text.length })),
  );
}

describe("demo repository pipeline", () => {
  it("cleans the storefront fixture in one plan and leaves a valid project", () => {
    const storefront = DEMO_REPOS.find((repo) => repo.name === "storefront");
    expect(storefront).toBeTruthy();
    const analyzed = analyze(storefront!.files);

    expect(analyzed.findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining([
        "package-script:dev",
        "package-script:preinstall",
        "package-script:postinstall",
        "config-tail",
        "obfuscated-dropper",
        "vscode-folder-open:install hook",
        "gitignore-cloak",
      ]),
    );
    expect(analyzed.findings.find((finding) => finding.path === "postcss.config.js")?.line).toBe(10);
    expect(analyzed.findings.find((finding) => finding.path === "postcss.config.js")?.hiddenPadding).toBe(true);

    const plan = planRemediation(analyzed.files, analyzed.findings);
    const packageChange = plan.find((change) => change.path === "package.json");
    expect(packageChange?.after).toContain('"dev": "next dev"');
    expect(packageChange?.after).not.toContain("api.js");

    const postcss = plan.find((change) => change.path === "postcss.config.js");
    expect(postcss?.after).toContain("tailwindcss");
    expect(postcss?.after).not.toContain("_0x");

    const tasks = plan.find((change) => change.path === ".vscode/tasks.json");
    expect(JSON.parse(tasks?.after ?? "{}").tasks).toEqual([
      { label: "test", type: "shell", command: "npm test" },
    ]);

    expect(plan.find((change) => change.path === "api.js")?.action).toBe("delete");

    const cleaned = { ...storefront!.files };
    for (const change of plan) {
      if (change.action === "delete") delete cleaned[change.path];
      else if (change.after != null) cleaned[change.path] = change.after;
    }
    const again = analyze(cleaned);
    expect(again.findings.filter((finding) => finding.strategy !== "review-only")).toEqual([]);
  });

  it("does not flag the clean design-system fixture", () => {
    const repo = DEMO_REPOS.find((item) => item.name === "design-system");
    expect(analyze(repo!.files).findings).toEqual([]);
  });

  it("keeps a legitimate prepare suffix after the runner", () => {
    const repo = DEMO_REPOS.find((item) => item.name === "cli");
    const analyzed = analyze(repo!.files);
    const plan = planRemediation(analyzed.files, analyzed.findings);
    const manifest = plan.find((change) => change.path === "package.json");
    expect(JSON.parse(manifest?.after ?? "{}").scripts).toEqual({
      prepare: "echo keep-me",
      dev: "tsc -w",
    });
  });
});

describe("path filters", () => {
  it("skips heavy blobs and keeps high-risk entrypoints", () => {
    expect(shouldSkipBlob("assets/logo.png", 1000)).toBe(true);
    expect(shouldSkipBlob("dist/app.js", 100)).toBe(true);
    expect(shouldSkipBlob("package-lock.json", 100)).toBe(true);
    expect(shouldSkipBlob("src/video.mp4", 100)).toBe(true);
    expect(shouldSkipBlob("notes/huge.js", 250_001)).toBe(true);
    expect(shouldSkipBlob("package.json", 400)).toBe(false);

    expect(isHighRiskPath("package.json", 400)).toBe(true);
    expect(isHighRiskPath("postcss.config.js", 200)).toBe(true);
    expect(isHighRiskPath(".github/workflows/ci.yml", 300)).toBe(true);
    expect(isHighRiskPath(".vscode/tasks.json", 300)).toBe(true);
    expect(isHighRiskPath("api.js", 100)).toBe(true);
    expect(isHighRiskPath("src/big-bundle.js", 10_001)).toBe(true);
    expect(isHighRiskPath("src/app.tsx", 4_000)).toBe(false);
    expect(isHighRiskPath("README.md", 2_000)).toBe(false);
  });
});
