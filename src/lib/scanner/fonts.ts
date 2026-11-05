import { parseJsonc } from "@/lib/scanner/jsonc";

/** Referenced fonts above this size are reported and left in place. */
export const REFERENCED_FONT_BYTE_CAP = 2_000_000;

const FONT_EXTENSION = /\.(?:ttf|otf|woff2?|eot)$/i;

interface TaskShape {
  command?: unknown;
  script?: unknown;
  args?: unknown;
  runOn?: unknown;
  runOptions?: { runOn?: unknown };
  options?: { cwd?: unknown };
  windows?: unknown;
  osx?: unknown;
  linux?: unknown;
}

/** Workspace-relative font paths a folder-open task would execute. */
export function folderOpenFontPaths(source: string): string[] {
  let parsed: { tasks?: unknown };
  try {
    parsed = parseJsonc(source);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.tasks)) return [];
  const found = new Set<string>();
  for (const task of parsed.tasks) {
    if (!isFolderOpenTask(task)) continue;
    collectFontPaths(task, undefined, found);
  }
  return [...found].sort();
}

export function isRealFont(bytes: Uint8Array): boolean {
  if (bytes.length >= 4 && isSfnt(bytes)) return true;
  return isEot(bytes);
}

/** Text when the bytes are a script. A short note when they are some other binary. */
export function fontPreview(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const sampleEnd = Math.min(bytes.length, 8192);
  for (let index = 0; index < sampleEnd; index += 1) {
    if (bytes[index] === 0) return binaryFontNote(bytes);
  }
  const text = Buffer.from(bytes).toString("utf8");
  if (text.includes("\uFFFD")) return binaryFontNote(bytes);
  return text;
}

function isFolderOpenTask(value: unknown): value is TaskShape {
  if (!isTask(value)) return false;
  return value.runOptions?.runOn === "folderOpen" || value.runOn === "folderOpen";
}

function collectFontPaths(value: unknown, inheritedCwd: string | undefined, found: Set<string>): void {
  if (!isTask(value)) return;
  const cwd = typeof value.options?.cwd === "string" && value.options.cwd.trim() ? value.options.cwd : inheritedCwd;
  for (const token of commandTokens(value.command)) addFont(token, cwd, found);
  for (const token of commandTokens(value.script)) addFont(token, cwd, found);
  if (Array.isArray(value.args)) {
    for (const arg of value.args) {
      if (typeof arg === "string") addFont(arg, cwd, found);
    }
  }
  for (const nested of [value.windows, value.osx, value.linux]) collectFontPaths(nested, cwd, found);
}

function addFont(token: string, cwd: string | undefined, found: Set<string>): void {
  const path = resolveFontPath(token, cwd);
  if (path) found.add(path);
}

function commandTokens(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const tokens: string[] = [];
  for (const match of value.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    const token = match[1] ?? match[2] ?? match[3] ?? "";
    if (token) tokens.push(token);
  }
  return tokens;
}

function resolveFontPath(token: string, cwd?: string): string | null {
  const file = normalizePath(token);
  if (file == null) return null;
  let full = file;
  if (cwd) {
    const base = normalizePath(cwd);
    if (base == null) return null;
    const joined = base ? normalizePath(`${base}/${file}`) : file;
    if (joined == null) return null;
    full = joined;
  }
  return FONT_EXTENSION.test(full) ? full : null;
}

function normalizePath(token: string): string | null {
  let value = token.trim();
  if (!value) return null;
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\")) return null;
  value = value.replace(/\\/g, "/");
  const query = value.search(/[?#]/);
  if (query >= 0) value = value.slice(0, query);
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return null;
  if (value.startsWith("/")) value = value.slice(1);
  const stack: string[] = [];
  for (const part of value.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (stack.length === 0) return null;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}

function isTask(value: unknown): value is TaskShape {
  return Boolean(value) && typeof value === "object";
}

function isSfnt(bytes: Uint8Array): boolean {
  if (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) return true;
  return startsWith(bytes, "OTTO") || startsWith(bytes, "ttcf") || startsWith(bytes, "true") || startsWith(bytes, "typ1") || startsWith(bytes, "wOFF") || startsWith(bytes, "wOF2");
}

function isEot(bytes: Uint8Array): boolean {
  if (bytes.length < 36 || bytes[34] !== 0x4c || bytes[35] !== 0x50) return false;
  const version = bytes[8] | (bytes[9] << 8) | (bytes[10] << 16) | (bytes[11] << 24);
  return version === 0x00010000 || version === 0x00020001 || version === 0x00020002;
}

function startsWith(bytes: Uint8Array, text: string): boolean {
  if (bytes.length < text.length) return false;
  for (let index = 0; index < text.length; index += 1) {
    if (bytes[index] !== text.charCodeAt(index)) return false;
  }
  return true;
}

function binaryFontNote(bytes: Uint8Array): string {
  const header = [...bytes.subarray(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
  return `Not a font file (${bytes.length} bytes). Header: ${header}`;
}
