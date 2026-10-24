export function CleanupLoader({
  title,
  detail,
  done,
  total,
}: {
  title: string;
  detail: string;
  done?: number;
  total?: number;
}) {
  const percent = total && total > 0 && done != null ? Math.min(100, (done / total) * 100) : null;
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-ink/80 px-6 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="w-full max-w-sm rounded-lg border border-line bg-panel px-4 py-4 shadow-drawer">
        <div className="flex items-center gap-3">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line border-t-primary motion-reduce:animate-none" />
          <p className="text-sm font-medium text-bone">{title}</p>
        </div>
        <p className="mt-2 break-all font-mono text-xs leading-5 text-mist">{detail}</p>
        {percent != null && total != null && done != null && (
          <div className="mt-3">
            <div
              className="h-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(percent)}
            >
              <div className="h-full bg-primary motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-2 font-mono text-[11px] text-mist">
              {done} / {total} repositories
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
