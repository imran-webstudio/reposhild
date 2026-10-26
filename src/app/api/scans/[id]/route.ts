import { recordActivity } from "@/lib/activity";
import { getGitHubToken } from "@/lib/github/session";
import { readScan } from "@/lib/persistence/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getGitHubToken(req);
  if (!session?.githubId) {
    return Response.json({ error: "Sign in with GitHub to see scan history." }, { status: 401 });
  }
  const { id } = await context.params;
  try {
    const scan = await readScan(session.githubId, id);
    if (!scan) return Response.json({ error: "Scan not found." }, { status: 404 });
    await recordActivity(session.githubId, "history_viewed", "success", id);
    return Response.json(scan, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Could not read a stored scan", error);
    return Response.json({ error: "Scan history is unavailable." }, { status: 503 });
  }
}
