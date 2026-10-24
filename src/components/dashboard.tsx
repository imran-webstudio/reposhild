"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BulkModal } from "@/components/bulk-modal";
import { LockdownBanner } from "@/components/lockdown-banner";
import { RemediationDrawer } from "@/components/remediation-drawer";
import { formatElapsed, formatWhen, repoWebUrl, statusLabel } from "@/lib/display";
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
  const [scrolled, setScrolled] = useState(false);
  const [lightTheme, setLightTheme] = useState(false);
  const [notice, setNotice] = useState<RemediationResult | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const scanAbort = useRef<AbortController | null>(null);
  const viewGeneration = useRef(0);
  const historyLoaded = useRef(false);
  const scanningRef = useRef(false);
  const arrived = useRef(new Set<string>());

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
    if (status !== "authenticated") {
      setLockdown(null);
      setRate(null);
      return;
    }
    const controller = new AbortController();
    fetch("/api/lockdown", { signal: controller.signal })
      .then((response) => response.json())
      .then((body: { lockdown?: LockdownSignal; rate?: RateLimitSnapshot | null }) => {
        if (body.lockdown) setLockdown(body.lockdown);
        if (body.rate) setRate(body.rate);
        else setRate(null);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [status]);

  useEffect(() => {
    scanningRef.current = scanning;
  }, [scanning]);

  useEffect(() => {
    if (status !== "authenticated") return;
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
  }, [status]);

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
    setLightTheme(document.documentElement.classList.contains("light"));
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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
    arrived.current.clear();
    setRepos(body.repos);
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
    if (status !== "authenticated") {
      if (configured === false) {
        setError("Add a GitHub OAuth app in .env.local before signing in.");
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
    arrived.current.clear();
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
          arrived.current.add(payload.repo.fullName);
          setRepos((current) => [payload.repo, ...current.filter((item) => item.fullName !== payload.repo.fullName)]);
        }
        if (event === "done") {
          const payload = data as { elapsedMs: number; rate?: RateLimitSnapshot };
          setProgress((current) => (current ? { ...current, elapsedMs: payload.elapsedMs } : current));
          if (payload.rate) setRate(payload.rate);
          void refreshHistory();
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

  const percent = progress && progress.total > 0 ? Math.min(100, (progress.scanned / progress.total) * 100) : scanning ? 8 : 0;
  const barClass = critical > 0 ? "bg-accent" : infected.length > 0 ? "bg-warn" : "bg-primary";
  const cleanCount = repos.filter((repo) => repo.status === "clean").length;
  const orgCount = repos.filter((repo) => repo.isOrg).length;

  return (
    <div className="min-h-screen text-bone">
      <header
        className={`sticky top-0 z-30 border-b border-line backdrop-blur-md ${scrolled ? "bg-[var(--nav-bg-scroll)]" : "bg-[var(--nav-bg)]"}`}
      >
        <div className="mx-auto flex min-h-14 max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <Shield />
            <div className="min-w-0">
              <p className="font-display text-[1.05rem] font-semibold tracking-tight">
                Repo<span className="text-primary">Shield</span>
              </p>
              <p className="truncate text-xs text-mist">Supply-chain scan, no clone</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => {
                const next = !document.documentElement.classList.contains("light");
                document.documentElement.classList.toggle("dark", !next);
                document.documentElement.classList.toggle("light", next);
                localStorage.setItem("reposhild-theme", next ? "light" : "dark");
                setLightTheme(next);
              }}
              className="btn-quiet"
              aria-label={lightTheme ? "Switch to dark theme" : "Switch to light theme"}
            >
              {lightTheme ? "Dark" : "Light"}
            </button>
            <Account login={login} status={status} />
            <button
              type="button"
              data-testid="scan-button"
              onClick={() => void scan()}
              disabled={scanning}
              className="btn-primary"
            >
              {scanning ? "Scanning…" : "Scan all repos"}
            </button>
          </div>
        </div>
      </header>
      {lockdown && <LockdownBanner signal={lockdown} />}

      <main className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-4 sm:px-6">
        <section aria-label="Scan metrics" className="pane grid grid-cols-2 overflow-hidden rounded-2xl sm:grid-cols-4 sm:divide-x sm:divide-white/10">
          <Metric label="Repositories" value={String(repos.length)} hint={scanning ? "In progress" : progress ? "Latest view" : "No scan yet"} />
          <Metric
            label="Infected"
            value={String(infected.length)}
            hint={infected.length > 0 ? "Needs review" : "None found"}
            tone={infected.length > 0 ? "warn" : "primary"}
          />
          <Metric
            label="Critical"
            value={String(critical)}
            hint={critical > 0 ? "Highest severity" : "None found"}
            tone={critical > 0 ? "accent" : "primary"}
          />
          <Metric
            label="Elapsed"
            value={progress ? formatElapsed(progress.elapsedMs) : "—"}
            hint={progress ? `${progress.scanned} of ${progress.total}` : "Waiting"}
          />
        </section>

        <section aria-label="Scan progress" className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p data-testid="scan-progress" className="font-mono text-xs text-mist" aria-live="polite">
              {progress
                ? `Scanned ${progress.scanned} / ${progress.total} repos (${formatElapsed(progress.elapsedMs)})`
                : "Idle. Trees and text blobs only. Repositories are never cloned."}
            </p>
            <RateGauge rate={rate} />
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            aria-label="Scan progress"
          >
            <div className={`h-full motion-safe:transition-[width] motion-safe:duration-300 ${barClass}`} style={{ width: `${percent}%` }} />
          </div>
        </section>

        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="glass flex flex-wrap gap-1 rounded-full p-1" role="group" aria-label="Repository filters">
              <Pill label="All" count={repos.length} active={filter === "all"} onClick={() => setFilter("all")} />
              <Pill label="Infected" count={infected.length} active={filter === "infected"} onClick={() => setFilter("infected")} />
              <Pill label="Clean" count={cleanCount} active={filter === "clean"} onClick={() => setFilter("clean")} />
              <Pill label="Org" count={orgCount} active={filter === "org"} onClick={() => setFilter("org")} />
            </div>
            <label className="relative block min-w-[12rem] flex-1 sm:flex-none">
              <SearchIcon />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter repositories"
                aria-label="Filter repositories"
                className="field w-full pl-8 sm:w-56"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {history.length > 0 && (
              <label className="flex items-center gap-2 text-xs text-mist">
                History
                <select
                  data-testid="scan-history"
                  aria-label="Scan history"
                  value={scanId ?? history[0]?.id ?? ""}
                  disabled={scanning}
                  onChange={(event) => void loadScan(event.target.value)}
                  className="field max-w-[16rem] cursor-pointer font-mono text-xs disabled:cursor-not-allowed"
                >
                  {history.map((item) => (
                    <option key={item.id} value={item.id}>
                      {formatWhen(item.startedAt)} · {item.infectedCount} infected · {item.repoScanned}/{item.repoTotal}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {cleanups[0] && (
              <a
                href={cleanups[0].prUrl || cleanups[0].commitUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-8 cursor-pointer items-center rounded-md px-2 font-mono text-xs text-primary transition-colors duration-200 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Last cleanup {cleanups[0].fullName}
              </a>
            )}
            <button
              type="button"
              data-testid="clean-selected"
              disabled={selectedRepos.length === 0 || scanning}
              onClick={() => {
                setActiveName(null);
                setBulkOpen(true);
              }}
              className="btn-danger"
            >
              Clean selected ({selectedRepos.length})
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-sm text-bone">
            {error}
          </p>
        )}

        {repos.length === 0 ? (
          <Empty
            scanning={scanning}
            signedIn={status === "authenticated"}
            databaseConfigured={databaseConfigured}
            onScan={() => void scan()}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-separate border-spacing-y-2 text-left">
              <thead className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Select all infected repositories"
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                      className="cursor-pointer disabled:cursor-not-allowed"
                    />
                  </th>
                  <th className="px-3 py-2">Repository</th>
                  <th className="px-3 py-2">Last push</th>
                  <th className="px-3 py-2">Scan</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visible.map((repo) => {
                  const badge = statusLabel(repo);
                  return (
                    <tr
                      key={repo.fullName}
                      data-testid={`repo-${repo.name}`}
                      className={`${arrived.current.has(repo.fullName) ? "row-arrive" : ""} repo-card`}
                    >
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          aria-label={`Select ${repo.fullName}`}
                          disabled={repo.status !== "infected"}
                          checked={selected.has(repo.fullName)}
                          onChange={() => toggleOne(repo.fullName)}
                          className="cursor-pointer disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`h-7 w-0.5 rounded-full ${accentBar(badge.tone)}`} aria-hidden="true" />
                          <div>
                            <a
                              href={repoWebUrl(repo)}
                              target="_blank"
                              rel="noreferrer"
                              className="repo-name rounded-sm text-sm font-medium text-bone hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                              {repo.name}
                            </a>
                            <p className="font-mono text-xs text-mist">{repo.fullName}</p>
                          </div>
                          {repo.isOrg && <Tag>Org</Tag>}
                          {repo.private && <Tag>Private</Tag>}
                          {repo.fork && <Tag>Fork</Tag>}
                          {repo.archived && <Tag>Archived</Tag>}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <p className="text-sm">{formatWhen(repo.pushedAt)}</p>
                        <p className="font-mono text-xs text-mist">
                          {repo.lastCommitter ?? "Unknown committer"}
                          {repo.lastCommitter === "supply-bot" && <span className="ml-2 text-warn">Flagged</span>}
                        </p>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-mist">{repo.durationMs} ms</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] tracking-wide ${toneClass(badge.tone)}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${accentBar(badge.tone)}`} aria-hidden="true" />
                          {badge.text}
                        </span>
                        {repo.skippedReason && <p className="mt-1 text-xs text-mist">{repo.skippedReason}</p>}
                        {repo.error && <p className="mt-1 max-w-xs text-xs text-accent">{repo.error}</p>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <a href={repoWebUrl(repo)} target="_blank" rel="noreferrer" className="btn-quiet">
                            Open repo
                          </a>
                          {repo.status === "infected" && (
                            <button
                              type="button"
                              data-testid={`review-${repo.name}`}
                              onClick={() => {
                                setBulkOpen(false);
                                setActiveName(repo.fullName);
                              }}
                              className="btn-ghost"
                            >
                              Review and clean
                            </button>
                          )}
                        </div>
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
        <p role="status" className="fixed bottom-4 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-md border border-line bg-panel px-4 py-2 text-sm text-bone shadow-drawer">
          {toast}
        </p>
      )}
      {active && (
        <RemediationDrawer
          repo={active}
          scanId={scanId}
          notice={notice}
          onClose={() => setActiveName(null)}
          onApplied={absorb}
        />
      )}
      {bulkOpen && (
        <BulkModal repos={selectedRepos} scanId={scanId} onClose={() => setBulkOpen(false)} onApplied={absorb} />
      )}
    </div>
  );
}

function Account({ login, status }: { login: string; status: string }) {
  if (status === "authenticated" && login) {
    return (
      <div className="flex items-center gap-1">
        <p className="hidden font-mono text-xs text-bone sm:block">@{login}</p>
        <button type="button" onClick={() => void signOut()} className="btn-quiet">
          Sign out
        </button>
      </div>
    );
  }
  return (
    <button type="button" onClick={() => void signIn("github")} className="btn-ghost">
      Sign in with GitHub
    </button>
  );
}

function RateGauge({ rate }: { rate: RateLimitSnapshot | null }) {
  const remaining = rate?.remaining ?? 0;
  const limit = rate?.limit ?? 5000;
  const pct = limit > 0 && rate ? Math.max(0, Math.min(100, (remaining / limit) * 100)) : 0;
  const fill = !rate ? "bg-line" : pct > 50 ? "bg-primary" : pct > 20 ? "bg-warn" : "bg-accent";
  return (
    <div className="min-w-[11rem]" data-testid="rate-gauge">
      <div className="flex items-baseline justify-between gap-3 font-mono text-[11px] text-mist">
        <span>{rate ? "API live" : "API idle"}</span>
        <span className="text-bone">
          {rate ? `${remaining.toLocaleString()} / ${limit.toLocaleString()}` : "— / 5,000"}
        </span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${fill}`} style={{ width: `${rate ? pct : 0}%` }} />
      </div>
      {rate?.resetAt && <p className="mt-1 text-right font-mono text-[10px] text-mist">Resets {formatWhen(rate.resetAt)}</p>}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone = "bone",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "bone" | "primary" | "warn" | "accent";
}) {
  const valueClass =
    tone === "accent" ? "text-accent" : tone === "warn" ? "text-warn" : tone === "primary" ? "text-primary" : "text-bone";
  return (
    <div className="bg-transparent px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">{label}</p>
      <p className={`mt-1 font-mono text-xl font-medium leading-none ${valueClass}`}>{value}</p>
      <p className="mt-1 text-xs text-mist">{hint}</p>
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
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-7 cursor-pointer rounded-full px-3 text-xs font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        active ? "bg-primary text-on" : "text-mist hover:bg-panel hover:text-bone"
      }`}
    >
      {label}
      <span className="ml-1.5 font-mono">{count}</span>
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

function Empty({
  scanning,
  signedIn,
  databaseConfigured,
  onScan,
}: {
  scanning: boolean;
  signedIn: boolean;
  databaseConfigured: boolean | null;
  onScan: () => void;
}) {
  return (
    <section className="pane rounded-2xl px-4 py-6 sm:px-6">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-mist">
        {scanning ? "Scanning" : signedIn ? "Ready to scan" : "Sign in to scan"}
      </p>
      <h2 className="mt-2 max-w-xl font-display text-2xl font-semibold tracking-tight text-bone">
        {scanning ? "Reading trees and high-risk blobs." : "Look for hijacked scripts, cloaked droppers, and folder-open tasks."}
      </h2>
      {signedIn && databaseConfigured === false && (
        <p className="mt-3 max-w-xl text-sm text-warn">
          Postgres is not configured, so finished scans will stay in this tab only. Set DATABASE_URL or start the Compose stack.
        </p>
      )}
      <ol className="mt-5 grid gap-2 text-sm text-mist md:grid-cols-3">
        <li className="glass rounded-xl px-3 py-3">
          <span className="font-mono text-[11px] text-primary">01 · Stage A</span>
          <p className="mt-1">List every personal and org repository, then read the git tree. Skip images, archives, lockfiles, build output, and blobs over 250 KB.</p>
        </li>
        <li className="glass rounded-xl px-3 py-3">
          <span className="font-mono text-[11px] text-primary">02 · Stage B</span>
          <p className="mt-1">Fetch only package manifests, config hooks, workflows, editor tasks, and suspicious scripts. One batched GraphQL query per repository.</p>
        </li>
        <li className="glass rounded-xl px-3 py-3">
          <span className="font-mono text-[11px] text-primary">03 · Stage C</span>
          <p className="mt-1">Match campaign runners and obfuscated tails. Preview the exact diff, then land the cleanup in a single commit.</p>
        </li>
      </ol>
      <button type="button" onClick={onScan} disabled={scanning} className="btn-primary mt-5">
        {scanning ? "Scanning…" : signedIn ? "Scan all repos" : "Sign in and scan"}
      </button>
    </section>
  );
}

function Shield() {
  return (
    <span className="mark">
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path
        d="M12 3 19.5 6v5.8c0 4.4-3.1 7.6-7.5 9.7C7.6 19.4 4.5 16.2 4.5 11.8V6L12 3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="M8.5 12.1 10.8 14.4 15.5 9.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
    </span>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-2 top-1.5 h-4 w-4 text-mist" aria-hidden="true">
      <circle cx="11" cy="11" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 16.5 19.5 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function accentBar(tone: "clean" | "critical" | "warn" | "muted"): string {
  if (tone === "critical") return "bg-accent";
  if (tone === "warn") return "bg-warn";
  if (tone === "clean") return "bg-primary";
  return "bg-line";
}

function toneClass(tone: "clean" | "critical" | "warn" | "muted"): string {
  if (tone === "critical") return "text-accent";
  if (tone === "warn") return "text-warn";
  if (tone === "clean") return "text-primary";
  return "text-mist";
}
