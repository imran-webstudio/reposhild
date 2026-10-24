"use client";

import type { LockdownSignal } from "@/lib/scanner/types";

const LINKS = [
  ["Revoke PATs", "https://github.com/settings/tokens"],
  ["Revoke SSH keys", "https://github.com/settings/keys"],
  ["Revoke OAuth apps", "https://github.com/settings/applications"],
] as const;

export function LockdownBanner({ signal }: { signal: LockdownSignal }) {
  if (!signal.active) return null;
  return (
    <section data-testid="lockdown-banner" className="bg-accent/10 text-bone">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-2">
          <WarningIcon />
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-accent">Emergency lockdown</p>
            <p className="mt-1 max-w-3xl text-sm leading-5 text-bone">{signal.summary}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {LINKS.map(([label, href]) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="btn-danger"
            >
              {label}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true">
      <path d="M12 4.5 20.5 19H3.5L12 4.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M12 10v4.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="16.6" r="0.7" fill="currentColor" />
    </svg>
  );
}
