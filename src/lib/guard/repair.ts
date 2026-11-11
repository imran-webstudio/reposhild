import { createHash } from "node:crypto";
/** Must produce the exact same bytes as padding-tail-v1 in the Python guard. */
export const REPAIR_MARKER = "RepoShield-Repair: padding-tail-v1";
const KNOWN_TAIL_HASHES = new Set(["0a54556284424834a5acf31d8a1e89f9a110962e4b9e1ca8d713b8bda096fdfe", "2ccc5171a550509f78202054cceec2bc866f58a74adf1c865434e78ef7481b34", "905721f48f5d13ced9e88a999b5c1d758f7ed3152acc1e04549b835dc79d7fea"]);
export function repairPaddingTail(source: string): string {
  const after = source.replace(/[ \t]{50,}([^\n]*)/g, (whole, tail: string, offset: number) => {
    const body = tail.replace(/\r+$/, "");
    const knownTail = KNOWN_TAIL_HASHES.has(createHash("sha256").update(body).digest("hex"));
    if (!knownTail && (!body.includes("var NX,SX,spin,splitLane,peel;") || body.length <= 240 ||
        !/^(?:var|let|const)/.test(body) || !(body.endsWith("})(global,require);") || body.endsWith("}(global,require)})()")))) return whole;
    const prefix = source.slice(0, offset).split("\n").at(-1)?.replace(/\r+$/, "") ?? "";
    if (prefix.trim() && !/[;}]\s*$/.test(prefix)) return whole;
    return tail.endsWith("\r") ? "\r" : "";
  });
  return after;
}

export interface PullTarget { owner: string; repo: string; branch: string; head: string }
export function parsePullTarget(value: unknown): PullTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { owner, repo, branch, head } = value as Record<string, unknown>;
  if (typeof owner !== "string" || typeof repo !== "string" || !/^[A-Za-z0-9_.-]{1,100}$/.test(owner) ||
      !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || owner === "." || owner === ".." || repo === "." || repo === "..") return null;
  if (typeof branch !== "string" || !branch || branch.length > 240 || /[\x00-\x20\x7f~^:?*\[\\]/.test(branch) ||
      branch.startsWith("-") || branch.startsWith("/") || branch.endsWith("/") || branch.endsWith(".") ||
      branch.includes("..") || branch.includes("@{") || branch.includes("//") ||
      branch.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))) return null;
  if (typeof head !== "string" || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(head)) return null;
  return { owner, repo, branch, head };
}
