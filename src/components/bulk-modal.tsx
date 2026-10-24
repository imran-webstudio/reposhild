"use client";

import { useMemo, useState } from "react";
import { DiffView } from "@/components/diff-view";
import { planRemediation } from "@/lib/sanitizer";
import type { RemediationResult, ScannedRepo } from "@/lib/scanner/types";

export function BulkModal({
  repos,
  demo,
  scanId,
  onClose,
  onApplied,
}: {
  repos: ScannedRepo[];
  demo: boolean;
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
            demo,
            scanId,
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button aria-label="Close bulk clean" className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-title"
        className="relative flex max-h-[92vh] w-full max-w-4xl flex-col rounded-t-xl border border-line bg-ink shadow-drawer sm:rounded-xl"
      >
        <header className="border-b border-line px-5 py-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mist">Bulk remediation</p>
          <h2 id="bulk-title" className="mt-1 text-lg text-bone">
            Clean {actionable.length} repositor{actionable.length === 1 ? "y" : "ies"}
          </h2>
          <p className="mt-1 text-sm text-mist">
            Every deletion and edit below lands in one commit per repository.
            {demo ? " Demo mode does not push to GitHub." : ""}
          </p>
        </header>
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {plans.map(({ repo, changes }) => (
            <section key={repo.fullName} className="rounded-lg border border-line bg-panel p-3">
              <h3 className="font-mono text-sm text-bone">{repo.fullName}</h3>
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
            <p key={failure.name} className="text-sm text-crimson">
              {failure.name}: {failure.message}
            </p>
          ))}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
          <p className="font-mono text-[12px] text-mist">
            {pending
              ? `Cleaning ${finished} / ${actionable.length}${cursor ? ` · ${cursor}` : ""}`
              : finished > 0
                ? `${finished} finished`
                : "Review every diff, then commit."}
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={onClose} className="rounded-md border border-line px-3 py-2 text-sm text-mist">
              Close
            </button>
            <button
              data-testid="bulk-commit"
              disabled={pending !== null || actionable.length === 0}
              onClick={() => applyAll("commit")}
              className="rounded-md bg-emerald px-3 py-2 text-sm font-semibold text-ink disabled:opacity-40"
            >
              Commit fixes to default branches
            </button>
            <button
              disabled={pending !== null || actionable.length === 0}
              onClick={() => applyAll("pr")}
              className="rounded-md border border-line px-3 py-2 text-sm text-bone disabled:opacity-40"
            >
              Open fix PRs
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
