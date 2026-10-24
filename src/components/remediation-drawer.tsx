"use client";

import { useMemo, useState } from "react";
import { CleanupLoader } from "@/components/cleanup-loader";
import { DiffView } from "@/components/diff-view";
import { STRATEGY_LABEL } from "@/lib/display";
import { planRemediation } from "@/lib/sanitizer";
import type { RemediationResult, ScannedRepo } from "@/lib/scanner/types";

export function RemediationDrawer({
  repo,
  scanId,
  notice,
  onClose,
  onApplied,
}: {
  repo: ScannedRepo;
  scanId: string | null;
  notice: RemediationResult | null;
  onClose: () => void;
  onApplied: (result: RemediationResult) => void;
}) {
  const plan = useMemo(() => planRemediation(repo.files, repo.findings), [repo]);
  const [mode, setMode] = useState<"inline" | "split">("inline");
  const [pending, setPending] = useState<"commit" | "pr" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const matched = notice && notice.owner === repo.owner && notice.name === repo.name ? notice : null;

  async function apply(action: "commit" | "pr") {
    setPending(action);
    setError(null);
    try {
      const response = await fetch("/api/remediate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: repo.owner, name: repo.name, mode: action, scanId }),
      });
      const body = (await response.json()) as RemediationResult & { error?: string };
      if (!response.ok) throw new Error(body.error || "Remediation failed");
      onApplied(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Remediation failed");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="Close review"
        className="absolute inset-0 cursor-pointer bg-black/70 backdrop-blur-[2px]"
        disabled={pending !== null}
        onClick={() => {
          if (!pending) onClose();
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        aria-busy={pending !== null}
        className="relative flex h-full w-full max-w-[760px] flex-col border-l border-line bg-panel shadow-drawer"
      >
        {pending && (
          <CleanupLoader
            title={pending === "pr" ? "Opening a fix pull request" : "Removing malware"}
            detail={`${repo.fullName} · writing one commit`}
          />
        )}
        <header className="border-b border-line px-4 py-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-mist">Review and clean</p>
              <h2 id="review-title" className="mt-1 font-mono text-lg font-medium text-bone">
                {repo.fullName}
              </h2>
              <p className="mt-1 text-sm text-mist">
                Default branch <span className="font-mono text-bone">{repo.defaultBranch}</span>
                {repo.warnings && repo.warnings.length > 0 ? ` · ${repo.warnings[0]}` : ""}
              </p>
            </div>
            <button type="button" onClick={onClose} disabled={pending !== null} className="btn-ghost">
              Close
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {matched && (
            <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-3 text-sm text-bone">
              <p className="font-medium text-primary">Fix applied</p>
              <p className="mt-1">{matched.message}</p>
              <p className="mt-2 font-mono text-[12px] text-bone">
                {matched.commitSha}
                {matched.commitUrl ? (
                  <>
                    {" "}
                    <a className="rounded-sm text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" href={matched.commitUrl} target="_blank" rel="noreferrer">
                      View commit
                    </a>
                  </>
                ) : null}
                {matched.prUrl ? (
                  <>
                    {" "}
                    <a className="rounded-sm text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" href={matched.prUrl} target="_blank" rel="noreferrer">
                      View pull request
                    </a>
                  </>
                ) : null}
              </p>
            </div>
          )}

          <section>
            <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-mist">Threats</h3>
            <ul className="mt-3 space-y-3">
              {repo.findings.map((finding) => (
                <li key={finding.id} className="rounded-md border border-line bg-ink p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Severity finding={finding.severity} />
                    <span className="text-sm text-bone">{finding.rule}</span>
                  </div>
                  <p className="mt-2 font-mono text-[12px] text-mist">
                    {finding.path}:{finding.line}
                  </p>
                  <p className="mt-2 text-sm leading-5 text-bone/90">{finding.message}</p>
                  <p className="mt-2 text-xs text-mist">{STRATEGY_LABEL[finding.strategy]}</p>
                  {finding.hiddenPadding && (
                    <p className="mt-2 text-xs text-warn">Off-screen padding removed so the hidden code is visible.</p>
                  )}
                  <pre
                    data-testid="revealed-snippet"
                    className="mt-2 overflow-x-auto rounded-md border border-line bg-ink p-3 font-mono text-xs leading-5 text-accent"
                  >
                    {(finding.hiddenPadding ? finding.revealed : finding.snippet).slice(0, 700)}
                  </pre>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-medium uppercase tracking-[0.14em] text-mist">Proposed diff</h3>
              <div className="flex rounded-md border border-line bg-muted p-0.5 text-xs" role="group" aria-label="Diff layout">
                <button
                  type="button"
                  aria-pressed={mode === "inline"}
                  className={`cursor-pointer rounded px-2 py-1 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${mode === "inline" ? "bg-primary text-on" : "text-mist hover:text-bone"}`}
                  onClick={() => setMode("inline")}
                >
                  Inline
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "split"}
                  className={`cursor-pointer rounded px-2 py-1 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${mode === "split" ? "bg-primary text-on" : "text-mist hover:text-bone"}`}
                  onClick={() => setMode("split")}
                >
                  Side by side
                </button>
              </div>
            </div>
            {plan.length === 0 ? (
              <p className="mt-3 text-sm text-mist">
                {repo.findings.length === 0
                  ? "Nothing left to change."
                  : "No automatic edit. Review-only findings stay in place."}
              </p>
            ) : (
              <div className="mt-3 space-y-4">
                {plan.map((change) => (
                  <div key={change.path}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="font-mono text-[12px] text-bone">{change.path}</p>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-mist">
                        {change.action === "delete" ? "Delete" : "Modify"}
                      </span>
                    </div>
                    <DiffView before={change.before} after={change.after} mode={mode} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="border-t border-line px-4 py-3">
          <p className="font-mono text-[11px] text-mist">
            chore(security): remove malicious payload and sanitize scripts
          </p>
          <p className="mt-1 text-xs text-mist">
            {plan.length === 0
              ? "Nothing will be committed."
              : `${plan.length} file${plan.length === 1 ? "" : "s"} in one commit on ${repo.defaultBranch}.`}
          </p>
          {error && (
            <p role="alert" className="mt-2 text-sm text-accent">
              {error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="commit-fix"
              disabled={pending !== null || plan.length === 0}
              onClick={() => apply("commit")}
              className="btn-primary"
            >
              {pending === "commit" ? "Committing…" : "Commit fix to default branch"}
            </button>
            <button
              type="button"
              data-testid="open-pr"
              disabled={pending !== null || plan.length === 0}
              onClick={() => apply("pr")}
              className="btn-ghost"
            >
              {pending === "pr" ? "Opening PR…" : "Open fix PR"}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function Severity({ finding }: { finding: "CRITICAL" | "HIGH" | "MEDIUM" }) {
  const tone =
    finding === "CRITICAL"
      ? "border-accent/50 text-accent"
      : finding === "HIGH"
        ? "border-warn/50 text-warn"
        : "border-line text-mist";
  return <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wider ${tone}`}>{finding}</span>;
}
