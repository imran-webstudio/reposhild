import { getGitHubToken } from "@/lib/github/session";
import { readScan } from "@/lib/persistence/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getGitHubToken(req);
  if (!session?.login) {
    return Response.json({ error: "Sign in with GitHub to see scan history." }, { status: 401 });
  }
  const { id } = await context.params;
  try {
    const scan = await readScan(session.login, id);
    if (!scan) return Response.json({ error: "Scan not found." }, { status: 404 });
    return Response.json(scan);
  } catch (error) {
    console.error("Could not read a stored scan", error);
    return Response.json({ error: "Scan history is unavailable." }, { status: 503 });
  }
}
