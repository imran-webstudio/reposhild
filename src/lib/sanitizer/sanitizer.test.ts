import { describe, expect, it } from "vitest";
import { CLEAN_POSTCSS, INFECTED_PACKAGE_JSON, INFECTED_POSTCSS } from "@/lib/demo/samples";
import { sanitizeConfigSource } from "@/lib/sanitizer/config";
import { sanitizePackageJson } from "@/lib/sanitizer/package-json";
import vm from "node:vm";

describe("package.json sanitizer", () => {
  it("strips node api.js && from dev, build, and start and removes install hooks", () => {
    const cleaned = sanitizePackageJson(INFECTED_PACKAGE_JSON);

    expect(cleaned).toContain(`"dependencies": {
    "next": "15.0.0",
    "react": "19.0.0"
  }`);
    expect(cleaned).toContain(`"dev": "next dev"`);
    expect(cleaned).toContain(`"build": "next build"`);
    expect(cleaned).toContain(`"start": "next start"`);
    expect(cleaned).toContain(`"lint": "next lint"`);
    expect(cleaned).not.toContain("node api.js");
    expect(cleaned).not.toContain("preinstall");
    expect(cleaned).not.toContain("postinstall");
    expect(cleaned).not.toContain("example.invalid");

    expect(JSON.parse(cleaned).scripts).toEqual({
      dev: "next dev",
      build: "next build",
      start: "next start",
      lint: "next lint",
    });
    expect(JSON.parse(cleaned).dependencies).toEqual({
      next: "15.0.0",
      react: "19.0.0",
    });
  });

  it("leaves a package.json without runners untouched", () => {
    const clean = `{
  "scripts": {
    "dev": "next dev",
    "build": "next build"
  }
}
`;
    expect(sanitizePackageJson(clean)).toBe(clean);
  });
});

describe("postcss config sanitizer", () => {
  it("puts the synthetic payload on line 10 and removes it without breaking the config", () => {
    const lines = INFECTED_POSTCSS.split("\n");
    expect(lines[9]).toContain("_0xdemo4f2a");
    expect(lines[9].length).toBeGreaterThan(500);
    expect(lines[9].startsWith(" ".repeat(50))).toBe(true);

    const cleaned = sanitizeConfigSource(INFECTED_POSTCSS);
    expect(cleaned).toBe(CLEAN_POSTCSS);
    expect(cleaned).not.toMatch(/_0x|eval\s*\(|global\s*\[/);
    expect(loadConfig(cleaned)).toEqual({
      plugins: {
        tailwindcss: {},
        autoprefixer: {},
      },
    });
  });

  it("strips a tab-padded payload sharing a line with the real export", () => {
    const inline = `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };${"\t".repeat(55)}global['!']=_0xabc123;eval('void 0');\n`;
    const cleaned = sanitizeConfigSource(inline);
    expect(cleaned.trim()).toBe("module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };");
    expect(cleaned).not.toMatch(/_0x|eval\s*\(|global\s*\[/);
    expect(loadConfig(cleaned)).toEqual({
      plugins: { tailwindcss: {}, autoprefixer: {} },
    });
  });

  it("does not rewrite a long config line that has no payload markers", () => {
    const source = `module.exports = { note: "${"a".repeat(520)}" };\n`;
    expect(sanitizeConfigSource(source)).toBe(source);
  });
});

function loadConfig(source: string): unknown {
  const module = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(source, { module, exports: module.exports }, { timeout: 500 });
  return module.exports;
}
