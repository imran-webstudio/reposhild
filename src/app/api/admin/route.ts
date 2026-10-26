import { getGitHubToken } from "@/lib/github/session";
import { isAdminGitHubId } from "@/lib/admin/access";
import { adminQuery } from "@/lib/admin/query";
import { getPrisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(req: Request) {
  const session = await getGitHubToken(req);
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401, headers });
  if (!isAdminGitHubId(session.githubId)) return Response.json({ error: "Administrator access is required." }, { status: 403, headers });
  const db = getPrisma();
  if (!db) return Response.json({ error: "The admin dashboard needs a connected database." }, { status: 503, headers });
  const { view, page, pageSize, userWhere, activityWhere, recent } = adminQuery(new URL(req.url).searchParams);
  try {
    const result = await db.$transaction(async (tx) => {
      const [users, activeUsers, scans, cleanups, total] = await Promise.all([
        tx.user.count(), tx.user.count({ where: { lastSeenAt: { gte: recent } } }),
        tx.scan.count(), tx.remediation.count(),
        view === "users" ? tx.user.count({ where: userWhere }) : tx.activity.count({ where: activityWhere }),
      ]);
      const currentPage = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
      const pagination = { take: pageSize, skip: (currentPage - 1) * pageSize };
      const userRows = view === "users" ? await tx.user.findMany({
        where: userWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...pagination,
        select: { id: true, githubId: true, login: true, name: true, createdAt: true, lastSeenAt: true,
          _count: { select: { scans: true, remediations: true, activities: true } } },
      }) : [];
      const activities = view === "activity" ? await tx.activity.findMany({
        where: activityWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], ...pagination,
        select: { id: true, action: true, outcome: true, target: true, createdAt: true,
          user: { select: { id: true, login: true, name: true, githubId: true } } },
      }) : [];
      return { overview: { users, activeUsers, scans, cleanups }, users: userRows, activities, total, page: currentPage, pageSize, refreshedAt: new Date().toISOString() };
    }, { isolationLevel: "RepeatableRead" });
    return Response.json(result, { headers });
  } catch (error) {
    console.error("Could not read admin dashboard", error);
    return Response.json({ error: "Admin data is unavailable. Check the database connection and apply pending migrations." }, { status: 503, headers });
  }
}
