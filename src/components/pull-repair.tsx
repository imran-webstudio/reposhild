"use client";

import Link from "next/link";
import { signIn, useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import { DiffView } from "@/components/diff-view";
import type { PullTarget } from "@/lib/guard/repair";
import type { PullPreview } from "@/lib/guard/pull";

type Applied = { commitUrl: string; prUrl: string | null; message: string };
export function PullRepair({ target }: { target: PullTarget | null }) {
  const { status } = useSession();
  const [preview, setPreview] = useState<PullPreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const inspect = useCallback(async (signal?: AbortSignal) => {
    if (!target) return;
    setBusy("preview");setError(null);
    try {
      const response = await fetch("/api/guard/pull", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...target, action: "preview" }), signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not inspect this branch.");
      setPreview(body);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Inspection failed.");
    } finally { if (!signal?.aborted) setBusy(null); }
  }, [target]);
  useEffect(() => {
    if (status !== "authenticated") return;
    const controller = new AbortController();void inspect(controller.signal);
    return () => controller.abort();
  }, [status, inspect]);
  async function repair(action: "commit" | "pr") {
    setBusy(action);setError(null);
    try {
      const response = await fetch("/api/guard/pull", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...target, action }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Repair failed. A protected branch may require a repair PR.");
      setApplied(body);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Repair failed."); }
    finally { setBusy(null); }
  }
  const button = "min-h-11 rounded-md border border-line px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-50";
  return <main className="mx-auto min-h-screen max-w-4xl px-5 py-8 sm:px-8 sm:py-14">
    <Link href="/" className="text-sm font-semibold text-primary focus-visible:outline focus-visible:outline-primary">RepoShield</Link>
    <header className="mb-8 mt-10 border-b border-line pb-7">
      <p className="mb-3 font-mono text-xs uppercase tracking-widest text-accent">Pull protection · repair handoff</p>
      <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">Repair the branch before pulling</h1>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-mist">Your local pull is paused. RepoShield reads the pinned GitHub revision, prepares precise payload removals, and leaves the final checkout decision to your local guard.</p>
    </header>
    {!target ? <p role="alert" className="rounded-md border border-line p-5 text-accent">This repair link is invalid. Retry the guarded pull to get a fresh link.</p> : <>
      <dl className="mb-7 grid gap-4 rounded-lg border border-line bg-panel p-5 text-sm sm:grid-cols-2">
        <div><dt className="text-mist">Repository / branch</dt><dd className="mt-1 break-all font-mono">{target.owner}/{target.repo} · {target.branch}</dd></div>
        <div><dt className="text-mist">Inspected revision</dt><dd className="mt-1 break-all font-mono text-xs">{target.head}</dd></div>
      </dl>
      {status === "loading" && <p role="status">Checking your GitHub session…</p>}
      {status === "unauthenticated" && <section className="rounded-lg border border-line p-6">
        <h2 className="text-lg font-semibold">Connect your GitHub account</h2>
        <p className="my-3 text-sm leading-6 text-mist">The link carries repository coordinates only. Source is read through your GitHub session; your local credentials and environment files are not uploaded by the CLI.</p>
        <button className={`${button} bg-primary text-ink`} onClick={() => void signIn("github", { callbackUrl: window.location.href })}>Sign in with GitHub</button>
      </section>}
      {busy && <p role="status" className="my-5 text-sm text-mist">{busy === "preview" ? "Inspecting the pinned branch…" : "Rechecking the branch and writing the repair…"}</p>}
      {error && <div role="alert" className="my-5 rounded-md border border-accent/40 p-4 text-sm text-accent"><p>{error}</p>{!preview && <button className={`${button} mt-3`} disabled={!!busy} onClick={() => void inspect()}>Retry inspection</button>}</div>}
      {applied ? <section role="status" className="rounded-lg border border-primary/40 bg-panel p-6">
        <h2 className="text-xl font-semibold">{applied.prUrl ? "Repair PR opened" : "Repair commit created"}</h2>
        <p className="my-3 text-sm leading-6 text-mist">{applied.message}</p>
        <a className="text-sm text-primary underline" href={applied.prUrl || applied.commitUrl} target="_blank" rel="noreferrer">Review on GitHub ↗</a>
        <p className="mt-5 text-sm text-mist">Return to your Git client and retry the pull. Historical commits and existing tags remain unchanged. Your CLI verifies the exact repair and scans the final snapshot.</p>
      </section> : preview && <>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">{preview.changes.length} supported file repair{preview.changes.length === 1 ? "" : "s"}</h2>
          <div className="flex flex-wrap gap-3">
            <button className={button} disabled={!!busy || !preview.changes.length || !!preview.unresolved.length} onClick={() => void repair("pr")}>{busy === "pr" ? "Opening PR…" : "Open repair PR"}</button>
            <button className={`${button} bg-primary text-ink`} disabled={!!busy || !preview.changes.length || !!preview.unresolved.length} onClick={() => void repair("commit")}>{busy === "commit" ? "Repairing…" : "Repair branch"}</button>
          </div>
        </div>
        <p className="mb-6 text-sm leading-6 text-mist">Review the removals below. Repair branch writes one cleanup commit to {target.branch}. Choose a PR when the branch requires review. RepoShield checks the branch has not changed before writing.</p>
        {preview.unresolved.length > 0 && <section className="mb-6 rounded-md border border-accent/40 p-5"><h3 className="font-semibold text-accent">Manual review required</h3><p className="mt-2 text-sm text-mist">Automatic repair is blocked until these findings are resolved.</p><ul className="mt-3 space-y-2 text-sm">{preview.unresolved.map((item, i) => <li key={i} className="break-all font-mono">{item.path}:{item.line} — {item.rule}</li>)}</ul></section>}
        {!preview.changes.length && <p className="rounded-md border border-line p-5 text-sm text-mist">No supported payload remains at this branch tip. The block may involve historical commits, a tag, or a finding that needs manual review. The CLI remains blocked until those are resolved.</p>}
        <div className="space-y-6">{preview.changes.map((change) => <section key={change.path}><h3 className="mb-2 break-all font-mono text-sm">{change.path}:{change.line}</h3><DiffView before={change.before} after={change.after} mode="inline" /></section>)}</div>
      </>}
    </>}
  </main>;
}
