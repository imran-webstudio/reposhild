import { getPrisma } from "@/lib/db";

export const ACTIONS = ["sign_in", "sign_out", "scan_started", "scan_finished", "history_viewed", "cleanup_requested", "fix_committed", "fix_pr_opened", "cleanup_failed"] as const;
export type ActivityAction = typeof ACTIONS[number];
export type ActivityOutcome = "success" | "failure" | "aborted";

/** Store only action metadata, never access tokens, cookies, file contents, or request bodies. */
export async function recordActivity(githubId: string | null | undefined, action: ActivityAction, outcome: ActivityOutcome = "success", target?: string) {
  const db = getPrisma();
  if (!db || !githubId) return;
  try {
    const user = await db.user.findUnique({ where: { githubId }, select: { id: true } });
    if (!user) return;
    await db.$transaction([
      db.activity.create({ data: { userId: user.id, action, outcome, target: target?.slice(0, 300) ?? null } }),
      db.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } }),
    ]);
  } catch (error) {
    console.error(`Could not record activity: ${action}`, error);
  }
}
