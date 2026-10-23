import type { AutoFixStrategy, FileChange, Finding } from "@/lib/scanner/types";
import { sanitizeConfigSource } from "@/lib/sanitizer/config";
import { sanitizeGitignore } from "@/lib/sanitizer/gitignore";
import { sanitizePackageJson } from "@/lib/sanitizer/package-json";
import { sanitizeVscodeSettings, sanitizeVscodeTasks } from "@/lib/sanitizer/vscode";

export { sanitizeConfigSource } from "@/lib/sanitizer/config";
export { sanitizeGitignore } from "@/lib/sanitizer/gitignore";
export { sanitizePackageJson } from "@/lib/sanitizer/package-json";
export { sanitizeVscodeSettings, sanitizeVscodeTasks } from "@/lib/sanitizer/vscode";

const APPLY: Partial<Record<AutoFixStrategy, (source: string) => string>> = {
  "sanitize-package-json": sanitizePackageJson,
  "sanitize-config-tail": sanitizeConfigSource,
  "sanitize-gitignore": sanitizeGitignore,
  "sanitize-vscode-tasks": sanitizeVscodeTasks,
  "sanitize-vscode-settings": sanitizeVscodeSettings,
};

/** Build the exact edits a remediation commit would apply. */
export function planRemediation(files: Record<string, string>, findings: Finding[]): FileChange[] {
  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) {
    if (finding.strategy === "review-only") continue;
    const list = grouped.get(finding.path) ?? [];
    list.push(finding);
    grouped.set(finding.path, list);
  }

  const changes: FileChange[] = [];
  for (const [path, list] of grouped) {
    const before = files[path];
    if (before === undefined) continue;
    const strategies = unique(list.map((finding) => finding.strategy));
    const rules = unique(list.map((finding) => finding.rule));

    if (strategies.includes("delete-file")) {
      changes.push({ path, action: "delete", before, after: null, strategies, rules });
      continue;
    }

    let after = before;
    for (const strategy of strategies) {
      const apply = APPLY[strategy];
      if (apply) after = apply(after);
    }
    if (after !== before) {
      changes.push({ path, action: "modify", before, after, strategies, rules });
    }
  }

  changes.sort((a, b) => a.path.localeCompare(b.path));
  return changes;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
