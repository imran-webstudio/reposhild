import { describe, expect, it } from "vitest";
import { planRemediation } from "@/lib/sanitizer";
import { sanitizePackageJson } from "@/lib/sanitizer/package-json";
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
  it("deletes tasks.json instead of editing the task list", () => {
    const source = `{
      // VS Code permits comments.
      "tasks": [
        { "label": "dropper", "command": "node api.js", "runOptions": { "runOn": "folderOpen", }, },
        { "label": "test", "command": "npm test", },
      ],
    }`;
    const findings = detectFile(".vscode/tasks.json", source);
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe("vscode-tasks");
    expect(findings[0].strategy).toBe("delete-file");
    expect(planRemediation({ ".vscode/tasks.json": source }, findings)).toEqual([
      expect.objectContaining({ path: ".vscode/tasks.json", action: "delete", after: null }),
    ]);
  });
  it("deletes a tasks.json that only contains an ordinary task", () => {
    const source = '{"tasks":[{"label":"test","command":"echo https://example.invalid/*hello*/"}]}';
    const findings = detectFile(".vscode/tasks.json", source);
    expect(findings.map((finding) => finding.strategy)).toEqual(["delete-file"]);
    expect(planRemediation({ ".vscode/tasks.json": source }, findings)[0]?.action).toBe("delete");
  });
});
