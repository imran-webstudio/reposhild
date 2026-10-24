import { publicError } from "@/lib/github/errors";
import { detectLockdown } from "@/lib/github/lockdown";
import { createOctokit, readRateLimit } from "@/lib/github/scanner";
import { getGitHubToken } from "@/lib/github/session";
import type { LockdownSignal } from "@/lib/scanner/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IDLE: LockdownSignal = {
  active: false,
  pushCount: 0,
  repoCount: 0,
  windowMinutes: 120,
  unfamiliarCommitters: [],
  summary: "",
};

export async function GET(req: Request) {
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
