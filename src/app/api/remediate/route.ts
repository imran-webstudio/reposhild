import { CleanError, publicError } from "@/lib/github/errors";
import { remediateRepository } from "@/lib/github/remediate";
import { createOctokit } from "@/lib/github/scanner";
import { getGitHubToken } from "@/lib/github/session";
import { isSameOriginWrite } from "@/lib/github/request-origin";
import { recordRemediation } from "@/lib/persistence/history";
import { recordActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NAME = /^[A-Za-z0-9_.-]+$/;

export async function POST(req: Request) {
  if (!isSameOriginWrite(req)) return Response.json({ error: "A same-origin JSON request is required." }, { status: 403 });
  const session = await getGitHubToken(req);
  if (!session?.githubId) return Response.json({ error: "Sign in with GitHub before cleaning a repository." }, { status: 401 });
  let target: string | undefined;
  try {
    const body: unknown = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid request." }, { status: 400 });
    const { owner, name, mode, scanId, expectedHeadSha } = body as Record<string, unknown>;
    if (typeof owner !== "string" || typeof name !== "string" || !NAME.test(owner) || !NAME.test(name)) {
      return Response.json({ error: "Invalid repository." }, { status: 400 });
    }
    if (mode !== "commit" && mode !== "pr") return Response.json({ error: "Invalid cleanup mode." }, { status: 400 });
    if (typeof expectedHeadSha !== "string" || !/^[a-f0-9]{40,64}$/.test(expectedHeadSha)) {
      return Response.json({ error: "Scan this repository again before cleaning so the preview can be verified." }, { status: 409 });
    }
    target = `${owner}/${name}`;
    await recordActivity(session.githubId, "cleanup_requested", "success", target);
    const result = await remediateRepository(createOctokit(session.token), owner, name, mode, expectedHeadSha);
    await recordActivity(session.githubId, result.mode === "pr" ? "fix_pr_opened" : "fix_committed", "success", target);
    try {
      await recordRemediation(session.githubId, typeof scanId === "string" && scanId.length > 0 ? scanId : null, result);
    } catch (error) { console.error("Could not store the cleanup", error); }
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    await recordActivity(session.githubId, "cleanup_failed", "failure", target);
    return Response.json({ error: publicError(error) }, { status: error instanceof CleanError ? error.status : 500 });
  }
}
