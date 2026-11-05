import { describe, expect, it } from "vitest";
import { planRemediation } from "@/lib/sanitizer";
import { folderOpenFontPaths, fontPreview, isRealFont } from "@/lib/scanner/fonts";
import { detectFakeFont, detectFile } from "@/lib/scanner/rules";

const tasks = `{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "eslint-check",
      "type": "shell",
      "command": "node",
      "args": ["./public/fonts/fa-solid-300.ttf"],
      "runOptions": { "runOn": "folderOpen" }
    },
    {
      "label": "build",
      "type": "shell",
      "command": "echo public/fonts/keep.ttf"
    }
  ]
}
`;

describe("folder-open font paths", () => {
  it("reads font arguments from a folder-open task", () => {
    expect(folderOpenFontPaths(tasks)).toEqual(["public/fonts/fa-solid-300.ttf"]);
  });

  it("reads a quoted command, a windows path, a working directory, and a platform override", () => {
    const source = `{
      "tasks": [
        {
          "label": "quoted",
          "command": "node \\"./fonts/quoted.otf\\"",
          "runOn": "folderOpen"
        },
        {
          "label": "windows-path",
          "command": "node",
          "args": [".\\\\public\\\\fonts\\\\win.woff2"],
          "runOptions": { "runOn": "folderOpen" }
        },
        {
          "label": "cwd",
          "command": "node",
          "args": ["fa-solid-300.ttf"],
          "options": { "cwd": "public/fonts" },
          "runOptions": { "runOn": "folderOpen" }
        },
        {
          "label": "override",
          "command": "npm test",
          "windows": { "args": ["brand/icon.eot"] },
          "runOptions": { "runOn": "folderOpen" }
        }
      ]
    }`;
    expect(folderOpenFontPaths(source)).toEqual([
      "brand/icon.eot",
      "fonts/quoted.otf",
      "public/fonts/fa-solid-300.ttf",
      "public/fonts/win.woff2",
    ]);
  });

  it("ignores fonts outside the workspace and tasks that do not run on open", () => {
    const source = `{
      "tasks": [
        {
          "label": "escape",
          "command": "node ../../outside.ttf",
          "runOn": "folderOpen"
        },
        {
          "label": "manual",
          "command": "node public/fonts/manual.ttf"
        }
      ]
    }`;
    expect(folderOpenFontPaths(source)).toEqual([]);
    expect(folderOpenFontPaths("{")).toEqual([]);
  });
});

describe("font bytes", () => {
  it("recognizes font headers and treats a script as something else", () => {
    expect(isRealFont(Uint8Array.from([0x00, 0x01, 0x00, 0x00, 0, 0]))).toBe(true);
    expect(isRealFont(Uint8Array.from(Buffer.from("OTTO")))).toBe(true);
    expect(isRealFont(Uint8Array.from(Buffer.from("wOFF")))).toBe(true);
    expect(isRealFont(Uint8Array.from(Buffer.from("wOF2")))).toBe(true);
    const eot = new Uint8Array(36);
    eot[8] = 0x00;
    eot[9] = 0x00;
    eot[10] = 0x01;
    eot[11] = 0x00;
    eot[34] = 0x4c;
    eot[35] = 0x50;
    expect(isRealFont(eot)).toBe(true);

    const script = Uint8Array.from(Buffer.from("module.exports = 1\n"));
    expect(isRealFont(script)).toBe(false);
    expect(detectFakeFont("public/fonts/fa-solid-300.ttf", script)?.strategy).toBe("delete-file");
    expect(detectFakeFont("public/fonts/real.ttf", Uint8Array.from([0x00, 0x01, 0x00, 0x00]))).toBeNull();
    expect(fontPreview(script)).toBe("module.exports = 1\n");
  });

  it("plans a delete for the fake font and still removes the folder-open task", () => {
    const font = "module.exports = 1\n";
    const path = "public/fonts/fa-solid-300.ttf";
    const findings = [...detectFile(".vscode/tasks.json", tasks), detectFakeFont(path, Buffer.from(font))!];
    const plan = planRemediation(
      { ".vscode/tasks.json": tasks, [path]: font },
      findings,
    );
    expect(plan.find((change) => change.path === path)?.action).toBe("delete");
    expect(JSON.parse(plan.find((change) => change.path === ".vscode/tasks.json")?.after ?? "{}").tasks).toEqual([
      { label: "build", type: "shell", command: "echo public/fonts/keep.ttf" },
    ]);
  });
});
