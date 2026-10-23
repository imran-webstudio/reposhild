import { isMaliciousScript, stripMaliciousScript } from "@/lib/scanner/patterns";

/**
 * Remove campaign runners from npm scripts without reprinting the file.
 * Dependencies, key order, and unrelated scripts stay byte-for-byte.
 */
export function sanitizePackageJson(source: string): string {
  let parsed: { scripts?: Record<string, unknown> };
  try {
    parsed = JSON.parse(source);
  } catch {
    return source;
  }

  const scripts = parsed.scripts;
  if (!scripts || typeof scripts !== "object") return source;

  const updates = new Map<string, string | null>();
  for (const [key, value] of Object.entries(scripts)) {
    if (typeof value !== "string" || !isMaliciousScript(value)) continue;
    const stripped = stripMaliciousScript(value);
    updates.set(key, stripped.length > 0 ? stripped : null);
  }
  if (updates.size === 0) return source;

  const crlf = source.includes("\r\n");
  const normalized = crlf ? source.replace(/\r\n/g, "\n") : source;
  const lines = normalized.split("\n");
  const next: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(\s*)"([^"]+)"\s*:\s*("(?:\\.|[^"\\])*")(\s*,?\s*)$/);
    if (!match || !updates.has(match[2])) {
      next.push(line);
      continue;
    }
    const replacement = updates.get(match[2]);
    if (replacement == null) continue;
    const comma = match[4].includes(",") ? "," : "";
    next.push(`${match[1]}"${match[2]}": ${JSON.stringify(replacement)}${comma}`);
  }

  let result = stripDanglingCommas(next.join("\n"));
  if (normalized.endsWith("\n") && !result.endsWith("\n")) result += "\n";
  if (!normalized.endsWith("\n") && result.endsWith("\n")) result = result.replace(/\n$/, "");
  return crlf ? result.replace(/\n/g, "\r\n") : result;
}

function stripDanglingCommas(source: string): string {
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*[}\]]/.test(lines[i])) continue;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (!lines[j].trim()) continue;
      lines[j] = lines[j].replace(/,(\s*)$/, "$1");
      break;
    }
  }
  return lines.join("\n");
}
