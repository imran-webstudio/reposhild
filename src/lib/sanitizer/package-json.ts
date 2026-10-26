import { isMaliciousScript, stripMaliciousScript } from "@/lib/scanner/patterns";

/** Replace only the scripts value; leave every byte outside it untouched. */
export function sanitizePackageJson(source: string): string {
  let parsed: { scripts?: Record<string, unknown> };
  try { parsed = JSON.parse(source); } catch { return source; }
  if (!parsed || !parsed.scripts || typeof parsed.scripts !== "object" || Array.isArray(parsed.scripts)) return source;
  const scripts = { ...parsed.scripts };
  let changed = false;
  for (const [key, value] of Object.entries(scripts)) {
    if (typeof value !== "string" || !isMaliciousScript(value)) continue;
    const clean = stripMaliciousScript(value);
    if (clean) scripts[key] = clean;
    else delete scripts[key];
    changed = true;
  }
  if (!changed) return source;

  // The document was validated above. Walk JSON tokens to locate the root scripts member.
  let cursor = 0;
  const space = () => { while (/\s/.test(source[cursor] ?? "") && cursor < source.length) cursor += 1; };
  const string = () => {
    cursor += 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") cursor += 2;
      else if (source[cursor++] === '"') break;
    }
  };
  const value = (): void => {
    space();
    if (source[cursor] === '"') { string(); return; }
    const close = source[cursor] === "{" ? "}" : source[cursor] === "[" ? "]" : null;
    if (close) {
      cursor += 1;
      while (cursor < source.length && source[cursor] !== close) {
        if (/\s|,|:/.test(source[cursor])) cursor += 1;
        else value();
      }
      cursor += 1;
    } else {
      while (cursor < source.length && !/[\s,}\]]/.test(source[cursor])) cursor += 1;
    }
  };
  space(); cursor += 1; space();
  let range: { start: number; end: number; keyStart: number } | null = null;
  while (cursor < source.length && source[cursor] !== "}") {
    const keyStart = cursor;
    string();
    const key = JSON.parse(source.slice(keyStart, cursor)) as string;
    space(); cursor += 1; space();
    const start = cursor;
    value();
    if (key === "scripts") range = { start, end: cursor, keyStart };
    space(); if (source[cursor] === ",") cursor += 1; space();
  }
  if (!range) return source;
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const multiline = source.slice(range.start, range.end).includes("\n");
  const indent = source.match(/\n([\t ]+)"/)?.[1] ?? "  ";
  const lineStart = source.lastIndexOf("\n", range.keyStart) + 1;
  const leading = source.slice(lineStart, range.keyStart).match(/^[\t ]*/)?.[0] ?? "";
  const printed = multiline
    ? JSON.stringify(scripts, null, indent).split("\n").map((line, i) => i ? leading + line : line).join(newline)
    : JSON.stringify(scripts);
  return source.slice(0, range.start) + printed + source.slice(range.end);
}
