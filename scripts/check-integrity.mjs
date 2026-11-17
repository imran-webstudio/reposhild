import { readFileSync, existsSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, relative } from "node:path";

const problems = [];
const projectRoot = process.env.REPOSHIELD_ROOT ? join(process.env.REPOSHIELD_ROOT) : process.cwd();
const manifestPath = join(projectRoot, "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const [name, value] of Object.entries(manifest.scripts ?? {})) {
  if (/\bnode\s+["']?(?:\.\/)?(?:api\.js|init)\b|\b(?:curl|wget)\b[^|\n]*\|\s*(?:ba)?sh\b/i.test(value)) {
    problems.push(`Unsafe runner in package script: ${name}`);
  }
}

const root = { pathname: projectRoot };
const ignored = new Set([".git", ".next", "node_modules", "coverage", "dist"]);
const sourceExtensions = /\.(?:cjs|mjs|js|jsx|ts|tsx|json|jsonc|sh|bash|ps1|bat|vbs|yml|yaml)$/i;
const knownDropper = /^(?:api\.js|init|temp_auto_push\.bat|temp_interactive_push\.bat|branch_structure\.json|pwfile\.txt|password)$/i;
const autoRepairLine = /(?:curl|wget)[^|\n]*\|\s*(?:ba)?sh|node\s+["']?(?:\.\/)?api\.js|powershell(?:\.exe)?[^\n]*-(?:enc|encodedcommand)|global\s*\[\s*["']!["']\s*\]|\beval\s*\(\s*(?:Buffer\.from|atob)/i;

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    // Known droppers may intentionally have no extension, such as a root `init` file.
    else if (knownDropper.test(entry.name) || sourceExtensions.test(entry.name)) found.push(path);
  }
  return found;
}

function localFindings() {
  const findings = [];
  for (const file of walk(root.pathname)) {
    const rel = relative(root.pathname, file);
    if (rel === "scripts/check-integrity.mjs") continue;
    // Detection rules and their fixtures intentionally contain attack strings as data.
    if (/\.test\.(?:[cm]?[jt]sx?)$/i.test(rel) || /^(?:src\/lib\/scanner|src\/lib\/sanitizer)\//.test(rel)) continue;
    let text;
    try { text = readFileSync(file, "utf8"); } catch { continue; }
    if (knownDropper.test(rel.split(/[\\/]/).at(-1) ?? "")) {
      findings.push({ file: rel, line: 1, reason: "known dropper filename", removable: true, deleteFile: true });
      continue;
    }
    text.split(/\r?\n/).forEach((line, index) => {
      if (autoRepairLine.test(line)) findings.push({ file: rel, line: index + 1, reason: "suspicious executable payload", removable: true });
    });
  }
  return findings;
}

async function confirmRepair(findings) {
  console.error("\nRepoShield blocked startup: suspicious code was found before the command could run.");
  for (const finding of findings) console.error(`  ${finding.file}:${finding.line} — ${finding.reason}`);
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question("Remove these detected payloads and continue? [y/N] ", resolve));
  rl.close();
  if (!/^y(?:es)?$/i.test(answer.trim())) return false;
  for (const finding of findings) {
    const absolute = join(root.pathname, finding.file);
    if (finding.deleteFile) { unlinkSync(absolute); continue; }
    const original = readFileSync(absolute, "utf8");
    const lines = original.split(/\r?\n/);
    lines[finding.line - 1] = "";
    writeFileSync(absolute, lines.join("\n"));
  }
  console.error("Removed detected payloads. Re-running integrity checks…");
  return true;
}

if (!process.argv.includes("--manifests-only")) {
  const findings = localFindings();
  if (findings.length) {
    const repaired = await confirmRepair(findings);
    if (!repaired) {
      console.error("Startup cancelled. Review the files above and remove or repair the code manually.");
      process.exit(1);
    }
    const remaining = localFindings();
    if (remaining.length) {
      console.error("Payloads remain after repair; refusing to start.");
      process.exit(1);
    }
  }
}

if (!process.argv.includes("--manifests-only")) {
  if (existsSync(join(root.pathname, "api.js"))) problems.push("Unexpected root api.js. Inspect it before running the project.");
  if (existsSync(join(root.pathname, "init"))) problems.push("Unexpected root init. Inspect it before running the project.");
  for (const file of ["init", "eslint.config.mjs", "postcss.config.mjs", "next.config.mjs", "tailwind.config.ts", "vitest.config.ts"]) {
    const path = join(root.pathname, file);
    if (!existsSync(path)) continue;
    const source = readFileSync(path, "utf8");
    if (/global\s*\[\s*['"]!['"]\s*\]|_0x[a-f0-9]{3,}|\beval\s*\(|\bFunction\s*\(|child_process|var\s+NX\s*[,=]|\.npm-ws/i.test(source)) problems.push(`Unexpected executable payload markers in ${file}`);
  }
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log("Project integrity checks passed.");
