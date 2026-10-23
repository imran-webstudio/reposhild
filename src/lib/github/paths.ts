const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg",
  ".avif",
  ".bmp",
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".7z",
  ".rar",
  ".bz2",
  ".xz",
]);

const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
  "poetry.lock",
  "packages.lock.json",
]);

const SKIP_PREFIXES = ["dist/", "build/", ".next/", "node_modules/"];

export function shouldSkipBlob(path: string, size: number): boolean {
  if (size > 250_000) return true;
  const normalized = path.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  if (SKIP_PREFIXES.some((prefix) => lower === prefix.slice(0, -1) || lower.startsWith(prefix) || lower.includes(`/${prefix}`))) {
    return true;
  }
  const base = lower.slice(lower.lastIndexOf("/") + 1);
  if (LOCKFILES.has(base) || base.endsWith(".lock")) return true;
  const dot = base.lastIndexOf(".");
  if (dot >= 0 && SKIP_EXTENSIONS.has(base.slice(dot))) return true;
  return false;
}

export function isHighRiskPath(path: string, size: number): boolean {
  const normalized = path.replace(/\\/g, "/");
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  const lower = base.toLowerCase();

  if (lower === "package.json") return true;
  if (/^postcss\.config\.(js|cjs|mjs)$/i.test(base)) return true;
  if (/^next\.config\.(js|cjs|mjs|ts)$/i.test(base)) return true;
  if (/^vite\.config\.(js|cjs|mjs|ts)$/i.test(base)) return true;
  if (/^webpack\.config\.(js|cjs|mjs|ts)$/i.test(base)) return true;
  if (/^tailwind\.config\.(js|cjs|mjs|ts)$/i.test(base)) return true;
  if (normalized === ".vscode/tasks.json" || normalized === ".vscode/settings.json") return true;
  if (/^\.github\/workflows\/.+\.ya?ml$/i.test(normalized)) return true;
  if (lower === ".gitignore") return true;
  if (lower === "password" || lower === "pwfile.txt" || lower === "branch_structure.json") return true;
  if (/\.(bat|ps1|vbs)$/i.test(lower)) return true;
  if (lower === "api.js" || lower === "server.js") return true;
  if (/\.(js|cjs)$/i.test(lower) && size > 10_000) return true;
  return false;
}
