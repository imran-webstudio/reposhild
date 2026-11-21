#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const packagePath = join(process.cwd(), "package.json");
if (!existsSync(packagePath)) process.exit(0);

const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
const scripts = packageJson.scripts ?? (packageJson.scripts = {});
let changed = false;

for (const lifecycle of ["dev", "start", "build"]) {
  const hook = `pre${lifecycle}`;
  if (!scripts[hook]) {
    scripts[hook] = "reposhield";
    changed = true;
  }
}

if (changed) {
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  console.log("RepoShield enabled predev, prestart, and prebuild checks.");
}
