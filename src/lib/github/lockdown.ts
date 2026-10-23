import { createOctokit } from "@/lib/github/scanner";
import type { LockdownSignal } from "@/lib/scanner/types";

const WINDOW_MS = 2 * 60 * 60 * 1000;

export async function detectLockdown(token: string, loginHint = ""): Promise<LockdownSignal> {
  const octokit = createOctokit(token);
  const me = await octokit.rest.users.getAuthenticated();
  const login = me.data.login || loginHint;
  const aliases = new Set(
    [login, me.data.name ?? ""]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  const events = await octokit.rest.activity.listEventsForAuthenticatedUser({
    username: login,
    per_page: 100,
  });

  const now = Date.now();
  const repos = new Set<string>();
  const unfamiliar = new Set<string>();
  let pushEvents = 0;
  let commitCount = 0;
  let unfamiliarCommits = 0;

  for (const event of events.data) {
    if (event.type !== "PushEvent" || !event.created_at) continue;
    const created = new Date(event.created_at).getTime();
    if (!Number.isFinite(created) || now - created > WINDOW_MS) continue;
    pushEvents += 1;
    if (event.repo?.name) repos.add(event.repo.name);

    const payload = event.payload as {
      size?: number;
      commits?: Array<{ author?: { name?: string } }>;
    };
    const commits = payload.commits ?? [];
    commitCount += payload.size ?? (commits.length || 1);

    const actor = event.actor?.login;
    if (actor && !aliases.has(actor.toLowerCase())) unfamiliar.add(actor);

    for (const commit of commits) {
      const name = commit.author?.name?.trim();
      if (!name || aliases.has(name.toLowerCase())) continue;
      unfamiliar.add(name);
      unfamiliarCommits += 1;
    }
  }

  const wave = repos.size >= 2 && (pushEvents > 20 || commitCount > 20);
  const strangerWave = unfamiliarCommits >= 10 && repos.size >= 2;
  const active = wave || strangerWave;
  const names = [...unfamiliar].slice(0, 4);
  const summary = active
    ? `${Math.max(pushEvents, commitCount)} pushes across ${repos.size} repositories in the last 2 hours${
        names.length ? `, including ${names.join(", ")}` : ""
      }.`
    : "No automated push wave in the last 2 hours.";

  return {
    active,
    demo: false,
    pushCount: Math.max(pushEvents, commitCount),
    repoCount: repos.size,
    windowMinutes: 120,
    unfamiliarCommitters: names,
    summary,
  };
}
