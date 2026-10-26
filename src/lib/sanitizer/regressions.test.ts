import { describe, expect, it } from "vitest";
import { sanitizePackageJson } from "@/lib/sanitizer/package-json";
import { sanitizeVscodeTasks } from "@/lib/sanitizer/vscode";
import { detectFile } from "@/lib/scanner/rules";

 describe("cleanup safety regressions", () => {
  it("does not overwrite exports with a matching script key", () => {
    const source = JSON.stringify({ scripts: { build: "node api.js && next build" }, exports: { build: "./dist/build.js" }, dependencies: { next: "15" } }, null, 2);
    const next = JSON.parse(sanitizePackageJson(source));
    expect(next.scripts.build).toBe("next build");
    expect(next.exports).toEqual({ build: "./dist/build.js" });
    expect(next.dependencies).toEqual({ next: "15" });
  });
  it("cleans compact package JSON and removes standalone hooks", () => {
    const source = '{"scripts":{"build":"node api.js && next build","preinstall":"node api.js"},"name":"demo"}';
    expect(JSON.parse(sanitizePackageJson(source))).toEqual({ scripts: { build: "next build" }, name: "demo" });
  });
  it("preserves CRLF and bytes outside the scripts object", () => {
    const source = '{\r\n  "scripts": {\r\n    "build": "node api.js && next build"\r\n  },\r\n  "description" : "keep  spacing"\r\n}\r\n';
    const clean = sanitizePackageJson(source);
    expect(clean).toContain('"description" : "keep  spacing"');
    expect(clean).not.toMatch(/(?<!\r)\n/);
    expect(JSON.parse(clean).scripts.build).toBe("next build");
  });
  it("finds and removes real VS Code runOptions tasks with JSONC comments and trailing commas", () => {
    const source = `{
      // VS Code permits comments.
      "tasks": [
        { "label": "dropper", "command": "node api.js", "runOptions": { "runOn": "folderOpen", }, },
        { "label": "test", "command": "npm test", },
      ],
    }`;
    const findings = detectFile(".vscode/tasks.json", source);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe("vscode-folder-open:dropper");
    expect(JSON.parse(sanitizeVscodeTasks(source)).tasks).toEqual([{ label: "test", command: "npm test" }]);
  });
  it("does not mistake comment-like strings for JSONC comments", () => {
    const source = '{"tasks":[{"label":"test","command":"echo https://example.invalid/*hello*/"}]}';
    expect(detectFile(".vscode/tasks.json", source)).toEqual([]);
    expect(sanitizeVscodeTasks(source)).toBe(source);
  });
});
