import {
  basename,
  editConfigLine,
  hasCampaignObfuscation,
  HOOK_AND_RUN_KEYS,
  isConfigPath,
  isGitignoreCloak,
  isKnownDropperBasename,
  isMaliciousScript,
  isWorkflowPath,
  lineHasConfigMarker,
  lineNumberAt,
  revealLine,
} from "@/lib/scanner/patterns";
import type { Finding, Severity, AutoFixStrategy } from "@/lib/scanner/types";

function makeFinding(input: {
  severity: Severity;
  path: string;
  line: number;
  rule: string;
  ruleId: string;
  strategy: AutoFixStrategy;
  message: string;
  rawLine: string;
}): Finding {
  const { revealed, hiddenPadding } = revealLine(input.rawLine);
  const snippet = input.rawLine.length > 1800 ? `${input.rawLine.slice(0, 1800)}…` : input.rawLine;
  return {
    id: `${input.ruleId}:${input.path}:${input.line}`,
    severity: input.severity,
    path: input.path,
    line: input.line,
    rule: input.rule,
    ruleId: input.ruleId,
    strategy: input.strategy,
    message: input.message,
    snippet,
    revealed: revealed.length > 1800 ? `${revealed.slice(0, 1800)}…` : revealed,
    hiddenPadding,
  };
}

function scriptLine(source: string, key: string): number {
  const match = new RegExp(`"${key}"\\s*:`).exec(source);
  return match?.index === undefined ? 1 : lineNumberAt(source, match.index);
}

function firstLine(text: string): string {
  const idx = text.indexOf("\n");
  return idx === -1 ? text : text.slice(0, idx);
}

export function detectFile(path: string, text: string, byteSize = text.length): Finding[] {
  if (isKnownDropperBasename(path)) {
    return [
      makeFinding({
        severity: "CRITICAL",
        path,
        line: 1,
        rule: "Known dropper file",
        ruleId: "known-dropper",
        strategy: "delete-file",
        message: `${basename(path)} is a known campaign artifact and should be deleted.`,
        rawLine: firstLine(text),
      }),
    ];
  }

  const base = basename(path);
  if (base === "package.json") return detectPackageJson(path, text);
  if (isConfigPath(path)) return detectConfig(path, text);
  if (base === ".gitignore") return detectGitignore(path, text);
  if (path === ".vscode/tasks.json") return detectTasks(path, text);
  if (path === ".vscode/settings.json") return detectSettings(path, text);
  if (isWorkflowPath(path)) return detectWorkflow(path, text);
  if (/\.(?:bat|ps1|vbs)$/i.test(base)) return detectScriptDropper(path, text);
  if (isStandaloneScript(path, byteSize) && hasCampaignObfuscation(text)) {
    return [
      makeFinding({
        severity: "CRITICAL",
        path,
        line: markerLine(text),
        rule: "Obfuscated standalone dropper",
        ruleId: "obfuscated-dropper",
        strategy: "delete-file",
        message: `${base} is a standalone script with campaign obfuscation markers.`,
        rawLine: lineAt(text, markerLine(text)),
      }),
    ];
  }

  return [];
}

function isStandaloneScript(path: string, byteSize: number): boolean {
  const base = basename(path);
  if (!/\.(?:js|cjs)$/i.test(base)) return false;
  if (base === "api.js" || base === "server.js") return true;
  return byteSize > 10_000;
}

function detectPackageJson(path: string, text: string): Finding[] {
  let parsed: { scripts?: Record<string, unknown> };
  try {
    parsed = JSON.parse(text);
  } catch {
    return [
      makeFinding({
        severity: "MEDIUM",
        path,
        line: 1,
        rule: "Unreadable package.json",
        ruleId: "package-json-parse",
        strategy: "review-only",
        message: "package.json is not valid JSON, so script hooks could not be checked safely.",
        rawLine: firstLine(text),
      }),
    ];
  }

  const scripts = parsed.scripts;
  if (!scripts || typeof scripts !== "object") return [];

  const findings: Finding[] = [];
  for (const [key, value] of Object.entries(scripts)) {
    if (typeof value !== "string" || !isMaliciousScript(value)) continue;
    const watched = HOOK_AND_RUN_KEYS.has(key);
    findings.push(
      makeFinding({
        severity: watched ? "CRITICAL" : "HIGH",
        path,
        line: scriptLine(text, key),
        rule: "Package script hijacking",
        ruleId: `package-script:${key}`,
        strategy: "sanitize-package-json",
        message: `scripts.${key} chains a hidden runner. The runner will be removed and the rest of the script kept.`,
        rawLine: value,
      }),
    );
  }
  return findings;
}

function detectConfig(path: string, text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const edit = editConfigLine(line);
    if (edit.kind !== "keep") {
      findings.push(
        makeFinding({
          severity: "CRITICAL",
          path,
          line: index + 1,
          rule: "Config file tail payload",
          ruleId: "config-tail",
          strategy: "sanitize-config-tail",
          message: edit.kind === "trim"
            ? "Obfuscated code is appended after the real config statement."
            : "This line is an obfuscated payload appended to the config file.",
          rawLine: line,
        }),
      );
      return;
    }
    if (line.length > 500 && !lineHasConfigMarker(line)) {
      findings.push(
        makeFinding({
          severity: "MEDIUM",
          path,
          line: index + 1,
          rule: "Unusually long config line",
          ruleId: "config-long-line",
          strategy: "review-only",
          message: "This config line is longer than 500 characters and needs a look. It was not auto-edited.",
          rawLine: line,
        }),
      );
    }
  });
  return findings;
}

function detectGitignore(path: string, text: string): Finding[] {
  const findings: Finding[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!isGitignoreCloak(line)) return;
    findings.push(
      makeFinding({
        severity: "HIGH",
        path,
        line: index + 1,
        rule: "Malicious .gitignore cloaking",
        ruleId: "gitignore-cloak",
        strategy: "sanitize-gitignore",
        message: `This ignore rule hides ${line.trim()} from git status.`,
        rawLine: line,
      }),
    );
  });
  return findings;
}

function detectTasks(path: string, text: string): Finding[] {
  let parsed: { tasks?: Array<{ label?: string; runOn?: string; command?: string; script?: string }> };
  try {
    parsed = JSON.parse(text);
  } catch {
    return [
      makeFinding({
        severity: "MEDIUM",
        path,
        line: 1,
        rule: "Unreadable VS Code tasks",
        ruleId: "vscode-tasks-parse",
        strategy: "review-only",
        message: "tasks.json is not valid JSON.",
        rawLine: firstLine(text),
      }),
    ];
  }
  if (!Array.isArray(parsed.tasks)) return [];

  const findings: Finding[] = [];
  for (const task of parsed.tasks) {
    if (task?.runOn !== "folderOpen") continue;
    const label = task.label ?? task.command ?? task.script ?? "task";
    const at = text.indexOf('"folderOpen"');
    findings.push(
      makeFinding({
        severity: "CRITICAL",
        path,
        line: at >= 0 ? lineNumberAt(text, at) : 1,
        rule: "VS Code folder-open task",
        ruleId: `vscode-folder-open:${label}`,
        strategy: "sanitize-vscode-tasks",
        message: `Task "${label}" runs when the folder is opened. It will be removed.`,
        rawLine: task.command ?? task.script ?? "runOn: folderOpen",
      }),
    );
  }
  return findings;
}

function detectSettings(path: string, text: string): Finding[] {
  if (!/"task\.allowAutomaticTasks"\s*:\s*"on"/.test(text)) return [];
  const at = text.indexOf("task.allowAutomaticTasks");
  return [
    makeFinding({
      severity: "MEDIUM",
      path,
      line: at >= 0 ? lineNumberAt(text, at) : 1,
      rule: "Automatic tasks enabled",
      ruleId: "vscode-auto-tasks",
      strategy: "sanitize-vscode-settings",
      message: 'task.allowAutomaticTasks is "on", which lets a folder-open task run without a prompt.',
      rawLine: "task.allowAutomaticTasks: on",
    }),
  ];
}

function detectWorkflow(path: string, text: string): Finding[] {
  const suspicious =
    /\bcurl\b[^|\n]*\|\s*(?:ba)?sh\b/i.test(text) ||
    /\bwget\b[^|\n]*\|\s*(?:ba)?sh\b/i.test(text) ||
    /\bnode\s+api\.js\b/i.test(text) ||
    /\bpowershell(?:\.exe)?\b[^\n]*-(?:enc|encodedcommand)\b/i.test(text);
  if (!suspicious) return [];
  const at = text.search(/curl|wget|api\.js|powershell/i);
  return [
    makeFinding({
      severity: "HIGH",
      path,
      line: at >= 0 ? lineNumberAt(text, at) : 1,
      rule: "Workflow shell dropper",
      ruleId: "workflow-dropper",
      strategy: "review-only",
      message: "A workflow step pipes a remote script into a shell or starts api.js. Review it before changing CI.",
      rawLine: lineAt(text, at >= 0 ? lineNumberAt(text, at) : 1),
    }),
  ];
}

function detectScriptDropper(path: string, text: string): Finding[] {
  const suspicious =
    /\bcurl\b[^|\n]*\|\s*(?:ba)?sh\b/i.test(text) ||
    /\bwget\b[^|\n]*\|\s*(?:ba)?sh\b/i.test(text) ||
    /\bnode\s+api\.js\b/i.test(text) ||
    /FromBase64String/i.test(text) ||
    /\bpowershell(?:\.exe)?\b[^\n]*-(?:enc|encodedcommand)\b/i.test(text);
  if (!suspicious) return [];
  return [
    makeFinding({
      severity: "CRITICAL",
      path,
      line: 1,
      rule: "Script dropper",
      ruleId: "script-dropper",
      strategy: "delete-file",
      message: `${basename(path)} contains a shell, PowerShell, or api.js runner.`,
      rawLine: firstLine(text),
    }),
  ];
}

function markerLine(text: string): number {
  const match = text.match(/global\s*\[\s*['"]!['"]\s*\]|_0x[a-fA-F0-9]{3,}/);
  return match?.index === undefined ? 1 : lineNumberAt(text, match.index);
}

function lineAt(text: string, line: number): string {
  return text.split(/\r?\n/)[line - 1] ?? "";
}
