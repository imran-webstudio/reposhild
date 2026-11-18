"use client";

import { useMemo, useState } from "react";
import { BroomCleanup, cleanupIssuesFromFindings } from "@/components/broom-cleanup";
import { DiffView } from "@/components/diff-view";
import { repoWebUrl } from "@/lib/display";
import { planRemediation } from "@/lib/sanitizer";
import type { RemediationResult, ScannedRepo } from "@/lib/scanner/types";

export function BulkModal({
  repos,
  scanId,
  onClose,
  onApplied,
}: {
  repos: ScannedRepo[];
  scanId: string | null;
  onClose: () => void;
  onApplied: (result: RemediationResult) => void;
}) {
  const plans = useMemo(
    () => repos.map((repo) => ({ repo, changes: planRemediation(repo.files, repo.findings) })),
    [repos],
  );
  const [pending, setPending] = useState<"commit" | "pr" | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [failures, setFailures] = useState<Array<{ name: string; message: string }>>([]);
  const [finished, setFinished] = useState(0);
  const actionable = plans.filter((plan) => plan.changes.length > 0);
  const activePlan =
    actionable.find((plan) => plan.repo.fullName === cursor) ??
    (finished < actionable.length ? actionable[finished] : actionable[actionable.length - 1]);
  const activeIssues = useMemo(
    () => (activePlan ? cleanupIssuesFromFindings(activePlan.repo.findings, activePlan.changes) : []),
    [activePlan],
  );

  async function applyAll(action: "commit" | "pr") {
    setPending(action);
    setFailures([]);
    setFinished(0);
    for (const plan of actionable) {
      setCursor(plan.repo.fullName);
      try {
        const response = await fetch("/api/remediate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            owner: plan.repo.owner,
            name: plan.repo.name,
            mode: action,
            expectedHeadSha: plan.repo.headSha,
            scanId,
            cleanOtherTips: true,
          }),
        });
        const body = (await response.json()) as RemediationResult & { error?: string };
        if (!response.ok) throw new Error(body.error || "Remediation failed");
        onApplied(body);
      } catch (cause) {
        setFailures((current) => [
          ...current,
          { name: plan.repo.fullName, message: cause instanceof Error ? cause.message : "Remediation failed" },
        ]);
      } finally {
        setFinished((count) => count + 1);
      }
    }
    setCursor(null);
    setPending(null);
  }

  const percent = actionable.length > 0 ? Math.min(100, (finished / actionable.length) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close bulk clean"
        className="absolute inset-0 cursor-pointer bg-black/70 backdrop-blur-[2px]"
        disabled={pending !== null}
        onClick={() => {
          if (!pending) onClose();
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-title"
        aria-busy={pending !== null}
        className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-t-lg border border-line bg-panel shadow-drawer sm:rounded-lg"
      >
        <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${pending ? "modal-content-busy" : ""}`}>
        <header className="border-b border-line px-4 py-3">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-mist">Bulk remediation</p>
          <h2 id="bulk-title" className="mt-1 text-lg font-semibold text-bone">
            Clean {actionable.length} repositor{actionable.length === 1 ? "y" : "ies"}
          </h2>
          <p className="mt-1 text-sm text-mist">Every deletion and edit below lands in one commit per repository.</p>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {plans.map(({ repo, changes }) => (
            <section key={repo.fullName} className="rounded-md border border-line bg-ink p-3">
              <h3 className="font-mono text-sm text-bone">
                <a
                  href={repoWebUrl(repo)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-sm hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {repo.fullName}
                </a>
              </h3>
              {changes.length === 0 ? (
                <p className="mt-2 text-sm text-mist">No automatic edit.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {changes.map((change) => (
                    <div key={change.path}>
                      <p className="mb-1 font-mono text-[12px] text-mist">
                        {change.path} · {change.action}
                      </p>
                      <DiffView before={change.before} after={change.after} mode="inline" />
                    </div>
                  ))}
                </div>
              )}
            </section>
          ))}
          {failures.map((failure) => (
            <p key={failure.name} role="alert" className="text-sm text-accent">
              {failure.name}: {failure.message}
            </p>
          ))}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
          <p className="font-mono text-xs text-mist">
            {pending
              ? `Cleaning ${finished} / ${actionable.length}${cursor ? ` · ${cursor}` : ""}`
              : finished > 0
                ? `${finished} finished`
                : "Review every diff, then commit."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={onClose} disabled={pending !== null} className="btn-ghost">
              Close
            </button>
            <button
              type="button"
              data-testid="bulk-commit"
              disabled={pending !== null || actionable.length === 0}
              onClick={() => applyAll("commit")}
              className="btn-primary"
            >
              Commit fixes to default branches
            </button>
            <button
              type="button"
              disabled={pending !== null || actionable.length === 0}
              onClick={() => applyAll("pr")}
              className="btn-ghost"
            >
              Open fix PRs
            </button>
          </div>
        </footer>
        </div>
        {pending && (
          <div className="cleanup-overlay absolute inset-0 z-20 flex items-center justify-center px-6" role="status" aria-live="polite">
            <div className="glass w-full max-w-2xl rounded-2xl p-4 sm:p-6">
              <BroomCleanup
                key={cursor ?? `bulk-${finished}`}
                total={Math.max(1, activeIssues.length || activePlan?.repo.findings.length || 1)}
                removed={0}
                status="cleaning"
                label="Pollin Rider"
                issues={activeIssues}
              />
              <p className="mt-3 break-all font-mono text-xs leading-5 text-mist">
                {pending === "pr" ? "Opening fix pull requests" : "Removing malware"}
                {cursor ? ` · ${cursor} · writing one commit` : " · preparing the cleanup"}
              </p>
              <div className="mt-3">
                <div
                  className="h-1 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(percent)}
                >
                  <div
                    className="h-full bg-primary motion-safe:transition-[width] motion-safe:duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>
                <p className="mt-2 font-mono text-[11px] text-mist">
                  {finished} / {actionable.length} repositories
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
