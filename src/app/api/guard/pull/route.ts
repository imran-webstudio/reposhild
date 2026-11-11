import { isSameOriginWrite } from "@/lib/github/request-origin";
import { getGitHubToken } from "@/lib/github/session";
import { createOctokit } from "@/lib/github/scanner";
import { CleanError, publicError } from "@/lib/github/errors";
import { parsePullTarget } from "@/lib/guard/repair";
import { applyPullRepair, previewPullRepair } from "@/lib/guard/pull";
import { recordActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(req: Request) {
  if (!isSameOriginWrite(req)) return Response.json({ error: "A same-origin JSON request is required." }, { status: 403 });
  const session = await getGitHubToken(req);
  if (!session?.githubId) return Response.json({ error: "Sign in with GitHub to repair this blocked pull." }, { status: 401 });
  const body = await req.json().catch(() => null);
  const target = parsePullTarget(body);
  if (!target || !["preview", "commit", "pr"].includes(body?.action)) return Response.json({ error: "Invalid repair request. Retry the guarded pull to create a new link." }, { status: 400 });
  try {
    const octokit = createOctokit(session.token);
    const result = body.action === "preview" ? await previewPullRepair(octokit, target) : await applyPullRepair(octokit, target, body.action);
    await recordActivity(session.githubId, body.action === "preview" ? "history_viewed" : body.action === "pr" ? "fix_pr_opened" : "fix_committed", "success", `${target.owner}/${target.repo}`);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: publicError(error) }, { status: error instanceof CleanError ? error.status : 502 });
  }
}
