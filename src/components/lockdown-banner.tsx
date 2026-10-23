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
    <section
      data-testid="lockdown-banner"
      className="border-b border-crimson/40 bg-[#2A1215] text-[#FECACA]"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-crimson">Emergency lockdown</p>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-[#FEE2E2]">{signal.summary}</p>
          {signal.demo && (
            <p className="mt-1 text-xs text-[#FCA5A5]">Simulation. This signal is not from your GitHub account.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {LINKS.map(([label, href]) => (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-crimson/50 px-3 py-1.5 text-xs font-medium text-[#FEE2E2] hover:bg-crimson/20"
            >
              {label}
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
