import type { Prisma } from "@prisma/client";
import { ACTIONS } from "@/lib/activity";

export function adminQuery(params: URLSearchParams, now = new Date()) {
  const q = (params.get("q") ?? "").trim().slice(0, 120);
  const view = params.get("view") === "users" ? "users" : "activity";
  const rawPage = Number(params.get("page") ?? 1);
  const page = Number.isSafeInteger(rawPage) ? Math.max(1, Math.min(rawPage, 100000)) : 1;
  const period = params.get("period") ?? "all";
  const days = ({ day: 1, week: 7, month: 30 } as Record<string, number>)[period];
  const since = days ? new Date(now.getTime() - days * 86400000) : undefined;
  const recent = new Date(now.getTime() - 7 * 86400000);
  const userWhere: Prisma.UserWhereInput = {};
  if (q) userWhere.OR = ["login", "name", "githubId"].map((key) => ({ [key]: { contains: q, mode: "insensitive" } }));
  if (since) userWhere.createdAt = { gte: since };
  const engagement = params.get("engagement");
  if (engagement === "active") userWhere.lastSeenAt = { gte: recent };
  if (engagement === "inactive") userWhere.AND = [{ OR: [{ lastSeenAt: { lt: recent } }, { lastSeenAt: null }] }];
  if (engagement === "unverified") userWhere.githubId = null;
  const activityWhere: Prisma.ActivityWhereInput = {};
  if (q) activityWhere.OR = [
    { target: { contains: q, mode: "insensitive" } },
    { user: { OR: ["login", "name", "githubId"].map((key) => ({ [key]: { contains: q, mode: "insensitive" } })) } },
  ];
  if (since) activityWhere.createdAt = { gte: since };
  const action = params.get("action");
  if (action && ACTIONS.includes(action as typeof ACTIONS[number])) activityWhere.action = action;
  const outcome = params.get("outcome");
  if (outcome && ["success", "failure", "aborted"].includes(outcome)) activityWhere.outcome = outcome;
  const userId = params.get("userId");
  if (userId && userId.length < 100) activityWhere.userId = userId;
  return { view, page, pageSize: 25, userWhere, activityWhere, recent };
}
