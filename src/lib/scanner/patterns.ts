/** Shared detection predicates. Pure string checks — nothing here is executed. */

const SEGMENT_SPLIT = /\s*(?:&&|;)\s*/;

export function splitScriptChain(script: string): string[] {
  return script
    .split(SEGMENT_SPLIT)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * A single `&&` / `;` segment that matches the campaign runners:
 * `node api.js`, `curl|sh`, `wget|sh`, encoded PowerShell, `cmd /c` droppers,
 * or base64 piped into a shell.
 */
export function isMaliciousSegment(segment: string): boolean {
  const value = segment.trim();
  if (!value) return false;
  if (/^node\s+['"]?(?:\.\/)?api\.js['"]?(?:\s|$)/i.test(value)) return true;
  if (/\bcurl\b[^|\n]*\|\s*(?:ba)?sh\b/i.test(value)) return true;
  if (/\bwget\b[^|\n]*\|\s*(?:ba)?sh\b/i.test(value)) return true;
  if (/\bpowershell(?:\.exe)?\b/i.test(value) && /-(?:enc|encodedcommand)\b/i.test(value)) return true;
  if (/\bpwsh\b/i.test(value) && /-(?:enc|encodedcommand)\b/i.test(value)) return true;
  if (
    /\bcmd(?:\.exe)?\s+\/c\b/i.test(value) &&
    /(curl|powershell|api\.js|certutil|bitsadmin|base64)/i.test(value)
  ) {
    return true;
  }
  if (/\bbase64\b[^|\n]*\|\s*(?:ba)?sh\b/i.test(value)) return true;
  if (/\beval\s*\(\s*(?:Buffer\.from|atob)\b/i.test(value)) return true;
  return false;
}

export function isMaliciousScript(script: string): boolean {
  return splitScriptChain(script).some(isMaliciousSegment);
}

export function stripMaliciousScript(script: string): string {
  return splitScriptChain(script)
    .filter((part) => !isMaliciousSegment(part))
    .join(" && ");
}

export const HOOK_AND_RUN_KEYS = new Set([
  "dev",
  "build",
  "start",
  "preinstall",
  "postinstall",
  "prepare",
]);

export function hasCampaignObfuscation(text: string): boolean {
  if (/global\s*\[\s*['"]!['"]\s*\]/.test(text)) return true;
  if (/_0x[a-fA-F0-9]{3,}/.test(text) && /(?:\beval\s*\(|\bFunction\s*\()/.test(text)) return true;
  return false;
}

const CONFIG_PAYLOAD =
  /global\s*\[\s*['"]!['"]\s*\]|global\s*\.\s*[A-Za-z_$][\w$]*\s*=|_0x[a-fA-F0-9]{3,}|\beval\s*\(|\bFunction\s*\(|child_process/;

export function lineHasConfigMarker(line: string): boolean {
  if (/global\s*\[\s*['"]!['"]\s*\]/.test(line)) return true;
  if (/global\s*\.\s*[A-Za-z_$][\w$]*\s*=/.test(line)) return true;
  if (/_0x[a-fA-F0-9]{3,}/.test(line)) return true;
  if (/\beval\s*\(/.test(line)) return true;
  if (/\bFunction\s*\(/.test(line)) return true;
  if (/child_process/.test(line) && /\.(?:exec|spawn)\s*\(/.test(line)) return true;
  return false;
}

export type ConfigLineEdit = { kind: "keep" } | { kind: "drop" } | { kind: "trim"; text: string };

function paddingIndex(line: string): number {
  return line.search(/[ \t]{50,}/);
}

function markerIndex(line: string): number {
  const match = line.match(CONFIG_PAYLOAD);
  return match?.index ?? -1;
}

function isStructuralConfigLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 240) return false;
  return /^(?:module\.exports|export\s|import\s|const\s|let\s|var\s|plugins\b|content\b|theme\b|tailwindcss\b|autoprefixer\b|require\(|\/{2}|\/\*|\*|\{|\}|\)|;|\]|\[)/.test(
    trimmed,
  );
}

/** Keep the real config closer (`};`, `]`, …) when a packer payload is jammed onto the same line. */
function configHead(prefix: string): string | null {
  const head = prefix.trimEnd();
  if (!head) return null;
  if (/[;{})\]]$/.test(head)) return head;
  const lead = head.match(/^(.*[;{})\]])/);
  if (lead?.[1]?.trim()) return lead[1].trimEnd();
  return null;
}

/**
 * Decide how a config line should be treated.
 * Padding-hidden or tail-appended obfuscation is removed.
 * A long line with no campaign marker is left untouched.
 */
export function editConfigLine(line: string): ConfigLineEdit {
  if (!line.trim()) return { kind: "keep" };

  const padAt = paddingIndex(line);
  if (padAt >= 0 && lineHasConfigMarker(line.slice(padAt))) {
    const head = line.slice(0, padAt).trimEnd();
    return head ? { kind: "trim", text: head } : { kind: "drop" };
  }

  if (lineHasConfigMarker(line)) {
    const at = markerIndex(line);
    if (at > 0) {
      const head = configHead(line.slice(0, at));
      if (head) return { kind: "trim", text: head };
    }
    if (!isStructuralConfigLine(line)) return { kind: "drop" };
  }

  return { kind: "keep" };
}

const CLOAK =
  /^(?:\.\/|\/)?(?:api\.js|branch_structure\.json|temp_auto_push\.bat|temp_interactive_push\.bat|pwfile\.txt|password)$/i;

export function isGitignoreCloak(line: string): boolean {
  return CLOAK.test(line.trim());
}

const DROPPER_NAMES = new Set([
  "temp_auto_push.bat",
  "temp_interactive_push.bat",
  "branch_structure.json",
  "pwfile.txt",
  "password",
]);

export function basename(path: string): string {
  const parts = path.split("/");
  return (parts[parts.length - 1] ?? "").toLowerCase();
}

export function isKnownDropperBasename(path: string): boolean {
  return DROPPER_NAMES.has(basename(path));
}

export function isConfigPath(path: string): boolean {
  return /(?:^|\/)(?:postcss\.config\.(?:js|cjs|mjs)|next\.config\.(?:js|cjs|mjs|ts)|vite\.config\.(?:js|cjs|mjs|ts)|webpack\.config\.(?:js|cjs|mjs|ts)|tailwind\.config\.(?:js|cjs|mjs|ts))$/i.test(
    path,
  );
}

export function isWorkflowPath(path: string): boolean {
  return /^\.github\/workflows\/.+\.ya?ml$/i.test(path);
}

export function lineNumberAt(source: string, index: number): number {
  if (index <= 0) return 1;
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

export function revealLine(line: string): { revealed: string; hiddenPadding: boolean } {
  const idx = line.search(/[ \t]{50,}/);
  if (idx < 0) return { revealed: line.trim(), hiddenPadding: false };
  const hidden = line.slice(idx).replace(/^[ \t]+/, "");
  if (!hidden.trim()) return { revealed: line.trim(), hiddenPadding: false };
  return { revealed: hidden.trimEnd(), hiddenPadding: true };
}
