import { describe, expect, it } from "vitest";
import { isHighRiskPath } from "@/lib/github/paths";
import { detectFile } from "@/lib/scanner/rules";
import { sanitizeConfigSource } from "@/lib/sanitizer/config";

const clean = "function init() {}\ninit();";
const infected = clean + "\t".repeat(180) + "var z = '-1000';var NX,SX,spin,splitLane,peel;(function(){var a=['x'];" + "x".repeat(300) + "})(global,require);\n";

describe("incident launcher coverage", () => {
  it("selects and detects extensionless init without deleting legitimate initialization", () => {
    expect(isHighRiskPath("apps/web/init", infected.length)).toBe(true);
    const findings = detectFile("apps/web/init", infected);
    expect(findings.some((f) => f.ruleId === "config-tail" && f.line === 2)).toBe(true);
    expect(sanitizeConfigSource(infected)).toBe(clean + "\n");
    expect(detectFile("apps/web/init", clean)).toEqual([]);
  });
  it("selects and detects ESLint configs used in the incident", () => {
    expect(isHighRiskPath("eslint.config.mjs", infected.length)).toBe(true);
    expect(detectFile("eslint.config.mjs", infected).some((f) => f.ruleId === "config-tail")).toBe(true);
  });
});
