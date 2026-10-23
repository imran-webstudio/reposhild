"use client";

import { useMemo, useState } from "react";
import { DiffView } from "@/components/diff-view";
import { STRATEGY_LABEL } from "@/lib/display";
import { planRemediation } from "@/lib/sanitizer";
import type { RemediationResult, ScannedRepo } from "@/lib/scanner/types";

export function RemediationDrawer({
  repo,
  demo,
  notice,
  onClose,
  onApplied,
}: {
  repo: ScannedRepo;
  demo: boolean;
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
        body: JSON.stringify({ owner: repo.owner, name: repo.name, mode: action, demo }),
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
      <button aria-label="Close review" className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
        className="relative flex h-full w-full max-w-[760px] flex-col border-l border-line bg-ink shadow-drawer"
      >
        <header className="border-b border-line px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-mist">Review and clean</p>
              <h2 id="review-title" className="mt-1 font-mono text-lg text-bone">
                {repo.fullName}
              </h2>
              <p className="mt-1 text-sm text-mist">
                Default branch <span className="font-mono text-bone">{repo.defaultBranch}</span>
                {repo.warnings && repo.warnings.length > 0 ? ` · ${repo.warnings[0]}` : ""}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-md border border-line px-2 py-1 text-sm text-mist hover:text-bone"
            >
              Close
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {matched && (
            <div className="rounded-lg border border-emerald/40 bg-emerald/10 px-4 py-3 text-sm text-[#A7F3D0]">
              <p className="font-medium text-emerald">{matched.demo ? "Simulated fix" : "Fix applied"}</p>
              <p className="mt-1">{matched.message}</p>
              <p className="mt-2 font-mono text-[12px] text-bone">
                {matched.commitSha}
                {matched.commitUrl ? (
                  <>
                    {" "}
                    <a className="underline" href={matched.commitUrl} target="_blank" rel="noreferrer">
                      View commit
                    </a>
                  </>
                ) : null}
                {matched.prUrl ? (
                  <>
                    {" "}
                    <a className="underline" href={matched.prUrl} target="_blank" rel="noreferrer">
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
                <li key={finding.id} className="rounded-lg border border-line bg-panel p-3">
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
                    <p className="mt-2 text-xs text-amber">Off-screen padding removed so the hidden code is visible.</p>
                  )}
                  <pre
                    data-testid="revealed-snippet"
                    className="mt-2 overflow-x-auto rounded-md border border-line bg-[#0B0D14] p-3 font-mono text-[12px] leading-5 text-[#FCA5A5]"
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
              <div className="flex rounded-md border border-line p-0.5 text-xs">
                <button
                  className={mode === "inline" ? "rounded bg-bone px-2 py-1 text-ink" : "px-2 py-1 text-mist"}
                  onClick={() => setMode("inline")}
                >
                  Inline
                </button>
                <button
                  className={mode === "split" ? "rounded bg-bone px-2 py-1 text-ink" : "px-2 py-1 text-mist"}
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

        <footer className="border-t border-line px-5 py-4">
          <p className="font-mono text-[11px] text-mist">
            chore(security): remove malicious payload and sanitize scripts
          </p>
          <p className="mt-1 text-xs text-mist">
            {plan.length === 0
              ? "Nothing will be committed."
              : `${plan.length} file${plan.length === 1 ? "" : "s"} in one commit on ${repo.defaultBranch}.`}
            {demo ? " Demo mode does not push to GitHub." : ""}
          </p>
          {error && <p className="mt-2 text-sm text-crimson">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              data-testid="commit-fix"
              disabled={pending !== null || plan.length === 0}
              onClick={() => apply("commit")}
              className="rounded-md bg-emerald px-3 py-2 text-sm font-semibold text-ink disabled:opacity-40"
            >
              {pending === "commit" ? "Committing…" : "Commit Fix to Default Branch"}
            </button>
            <button
              data-testid="open-pr"
              disabled={pending !== null || plan.length === 0}
              onClick={() => apply("pr")}
              className="rounded-md border border-line px-3 py-2 text-sm text-bone disabled:opacity-40"
            >
              {pending === "pr" ? "Opening PR…" : "Open Fix PR"}
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
      ? "border-crimson/50 text-crimson"
      : finding === "HIGH"
        ? "border-amber/50 text-amber"
        : "border-line text-mist";
  return <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wider ${tone}`}>{finding}</span>;
}
