import { readFileSync, existsSync } from "node:fs";

const problems = [];
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
for (const [name, value] of Object.entries(manifest.scripts ?? {})) {
  if (/\bnode\s+["']?(?:\.\/)?api\.js\b|\b(?:curl|wget)\b[^|\n]*\|\s*(?:ba)?sh\b/i.test(value)) {
    problems.push(`Unsafe runner in package script: ${name}`);
  }
}
if (!process.argv.includes("--manifests-only")) {
  if (existsSync(new URL("../api.js", import.meta.url))) problems.push("Unexpected root api.js. Inspect it before running the project.");
  for (const file of ["postcss.config.mjs", "next.config.mjs", "tailwind.config.ts", "vitest.config.ts"]) {
    const url = new URL(`../${file}`, import.meta.url);
    if (!existsSync(url)) continue;
    const source = readFileSync(url, "utf8");
    if (/global\s*\[\s*['"]!['"]\s*\]|_0x[a-f0-9]{3,}|\beval\s*\(|\bFunction\s*\(|child_process/i.test(source)) problems.push(`Unexpected executable payload markers in ${file}`);
  }
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log("Project integrity checks passed.");
