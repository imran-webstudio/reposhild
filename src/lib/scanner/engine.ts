import { detectFile } from "@/lib/scanner/rules";
import type { FetchedFile, Finding, RepoStatus } from "@/lib/scanner/types";

export function analyzeRepositoryFiles(files: FetchedFile[]): {
  findings: Finding[];
  files: Record<string, string>;
} {
  const findings = files.flatMap((file) => detectFile(file.path, file.text, file.byteSize));
  findings.sort(compareFindings);
  const relevant = new Set(findings.map((finding) => finding.path));
  const contents: Record<string, string> = {};
  for (const file of files) {
    if (relevant.has(file.path)) contents[file.path] = file.text;
  }
  return { findings, files: contents };
}

export function statusFor(findings: Finding[]): RepoStatus {
  return findings.length > 0 ? "infected" : "clean";
}

const SEVERITY_RANK: Record<Finding["severity"], number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
};

function compareFindings(a: Finding, b: Finding): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  if (a.path !== b.path) return a.path.localeCompare(b.path);
  return a.line - b.line;
}
