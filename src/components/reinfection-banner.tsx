"use client";

export function ReinfectionBanner({
  repos,
  onReview,
  onDismiss,
}: {
  repos: string[];
  onReview: () => void;
  onDismiss: () => void;
}) {
  if (repos.length === 0) return null;
  return (
    <section data-testid="reinfection-banner" className="border-b border-warn/40 bg-warn/10 text-bone">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-warn">Malware returned</p>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-bone">
            {repos.length} previously cleaned repositor{repos.length === 1 ? "y shows" : "ies show"} findings
            again:{" "}
            <span className="font-mono text-xs text-mist">
              {repos.slice(0, 4).join(", ")}
              {repos.length > 4 ? ` +${repos.length - 4} more` : ""}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={onReview}>
            Review infected
          </button>
          <button type="button" className="btn-ghost" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>
    </section>
  );
}
