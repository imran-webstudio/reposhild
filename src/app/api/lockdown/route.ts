import { DEMO_LOCKDOWN, DEMO_RATE } from "@/lib/demo/fixtures";
import { publicError } from "@/lib/github/errors";
import { detectLockdown } from "@/lib/github/lockdown";
import { createOctokit, readRateLimit } from "@/lib/github/scanner";
import { getGitHubToken } from "@/lib/github/session";
import type { LockdownSignal } from "@/lib/scanner/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDLE: LockdownSignal = {
  active: false,
  demo: false,
  pushCount: 0,
  repoCount: 0,
  windowMinutes: 120,
  unfamiliarCommitters: [],
  summary: "",
};

export async function GET(req: Request) {
  const demo = new URL(req.url).searchParams.get("demo") !== "0";
  if (demo) {
    return Response.json({ lockdown: DEMO_LOCKDOWN, rate: DEMO_RATE, authenticated: false });
  }

  const session = await getGitHubToken(req);
  if (!session) {
    return Response.json({ lockdown: IDLE, rate: null, authenticated: false });
  }

  try {
    const octokit = createOctokit(session.token);
    const [lockdown, rate] = await Promise.all([
      detectLockdown(session.token, session.login),
      readRateLimit(octokit),
    ]);
    return Response.json({ lockdown, rate, authenticated: true });
  } catch (error) {
    return Response.json({
      lockdown: { ...IDLE, summary: publicError(error) },
      rate: null,
      authenticated: true,
    });
  }
}
