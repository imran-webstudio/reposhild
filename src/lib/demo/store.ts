import type { FileChange } from "@/lib/scanner/types";

const globalStore = globalThis as typeof globalThis & {
  __reposhieldDemoFixes?: Map<string, Map<string, string | null>>;
};

function overrides(): Map<string, Map<string, string | null>> {
  if (!globalStore.__reposhieldDemoFixes) {
    globalStore.__reposhieldDemoFixes = new Map();
  }
  return globalStore.__reposhieldDemoFixes;
}

export function demoFilesFor(fullName: string, files: Record<string, string>): Record<string, string> {
  const overlay = overrides().get(fullName);
  if (!overlay) return { ...files };
  const next = { ...files };
  for (const [path, content] of overlay) {
    if (content === null) delete next[path];
    else next[path] = content;
  }
  return next;
}

export function rememberDemoFix(fullName: string, changes: FileChange[]): void {
  const overlay = overrides().get(fullName) ?? new Map<string, string | null>();
  for (const change of changes) overlay.set(change.path, change.after);
  overrides().set(fullName, overlay);
}

export function resetDemoFixes(): void {
  overrides().clear();
}

export function demoFixCount(): number {
  return overrides().size;
}
