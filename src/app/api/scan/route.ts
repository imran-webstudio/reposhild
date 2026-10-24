import { DEMO_LOCKDOWN, DEMO_RATE, DEMO_REPOS, scanDemo } from "@/lib/demo/fixtures";
import { isAbortError, publicError } from "@/lib/github/errors";
import { detectLockdown } from "@/lib/github/lockdown";
import { createOctokit, readRateLimit, scanRepositories } from "@/lib/github/scanner";
import { getGitHubToken, type GitHubSession } from "@/lib/github/session";
import { beginScan, finishScan, noteScanListed, saveScannedRepo } from "@/lib/persistence/history";
import type { StoredScanStatus } from "@/lib/history";
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
    return streamLive(session, req.signal);
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

function streamLive(session: GitHubSession, signal: AbortSignal) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // The browser closed the stream. The scan still finishes so history can be saved.
        }
      };
      let rate: RateLimitSnapshot | null = null;
      let scanId: string | null = null;
      let total = 0;
      let scanned = 0;
      const started = Date.now();
      try {
        const octokit = createOctokit(session.token, (next) => {
          rate = next;
        });
        const [limit, lockdown] = await Promise.all([
          readRateLimit(octokit),
          detectLockdown(session.token, session.login).catch(() => quietLockdown()),
        ]);
        rate = limit;
        scanId = await beginScan(
          {
            login: session.login,
            githubId: session.githubId,
            name: session.name,
            email: session.email,
            avatarUrl: session.avatarUrl,
          },
          {
            lockdownActive: lockdown.active,
            lockdownSummary: lockdown.summary,
            rateRemaining: limit.remaining,
            rateLimit: limit.limit,
          },
        ).catch((error) => {
          console.error("Could not open a scan record", error);
          return null;
        });
        await scanRepositories(
          octokit,
          async (update) => {
            total = update.total;
            scanned = update.scanned;
            send("progress", update);
            if (!scanId) return;
            try {
              await saveScannedRepo(scanId, update.repo);
            } catch (error) {
              console.error(`Could not store ${update.repo.fullName}`, error);
            }
          },
          signal,
          async (count) => {
            total = count;
            if (scanId) {
              try {
                await noteScanListed(scanId, count);
              } catch (error) {
                console.error("Could not store the repository count", error);
              }
            }
            send("start", { scanId, persisted: Boolean(scanId), total: count, elapsedMs: 0, rate, lockdown });
          },
        );
        const status: StoredScanStatus = signal.aborted ? "ABORTED" : "COMPLETED";
        await closeScan(scanId, status, started, rate, null);
        send("done", { scanId, scanned, total, elapsedMs: Date.now() - started, rate });
      } catch (error) {
        const aborted = isAbortError(error) || signal.aborted;
        await closeScan(scanId, aborted ? "ABORTED" : "FAILED", started, rate, aborted ? null : publicError(error));
        if (!aborted) send("error", { message: publicError(error) });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });
  return sseResponse(stream);
}

async function closeScan(
  scanId: string | null,
  status: StoredScanStatus,
  started: number,
  rate: RateLimitSnapshot | null,
  error: string | null,
) {
  if (!scanId) return;
  try {
    await finishScan(scanId, {
      status,
      elapsedMs: Date.now() - started,
      error,
      rateRemaining: rate?.remaining ?? null,
      rateLimit: rate?.limit ?? null,
    });
  } catch (cause) {
    console.error("Could not finish the scan record", cause);
  }
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
