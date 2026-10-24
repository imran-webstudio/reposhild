"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BulkModal } from "@/components/bulk-modal";
import { LockdownBanner } from "@/components/lockdown-banner";
import { RemediationDrawer } from "@/components/remediation-drawer";
import { formatElapsed, formatWhen, severityRank, statusLabel } from "@/lib/display";
import type { RemediationSummary, ScanSummary } from "@/lib/history";
import { readSse } from "@/lib/sse";
import type { LockdownSignal, RateLimitSnapshot, RemediationResult, ScannedRepo } from "@/lib/scanner/types";

type Filter = "all" | "infected" | "clean" | "org";

interface Progress {
  scanned: number;
  total: number;
  elapsedMs: number;
}

export function Dashboard() {
  const { data: session, status } = useSession();
  const [demo, setDemo] = useState(true);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [databaseConfigured, setDatabaseConfigured] = useState<boolean | null>(null);
  const [scanId, setScanId] = useState<string | null>(null);
  const [history, setHistory] = useState<ScanSummary[]>([]);
  const [cleanups, setCleanups] = useState<RemediationSummary[]>([]);
  const [repos, setRepos] = useState<ScannedRepo[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [scanning, setScanning] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeName, setActiveName] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [rate, setRate] = useState<RateLimitSnapshot | null>(null);
  const [lockdown, setLockdown] = useState<LockdownSignal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [notice, setNotice] = useState<RemediationResult | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scanAbort = useRef<AbortController | null>(null);
  const viewGeneration = useRef(0);
  const historyLoaded = useRef(false);
  const scanningRef = useRef(false);

  const login = session?.user?.login || session?.user?.name || "";

  useEffect(() => {
    fetch("/api/setup")
      .then((response) => response.json())
      .then((body: { githubConfigured?: boolean; databaseConfigured?: boolean }) => {
        setConfigured(Boolean(body.githubConfigured));
        setDatabaseConfigured(Boolean(body.databaseConfigured));
      })
      .catch(() => setConfigured(false));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/lockdown?demo=${demo ? "1" : "0"}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((body: { lockdown?: LockdownSignal; rate?: RateLimitSnapshot | null }) => {
        if (body.lockdown) setLockdown(body.lockdown);
        if (body.rate) setRate(body.rate);
        if (!demo && !body.rate) setRate(null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [demo]);

  useEffect(() => {
    scanningRef.current = scanning;
  }, [scanning]);

  useEffect(() => {
    if (demo || status !== "authenticated") return;
    let cancelled = false;
    fetch("/api/scans")
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { scans?: ScanSummary[]; remediations?: RemediationSummary[] };
      })
      .then(async (body) => {
        if (cancelled || !body) return;
        const scans = body.scans ?? [];
        setHistory(scans);
        setCleanups(body.remediations ?? []);
        if (historyLoaded.current || scanningRef.current || scans.length === 0) return;
        historyLoaded.current = true;
        await loadScan(scans[0].id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [demo, status]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key === "Escape") {
        setActiveName(null);
        setBulkOpen(false);
      }
      if (event.key === "/" && target?.tagName !== "INPUT" && target?.tagName !== "TEXTAREA") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    document.body.style.overflow = activeName || bulkOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [activeName, bulkOpen]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return repos.filter((repo) => {
      if (filter === "infected" && repo.status !== "infected") return false;
      if (filter === "clean" && repo.status !== "clean") return false;
      if (filter === "org" && !repo.isOrg) return false;
      if (needle && !repo.fullName.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [repos, filter, query]);

  const infected = repos.filter((repo) => repo.status === "infected");
  const selectedRepos = infected.filter((repo) => selected.has(repo.fullName));
  const active = repos.find((repo) => repo.fullName === activeName) ?? null;
  const critical = repos.reduce(
    (total, repo) => total + repo.findings.filter((finding) => finding.severity === "CRITICAL").length,
    0,
  );
  const visibleInfected = visible.filter((repo) => repo.status === "infected");
  const allVisibleSelected =
    visibleInfected.length > 0 && visibleInfected.every((repo) => selected.has(repo.fullName));

  function switchDemo(next: boolean) {
    scanAbort.current?.abort();
    setDemo(next);
    setRepos([]);
    setSelected(new Set());
    setActiveName(null);
    setBulkOpen(false);
    setProgress(null);
    setError(null);
    setNotice(null);
    setScanId(null);
    if (next) {
      historyLoaded.current = false;
      setHistory([]);
      setCleanups([]);
    }
  }

  async function refreshHistory() {
    const response = await fetch("/api/scans");
    if (!response.ok) return;
    const body = (await response.json()) as { scans?: ScanSummary[]; remediations?: RemediationSummary[] };
    setHistory(body.scans ?? []);
    setCleanups(body.remediations ?? []);
  }

  async function loadScan(id: string) {
    const generation = ++viewGeneration.current;
    const response = await fetch(`/api/scans/${id}`);
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      scan?: ScanSummary;
      repos?: ScannedRepo[];
    };
    if (generation !== viewGeneration.current) return;
    if (!response.ok || !body.scan || !body.repos) {
      setError(body.error || "Could not load that scan.");
      return;
    }
    setScanId(body.scan.id);
    setRepos(sortRepos(body.repos));
    setSelected(new Set());
    setActiveName(null);
    setNotice(null);
    setError(body.scan.error);
    setProgress({
      scanned: body.scan.repoScanned,
      total: body.scan.repoTotal,
      elapsedMs: body.scan.elapsedMs ?? 0,
    });
  }

  async function scan() {
    if (!demo && status !== "authenticated") {
      if (configured === false) {
        setError("Add a GitHub OAuth app in .env.local before signing in. Demo mode still runs the full UI.");
        return;
      }
      await signIn("github");
      return;
    }

    viewGeneration.current += 1;
    scanAbort.current?.abort();
    const controller = new AbortController();
    scanAbort.current = controller;
    setScanning(true);
    setRepos([]);
    setSelected(new Set());
    setActiveName(null);
    setNotice(null);
    setError(null);
    setScanId(null);
    setProgress({ scanned: 0, total: 0, elapsedMs: 0 });

    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ demo }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Scan failed");
      }
      await readSse(response, (event, data) => {
        if (event === "start") {
          const payload = data as {
            scanId?: string | null;
            persisted?: boolean;
            total: number;
            rate?: RateLimitSnapshot;
            lockdown?: LockdownSignal;
          };
          if (payload.scanId) setScanId(payload.scanId);
          if (payload.persisted === false) {
            setToast("Postgres is not connected, so this scan will not be kept.");
          }
          setProgress({ scanned: 0, total: payload.total, elapsedMs: 0 });
          if (payload.rate) setRate(payload.rate);
          if (payload.lockdown) setLockdown(payload.lockdown);
        }
        if (event === "progress") {
          const payload = data as { scanned: number; total: number; elapsedMs: number; repo: ScannedRepo };
          setProgress({ scanned: payload.scanned, total: payload.total, elapsedMs: payload.elapsedMs });
          setRepos((current) => [...current, payload.repo]);
        }
        if (event === "done") {
          const payload = data as { elapsedMs: number; rate?: RateLimitSnapshot };
          setProgress((current) => (current ? { ...current, elapsedMs: payload.elapsedMs } : current));
          if (payload.rate) setRate(payload.rate);
          setRepos((current) => sortRepos(current));
          if (!demo) void refreshHistory();
        }
        if (event === "error") {
          const payload = data as { message?: string };
          setError(payload.message || "Scan failed");
        }
      });
    } catch (cause) {
      if ((cause as { name?: string }).name !== "AbortError") {
        setError(cause instanceof Error ? cause.message : "Scan failed");
      }
    } finally {
      setScanning(false);
    }
  }

  function toggleAll() {
    setSelected((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleInfected.forEach((repo) => next.delete(repo.fullName));
      else visibleInfected.forEach((repo) => next.add(repo.fullName));
      return next;
    });
  }

  function toggleOne(fullName: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(fullName)) next.delete(fullName);
      else next.add(fullName);
      return next;
    });
  }

  function absorb(result: RemediationResult) {
    const fullName = `${result.owner}/${result.name}`;
    setRepos((current) =>
      current.map((repo) => {
        if (repo.fullName !== fullName) return repo;
        const files = { ...repo.files };
        const changed = new Set(result.changes.map((change) => change.path));
        for (const change of result.changes) {
          if (change.action === "delete") delete files[change.path];
          else if (change.after != null) files[change.path] = change.after;
        }
        const findings = repo.findings.filter((finding) => finding.strategy === "review-only" || !changed.has(finding.path));
        return {
          ...repo,
          files,
          findings,
          status: findings.length > 0 ? "infected" : "clean",
        };
      }),
    );
    setSelected((current) => {
      const next = new Set(current);
      next.delete(fullName);
      return next;
    });
    setNotice(result);
    setToast(result.message);
  }

  async function resetDemo() {
    await fetch("/api/demo/reset", { method: "POST" });
    setRepos([]);
    setProgress(null);
    setSelected(new Set());
    setNotice(null);
    setToast("Demo fixtures restored. Scan again.");
  }

  const percent = progress && progress.total > 0 ? Math.min(100, (progress.scanned / progress.total) * 100) : scanning ? 8 : 0;
  const bar = critical > 0 ? "#EF4444" : infected.length > 0 ? "#F59E0B" : "#10B981";

  return (
    <div className="min-h-screen bg-ink text-bone">
      {lockdown && <LockdownBanner signal={lockdown} />}
      <header className="sticky top-0 z-30 border-b border-line bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Shield />
              <div>
                <p className="text-base font-semibold tracking-tight">RepoShield</p>
                <p className="text-xs text-mist">Supply-chain scan without cloning</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-5">
              <RateGauge rate={rate} />
              <Account login={login} status={status} demo={demo} />
            </div>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Pill label="All" count={repos.length} active={filter === "all"} onClick={() => setFilter("all")} />
              <Pill
                label="Infected"
                count={infected.length}
                active={filter === "infected"}
                onClick={() => setFilter("infected")}
              />
              <Pill
                label="Clean"
                count={repos.filter((repo) => repo.status === "clean").length}
                active={filter === "clean"}
                onClick={() => setFilter("clean")}
              />
              <Pill
                label="Org Repos"
                count={repos.filter((repo) => repo.isOrg).length}
                active={filter === "org"}
                onClick={() => setFilter("org")}
              />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter repositories"
                aria-label="Filter repositories"
                className="h-9 min-w-[200px] flex-1 rounded-md border border-line bg-panel px-3 text-sm text-bone outline-none placeholder:text-mist focus:border-mist sm:flex-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                data-testid="demo-toggle"
                aria-pressed={demo}
                onClick={() => switchDemo(!demo)}
                className={`h-9 rounded-md border px-3 text-sm ${demo ? "border-amber/50 text-amber" : "border-line text-mist"}`}
              >
                Demo / Simulation Mode {demo ? "On" : "Off"}
              </button>
              {demo && (
                <button onClick={resetDemo} className="h-9 rounded-md border border-line px-3 text-sm text-mist hover:text-bone">
                  Reset demo
                </button>
              )}
              <button
                data-testid="scan-button"
                onClick={() => void scan()}
                disabled={scanning}
                className="h-9 rounded-md bg-emerald px-3 text-sm font-semibold text-ink disabled:opacity-50"
              >
                {scanning ? "Scanning…" : "Scan All Repos"}
              </button>
              <button
                data-testid="clean-selected"
                disabled={selectedRepos.length === 0 || scanning}
                onClick={() => {
                  setActiveName(null);
                  setBulkOpen(true);
                }}
                className="h-9 rounded-md border border-crimson/50 px-3 text-sm text-crimson disabled:opacity-40"
              >
                Clean All Selected ({selectedRepos.length})
              </button>
            </div>
          </div>
        </div>
        <div className="border-t border-line">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
            <p data-testid="scan-progress" className="font-mono text-[12px] text-mist" aria-live="polite">
              {progress
                ? `Scanned ${progress.scanned} / ${progress.total} repos (${formatElapsed(progress.elapsedMs)})`
                : "Idle — trees and text blobs only, repositories are never cloned"}
            </p>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {!demo && history.length > 0 && (
                <label className="flex items-center gap-2 font-mono text-[12px] text-mist">
                  History
                  <select
                    data-testid="scan-history"
                    aria-label="Scan history"
                    value={scanId ?? history[0]?.id ?? ""}
                    disabled={scanning}
                    onChange={(event) => void loadScan(event.target.value)}
                    className="h-7 max-w-[280px] rounded border border-line bg-panel px-2 text-bone"
                  >
                    {history.map((scan) => (
                      <option key={scan.id} value={scan.id}>
                        {formatWhen(scan.startedAt)} · {scan.infectedCount} infected · {scan.repoScanned}/{scan.repoTotal}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {cleanups[0] && !demo && (
                <a
                  href={cleanups[0].prUrl || cleanups[0].commitUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[12px] text-emerald hover:underline"
                >
                  Last cleanup {cleanups[0].fullName}
                </a>
              )}
              <p className="hidden font-mono text-[12px] text-mist sm:block">
                {repos.length > 0 ? `${infected.length} infected · ${critical} critical` : ""}
              </p>
            </div>
          </div>
          <div className="h-0.5 bg-[#161822]">
            <div className="h-full transition-[width] duration-300" style={{ width: `${percent}%`, background: bar }} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        {error && (
          <p className="mb-4 rounded-lg border border-crimson/40 bg-[#2A1215] px-4 py-3 text-sm text-[#FECACA]">{error}</p>
        )}
        {repos.length === 0 ? (
          <Empty scanning={scanning} demo={demo} databaseConfigured={databaseConfigured} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-line bg-panel">
            <table className="w-full min-w-[880px] border-collapse text-left">
              <thead className="border-b border-line text-[11px] uppercase tracking-[0.14em] text-mist">
                <tr>
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label="Select all infected repositories"
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                    />
                  </th>
                  <th className="px-3 py-3 font-medium">Repository</th>
                  <th className="px-3 py-3 font-medium">Last push</th>
                  <th className="px-3 py-3 font-medium">Scan</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium" />
                </tr>
              </thead>
              <tbody>
                {visible.map((repo) => {
                  const badge = statusLabel(repo);
                  return (
                    <tr key={repo.fullName} data-testid={`repo-${repo.name}`} className="row-in border-b border-line/80 last:border-0">
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          aria-label={`Select ${repo.fullName}`}
                          disabled={repo.status !== "infected"}
                          checked={selected.has(repo.fullName)}
                          onChange={() => toggleOne(repo.fullName)}
                        />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`h-8 w-0.5 rounded ${accent(badge.tone)}`} />
                          <div>
                            <p className="font-medium">{repo.name}</p>
                            <p className="font-mono text-[12px] text-mist">{repo.fullName}</p>
                          </div>
                          {repo.isOrg && <Tag>Org</Tag>}
                          {repo.private && <Tag>Private</Tag>}
                          {repo.fork && <Tag>Fork</Tag>}
                          {repo.archived && <Tag>Archived</Tag>}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-sm">{formatWhen(repo.pushedAt)}</p>
                        <p className={`font-mono text-[12px] ${repo.lastCommitter === "supply-bot" ? "text-amber" : "text-mist"}`}>
                          {repo.lastCommitter ?? "Unknown committer"}
                        </p>
                      </td>
                      <td className="px-3 py-3 font-mono text-[12px] text-mist">{repo.durationMs} ms</td>
                      <td className="px-3 py-3">
                        <span className={`font-mono text-[11px] tracking-wide ${toneClass(badge.tone)}`}>{badge.text}</span>
                        {repo.skippedReason && <p className="mt-1 text-xs text-mist">{repo.skippedReason}</p>}
                        {repo.error && <p className="mt-1 max-w-xs text-xs text-crimson">{repo.error}</p>}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {repo.status === "infected" && (
                          <button
                            data-testid={`review-${repo.name}`}
                            onClick={() => {
                              setBulkOpen(false);
                              setActiveName(repo.fullName);
                            }}
                            className="rounded-md border border-line px-3 py-1.5 text-sm text-bone hover:border-mist"
                          >
                            Review & Clean
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visible.length === 0 && <p className="px-4 py-8 text-sm text-mist">No repositories match this filter.</p>}
          </div>
        )}
      </main>

      {toast && (
        <p className="fixed bottom-4 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-md border border-line bg-panel px-4 py-2 text-sm text-bone shadow-drawer">
          {toast}
        </p>
      )}
      {active && (
        <RemediationDrawer
          repo={active}
          demo={demo}
          scanId={scanId}
          notice={notice}
          onClose={() => setActiveName(null)}
          onApplied={absorb}
        />
      )}
      {bulkOpen && (
        <BulkModal repos={selectedRepos} demo={demo} scanId={scanId} onClose={() => setBulkOpen(false)} onApplied={absorb} />
      )}
    </div>
  );
}

function Account({ login, status, demo }: { login: string; status: string; demo: boolean }) {
  if (status === "authenticated" && login) {
    return (
      <div className="flex items-center gap-3">
        <p className="font-mono text-sm text-bone">@{login}</p>
        {demo && <span className="font-mono text-[10px] uppercase tracking-wider text-amber">Simulating</span>}
        <button onClick={() => void signOut()} className="text-sm text-mist hover:text-bone">
          Sign out
        </button>
      </div>
    );
  }
  return (
    <button onClick={() => void signIn("github")} className="text-sm text-mist hover:text-bone">
      Sign in with GitHub
    </button>
  );
}

function RateGauge({ rate }: { rate: RateLimitSnapshot | null }) {
  const remaining = rate?.remaining ?? 0;
  const limit = rate?.limit ?? 5000;
  const pct = limit > 0 && rate ? Math.max(0, Math.min(100, (remaining / limit) * 100)) : 0;
  const color = !rate ? "#1E2230" : pct > 50 ? "#10B981" : pct > 20 ? "#F59E0B" : "#EF4444";
  return (
    <div className="min-w-[190px]" data-testid="rate-gauge">
      <div className="flex items-baseline justify-between font-mono text-[11px] text-mist">
        <span>API</span>
        <span className="text-bone">
          {rate ? `${remaining.toLocaleString()} / ${limit.toLocaleString()}` : "— / 5,000"}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
        <div className="h-full" style={{ width: `${rate ? pct : 0}%`, background: color }} />
      </div>
      {rate?.simulated && <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-mist">Simulated</p>}
    </div>
  );
}

function Pill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-9 rounded-full border px-3 text-sm ${active ? "border-bone bg-bone text-ink" : "border-line text-mist hover:text-bone"}`}
    >
      {label}
      <span className="ml-2 font-mono text-[11px]">{count}</span>
    </button>
  );
}

function Tag({ children }: { children: string }) {
  return (
    <span className="rounded border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-mist">
      {children}
    </span>
  );
}

function sortRepos(list: ScannedRepo[]): ScannedRepo[] {
  return [...list].sort((a, b) => {
    const score = severityRank(b) - severityRank(a);
    if (score !== 0) return score;
    return a.fullName.localeCompare(b.fullName);
  });
}

function Empty({
  scanning,
  demo,
  databaseConfigured,
}: {
  scanning: boolean;
  demo: boolean;
  databaseConfigured: boolean | null;
}) {
  return (
    <section className="rounded-xl border border-line bg-panel px-6 py-10">
      <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mist">
        {scanning ? "Scanning" : demo ? "Simulation ready" : "Connected scan"}
      </p>
      <h2 className="mt-2 max-w-xl text-2xl font-semibold tracking-tight">
        {scanning ? "Reading trees and high-risk blobs." : "Look for hijacked scripts, cloaked droppers, and folder-open tasks."}
      </h2>
      {!demo && databaseConfigured === false && (
        <p className="mt-4 max-w-xl text-sm text-amber">
          Postgres is not configured, so finished scans will stay in this tab only. Set DATABASE_URL or start the Compose stack.
        </p>
      )}
      <ol className="mt-6 grid gap-3 text-sm text-mist md:grid-cols-3">
        <li className="rounded-lg border border-line px-4 py-3">
          <span className="font-mono text-[11px] text-bone">Stage A</span>
          <p className="mt-1">List every personal and org repository, then read the git tree. Skip images, archives, lockfiles, build output, and blobs over 250 KB.</p>
        </li>
        <li className="rounded-lg border border-line px-4 py-3">
          <span className="font-mono text-[11px] text-bone">Stage B</span>
          <p className="mt-1">Fetch only package manifests, config hooks, workflows, editor tasks, and suspicious scripts. One batched GraphQL query per repository.</p>
        </li>
        <li className="rounded-lg border border-line px-4 py-3">
          <span className="font-mono text-[11px] text-bone">Stage C</span>
          <p className="mt-1">Match campaign runners and obfuscated tails. Preview the exact diff, then land the cleanup in a single commit.</p>
        </li>
      </ol>
    </section>
  );
}

function Shield() {
  return (
    <svg viewBox="0 0 32 32" className="h-9 w-9 text-emerald" aria-hidden="true">
      <path
        d="M16 3.2 27.2 7.8v8.6c0 6.2-4.4 10.6-11.2 13.8C9.2 27 4.8 22.6 4.8 16.4V7.8L16 3.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M11.2 16.2 14.3 19.2 20.8 12.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function accent(tone: "clean" | "critical" | "warn" | "muted"): string {
  if (tone === "critical") return "bg-crimson";
  if (tone === "warn") return "bg-amber";
  if (tone === "clean") return "bg-emerald";
  return "bg-line";
}

function toneClass(tone: "clean" | "critical" | "warn" | "muted"): string {
  if (tone === "critical") return "text-crimson";
  if (tone === "warn") return "text-amber";
  if (tone === "clean") return "text-emerald";
  return "text-mist";
}
