import { DEMO_REPOS } from "@/lib/demo/fixtures";
import { demoFilesFor, rememberDemoFix } from "@/lib/demo/store";
import { analyzeRepositoryFiles } from "@/lib/scanner/engine";
import type { RemediationResult } from "@/lib/scanner/types";
import { planRemediation } from "@/lib/sanitizer";
import { CleanError } from "@/lib/github/errors";

export const REMEDIATION_MESSAGE = "chore(security): remove malicious payload and sanitize scripts";

export function remediateDemo(owner: string, name: string, mode: "commit" | "pr"): RemediationResult {
  const demo = DEMO_REPOS.find((repo) => repo.owner === owner && repo.name === name);
  if (!demo) throw new CleanError("That demo repository is not in the fixture set.");
  const fullName = `${owner}/${name}`;
  const files = demoFilesFor(fullName, demo.files);
  const fetched = Object.entries(files).map(([path, text]) => ({ path, text, byteSize: text.length }));
  const analyzed = analyzeRepositoryFiles(fetched);
  const changes = planRemediation(analyzed.files, analyzed.findings);
  if (changes.length === 0) {
    throw new CleanError("Nothing to clean. Those findings do not have an automatic fix.");
  }
  rememberDemoFix(fullName, changes);
  const branch = mode === "pr" ? "reposhield/sanitize-demo" : demo.defaultBranch;
  return {
    owner,
    name,
    mode,
    commitSha: syntheticSha(`${fullName}:${changes.map((change) => change.path).join(",")}`),
    commitUrl: "",
    prUrl: mode === "pr" ? "" : null,
    branch,
    message:
      mode === "pr"
        ? "Simulated pull request. No GitHub repository was changed."
        : `Simulated commit on ${demo.defaultBranch}. No GitHub repository was changed.`,
    changes,
    fallbackToPr: false,
    demo: true,
  };
}

function syntheticSha(seed: string): string {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `${(hash >>> 0).toString(16).padStart(8, "0")}demo00`;
}
