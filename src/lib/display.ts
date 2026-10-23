import type { AutoFixStrategy, ScannedRepo } from "@/lib/scanner/types";

export function statusLabel(repo: ScannedRepo): {
  text: string;
  tone: "clean" | "critical" | "warn" | "muted";
} {
  if (repo.status === "error") return { text: "ERROR", tone: "critical" };
  if (repo.status === "skipped") return { text: "SKIPPED", tone: "muted" };
  const critical = repo.findings.filter((finding) => finding.severity === "CRITICAL").length;
  if (critical > 0) {
    return {
      text: `${critical} CRITICAL THREAT${critical === 1 ? "" : "S"}`,
      tone: "critical",
    };
  }
  if (repo.findings.length > 0) {
    return {
      text: `${repo.findings.length} THREAT${repo.findings.length === 1 ? "" : "S"}`,
      tone: "warn",
    };
  }
  return { text: "CLEAN", tone: "clean" };
}

export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export const STRATEGY_LABEL: Record<AutoFixStrategy, string> = {
  "delete-file": "Delete file",
  "sanitize-package-json": "Strip malicious script runners",
  "sanitize-config-tail": "Remove appended payload",
  "sanitize-gitignore": "Remove cloaking rules",
  "sanitize-vscode-tasks": "Remove folder-open tasks",
  "sanitize-vscode-settings": "Turn off automatic tasks",
  "review-only": "Review only — left out of the commit",
};

export function severityRank(repo: ScannedRepo): number {
  return repo.findings.reduce((score, finding) => {
    if (finding.severity === "CRITICAL") return score + 100;
    if (finding.severity === "HIGH") return score + 10;
    return score + 1;
  }, 0);
}
