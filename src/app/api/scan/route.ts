import { DEMO_LOCKDOWN, DEMO_RATE, DEMO_REPOS, scanDemo } from "@/lib/demo/fixtures";
import { isAbortError, publicError } from "@/lib/github/errors";
import { detectLockdown } from "@/lib/github/lockdown";
import { createOctokit, readRateLimit, scanRepositories } from "@/lib/github/scanner";
import { getGitHubToken } from "@/lib/github/session";
import type { LockdownSignal, RateLimitSnapshot } from "@/lib/scanner/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { demo?: boolean };
  const demo = body.demo !== false;

  if (!demo) {
    const session = await getGitHubToken(req);
    if (!session) {
      return Response.json({ error: "Sign in with GitHub to scan your repositories." }, { status: 401 });
    }
    return streamLive(session.token, session.login, req.signal);
  }

  return streamDemo(req.signal);
}

function streamDemo(signal: AbortSignal) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      try {
        send("start", {
          total: DEMO_REPOS.length,
          elapsedMs: 0,
          rate: DEMO_RATE,
          lockdown: DEMO_LOCKDOWN,
        });
        const done = await scanDemo((update) => send("progress", update), signal);
        send("done", {
          scanned: DEMO_REPOS.length,
          total: DEMO_REPOS.length,
          elapsedMs: done.elapsedMs,
          rate: DEMO_RATE,
        });
      } catch (error) {
        if (!isAbortError(error)) send("error", { message: publicError(error) });
      } finally {
        controller.close();
      }
    },
  });
  return sseResponse(stream);
}

function streamLive(token: string, login: string, signal: AbortSignal) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      let rate: RateLimitSnapshot | null = null;
      try {
        const octokit = createOctokit(token, (next) => {
          rate = next;
        });
        const [limit, lockdown] = await Promise.all([
          readRateLimit(octokit),
          detectLockdown(token, login).catch(() => quietLockdown()),
        ]);
        rate = limit;
        let total = 0;
        let scanned = 0;
        const started = Date.now();
        await scanRepositories(
          octokit,
          (update) => {
            total = update.total;
            scanned = update.scanned;
            send("progress", update);
          },
          signal,
          (count) => {
            total = count;
            send("start", { total: count, elapsedMs: 0, rate, lockdown });
          },
        );
        send("done", { scanned, total, elapsedMs: Date.now() - started, rate });
      } catch (error) {
        if (!isAbortError(error)) send("error", { message: publicError(error) });
      } finally {
        controller.close();
      }
    },
  });
  return sseResponse(stream);
}

function quietLockdown(): LockdownSignal {
  return {
    active: false,
    demo: false,
    pushCount: 0,
    repoCount: 0,
    windowMinutes: 120,
    unfamiliarCommitters: [],
    summary: "Recent account events could not be read.",
  };
}

function sseResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
