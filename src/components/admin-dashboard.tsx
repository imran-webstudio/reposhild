"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { AdminData } from "@/lib/admin/types";

const ACTION_LABELS: Record<string, string> = {
  sign_in: "Signed in", sign_out: "Signed out", scan_started: "Started scan", scan_finished: "Finished scan",
  history_viewed: "Viewed scan", cleanup_requested: "Requested cleanup", fix_committed: "Committed fix",
  fix_pr_opened: "Opened fix PR", cleanup_failed: "Cleanup failed",
};
const date = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "No activity recorded";
const count = (value: number) => value.toLocaleString();
const control = "field !h-10 w-full sm:w-auto";
interface Filters { view: "users" | "activity"; action: string; outcome: string; period: string; engagement: string; userId: string; }
const initial: Filters = { view: "activity", action: "", outcome: "", period: "all", engagement: "", userId: "" };

export function AdminDashboard({ login }: { login: string }) {
  const [filters, setFilters] = useState<Filters>(initial);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [selectedUser, setSelectedUser] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(query.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null);
    const params = new URLSearchParams({ ...filters, q: search, page: String(page) });
    fetch(`/api/admin?${params}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load the admin dashboard.");
        return body as AdminData;
      })
      .then((body) => { if (!controller.signal.aborted) setData(body); })
      .catch((cause) => { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : "Could not load data."); setData(null); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, search, page, refresh]);

  function change<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value })); setPage(1);
  }
  function showUser(userId: string, userLogin: string) {
    setSelectedUser(userLogin); setQuery(""); setSearch(""); setPage(1);
    setFilters({ ...initial, userId });
  }
  function clear() {
    setFilters(initial); setQuery(""); setSearch(""); setSelectedUser(""); setPage(1);
  }
  const currentPage = data?.page ?? page;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const filtered = Boolean(query || filters.action || filters.outcome || filters.period !== "all" || filters.engagement || filters.userId);

  return (
    <div className="min-h-screen text-bone">
      <header className="sticky top-0 z-30 border-b border-line bg-[var(--nav-bg)] backdrop-blur-xl">
        <nav aria-label="Admin navigation" className="mx-auto flex min-h-16 max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="font-display text-lg font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Repo<span className="text-primary">Shield</span></Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-mist sm:inline">@{login}</span>
            <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">Admin</span>
            <Link href="/" className="btn-ghost">Back to scanner</Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-8 sm:px-6">
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-primary">Administration</p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">People & activity</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-mist">See who uses RepoShield and follow their scans and cleanups.</p>
          </div>
          <div className="flex items-center gap-3">
            {data && <span className="hidden text-xs text-mist md:inline">Updated {new Date(data.refreshedAt).toLocaleTimeString()}</span>}
            <button type="button" className="btn-ghost !h-10" disabled={loading} onClick={() => setRefresh((n) => n + 1)}>{loading ? "Refreshing…" : "Refresh"}</button>
          </div>
        </section>

        <section aria-label="Project totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Total users", value: data?.overview.users, note: "All registered accounts" },
            { label: "Active users", value: data?.overview.activeUsers, note: "Activity in the last 7 days" },
            { label: "Total scans", value: data?.overview.scans, note: "All recorded scan runs" },
            { label: "Cleanups", value: data?.overview.cleanups, note: "Commits and fix PRs opened" },
          ].map((metric) => (
            <div key={metric.label} className="glass rounded-2xl p-4 sm:p-5">
              <p className="text-xs font-medium text-mist">{metric.label}</p>
              <p className="mt-3 font-display text-3xl font-semibold tabular-nums text-bone">{metric.value == null ? "—" : count(metric.value)}</p>
              <p className="mt-2 text-xs text-mist">{metric.note}</p>
            </div>
          ))}
        </section>

        <section className="glass overflow-hidden rounded-2xl" aria-labelledby="admin-results-title">
          <div className="border-b border-line p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-1 rounded-full border border-line p-1" role="group" aria-label="Admin views">
                {(["activity", "users"] as const).map((view) => (
                  <button key={view} type="button" aria-pressed={filters.view === view} onClick={() => { setPage(1); setSelectedUser(""); setFilters({ ...initial, view }); }}
                    className={`h-9 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${filters.view === view ? "bg-primary text-on" : "text-mist hover:bg-muted hover:text-bone"}`}>
                    {view === "users" ? "Users" : "Activity log"}
                  </button>
                ))}
              </div>
              <p id="admin-results-title" className="text-xs text-mist" aria-live="polite">{loading ? "Loading results…" : data ? `${count(data.total)} ${filters.view === "users" ? "users" : "actions"} found` : "Data unavailable"}</p>
            </div>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs text-mist">
                Search {filters.view === "users" ? "users" : "activity"}
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={120}
                  placeholder={filters.view === "users" ? "Name, username, or GitHub ID" : "User or repository"} className="field !h-10 !w-full" />
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-mist">{filters.view === "users" ? "Joined" : "When"}
                <select value={filters.period} onChange={(event) => change("period", event.target.value)} className={control}>
                  <option value="all">All time</option><option value="day">Last 24 hours</option><option value="week">Last 7 days</option><option value="month">Last 30 days</option>
                </select>
              </label>
              {filters.view === "activity" ? <>
                <label className="flex flex-col gap-1.5 text-xs text-mist">Action
                  <select value={filters.action} onChange={(event) => change("action", event.target.value)} className={control}>
                    <option value="">All actions</option>{Object.entries(ACTION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-xs text-mist">Outcome
                  <select value={filters.outcome} onChange={(event) => change("outcome", event.target.value)} className={control}>
                    <option value="">All outcomes</option><option value="success">Successful</option><option value="failure">Failed</option><option value="aborted">Aborted</option>
                  </select>
                </label>
              </> : <label className="flex flex-col gap-1.5 text-xs text-mist">User status
                <select value={filters.engagement} onChange={(event) => change("engagement", event.target.value)} className={control}>
                  <option value="">All users</option><option value="active">Active in last 7 days</option><option value="inactive">Inactive for 7+ days</option><option value="unverified">Unverified legacy accounts</option>
                </select>
              </label>}
              {filtered && <button className="btn-quiet !h-10" type="button" onClick={clear}>Reset filters</button>}
            </div>
            {selectedUser && filters.userId && <div className="mt-3 flex items-center gap-2 text-xs text-mist">Showing actions by <span className="text-primary">@{selectedUser}</span><button type="button" className="btn-quiet" onClick={() => { change("userId", ""); setSelectedUser(""); }}>Clear user filter</button></div>}
          </div>

          {error ? <div className="p-6" role="alert"><p className="text-sm text-accent">{error}</p><button type="button" className="btn-ghost mt-4" onClick={() => setRefresh((n) => n + 1)}>Try again</button></div> : loading ? (
            <div className="space-y-3 p-5" role="status" aria-label="Loading admin data">{[1, 2, 3, 4].map((n) => <div key={n} className="h-12 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />)}</div>
          ) : data && data.total > 0 ? (
            <div className="overflow-x-auto">
              {filters.view === "users" ? <table className="w-full min-w-[720px] text-left text-sm">
                <caption className="sr-only">Registered users matching your search and filters</caption>
                <thead className="border-b border-line text-xs text-mist"><tr>{["User", "Joined", "Last activity", "Scans", "Cleanups", "Actions"].map((label) => <th key={label} scope="col" className="px-5 py-3 font-medium">{label}</th>)}</tr></thead>
                <tbody>{data.users.map((user) => <tr key={user.id} className="border-b border-line last:border-0 hover:bg-muted/50">
                  <td className="px-5 py-4"><p className="font-medium text-bone">{user.name || user.login}</p><p className="mt-1 text-xs text-mist">@{user.login}</p>{!user.githubId && <p className="mt-1 text-xs text-warn">Unverified legacy account</p>}</td>
                  <td className="whitespace-nowrap px-5 py-4 text-xs text-mist">{date(user.createdAt)}</td><td className="whitespace-nowrap px-5 py-4 text-xs text-mist">{date(user.lastSeenAt)}</td>
                  <td className="px-5 py-4 tabular-nums">{count(user._count.scans)}</td><td className="px-5 py-4 tabular-nums">{count(user._count.remediations)}</td>
                  <td className="px-5 py-4"><button type="button" className="btn-ghost" onClick={() => showUser(user.id, user.login)}>View activity</button></td>
                </tr>)}</tbody>
              </table> : <table className="w-full min-w-[720px] text-left text-sm">
                <caption className="sr-only">Recorded user actions matching your search and filters</caption>
                <thead className="border-b border-line text-xs text-mist"><tr>{["When", "User", "Action", "Target", "Outcome"].map((label) => <th key={label} scope="col" className="px-5 py-3 font-medium">{label}</th>)}</tr></thead>
                <tbody>{data.activities.map((activity) => <tr key={activity.id} className="border-b border-line last:border-0 hover:bg-muted/50">
                  <td className="whitespace-nowrap px-5 py-4 text-xs text-mist">{date(activity.createdAt)}</td>
                  <td className="px-5 py-4"><button type="button" className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => showUser(activity.user.id, activity.user.login)}>@{activity.user.login}</button></td>
                  <td className="px-5 py-4 font-medium">{ACTION_LABELS[activity.action] ?? activity.action}</td>
                  <td className="max-w-xs break-all px-5 py-4 font-mono text-xs text-mist">{activity.target || "—"}</td>
                  <td className="px-5 py-4"><span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${activity.outcome === "success" ? "border-primary/25 bg-primary/10 text-primary" : activity.outcome === "failure" ? "border-accent/25 bg-accent/10 text-accent" : "border-warn/25 bg-warn/10 text-warn"}`}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />{activity.outcome === "success" ? "Successful" : activity.outcome === "failure" ? "Failed" : "Aborted"}</span></td>
                </tr>)}</tbody>
              </table>}
            </div>
          ) : <div className="px-5 py-14 text-center"><h2 className="font-display text-lg font-medium">{filtered ? "No results match these filters" : filters.view === "users" ? "No users yet" : "No activity yet"}</h2><p className="mt-2 text-sm text-mist">{filtered ? "Try another search or reset your filters." : "Sign-ins, scans, history views, and cleanup actions will appear here as people use the project."}</p>{filtered && <button type="button" className="btn-ghost mt-4" onClick={clear}>Reset filters</button>}</div>}

          {data && data.total > 0 && <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
            <p className="text-xs text-mist">Page {currentPage} of {pages} · {data.pageSize} per page</p>
            <div className="flex gap-2"><button type="button" disabled={loading || currentPage <= 1} className="btn-ghost" onClick={() => setPage(currentPage - 1)}>Previous</button><button type="button" disabled={loading || currentPage >= pages} className="btn-ghost" onClick={() => setPage(currentPage + 1)}>Next</button></div>
          </footer>}
        </section>
        <p className="text-xs leading-5 text-mist">Activity records show sign-ins, scans, history views, and cleanup requests and outcomes. Earlier scans and cleanups are included; earlier sign-ins and failed attempts were not recorded.</p>
      </main>
    </div>
  );
}
