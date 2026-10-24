import { getGitHubToken } from "@/lib/github/session";
import { listHistory } from "@/lib/persistence/history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getGitHubToken(req);
  if (!session?.login) {
    return Response.json({ error: "Sign in with GitHub to see scan history." }, { status: 401 });
  }
  try {
    const history = await listHistory(session.login);
    return Response.json(history);
  } catch (error) {
    console.error("Could not read scan history", error);
    return Response.json({ error: "Scan history is unavailable." }, { status: 503 });
  }
}
