import { remediateDemo } from "@/lib/demo/remediate";
import { CleanError, publicError } from "@/lib/github/errors";
import { remediateRepository } from "@/lib/github/remediate";
import { createOctokit } from "@/lib/github/scanner";
import { getGitHubToken } from "@/lib/github/session";
import { recordRemediation } from "@/lib/persistence/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NAME = /^[A-Za-z0-9_.-]+$/;

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      owner?: string;
      name?: string;
      mode?: string;
      demo?: boolean;
      scanId?: string | null;
    };
    const owner = body.owner ?? "";
    const name = body.name ?? "";
    const mode = body.mode === "pr" ? "pr" : "commit";
    const demo = body.demo !== false;
    if (!NAME.test(owner) || !NAME.test(name)) {
      return Response.json({ error: "Invalid repository." }, { status: 400 });
    }

    if (demo) {
      return Response.json(remediateDemo(owner, name, mode));
    }

    const session = await getGitHubToken(req);
    if (!session) {
      return Response.json({ error: "Sign in with GitHub before cleaning a repository." }, { status: 401 });
    }
    const octokit = createOctokit(session.token);
    const result = await remediateRepository(octokit, owner, name, mode);
    const scanId = typeof body.scanId === "string" && body.scanId.length > 0 ? body.scanId : null;
    try {
      await recordRemediation(session.login, scanId, result);
    } catch (error) {
      console.error("Could not store the cleanup", error);
    }
    return Response.json(result);
  } catch (error) {
    const status = error instanceof CleanError ? error.status : 500;
    return Response.json({ error: publicError(error) }, { status });
  }
}
