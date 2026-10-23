"use client";

import { diffLines, type Change } from "diff";

interface Cell {
  text: string;
  mark: " " | "+" | "-";
}

interface Pair {
  left: Cell | null;
  right: Cell | null;
}

const CAP = 400;

export function DiffView({
  before,
  after,
  mode,
}: {
  before: string;
  after: string | null;
  mode: "inline" | "split";
}) {
  const next = after ?? "";
  const parts = diffLines(before, next);
  const truncated = countLines(parts) > CAP;

  return (
    <div data-testid="diff-view" className="overflow-hidden rounded-lg border border-line bg-[#0B0D14]">
      {after == null && (
        <p className="border-b border-line px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-crimson">
          File will be deleted
        </p>
      )}
      {mode === "inline" ? <InlineDiff parts={parts} /> : <SplitDiff before={before} after={next} />}
      {truncated && (
        <p className="border-t border-line px-3 py-2 font-mono text-[11px] text-mist">
          Showing the first {CAP} lines. The commit still uses the full file.
        </p>
      )}
    </div>
  );
}

function InlineDiff({ parts }: { parts: Change[] }) {
  let oldNo = 1;
  let newNo = 1;
  let shown = 0;
  const rows: Array<{ key: string; kind: "add" | "del" | "same"; text: string; gutter: string }> = [];

  for (const part of parts) {
    const kind = part.added ? "add" : part.removed ? "del" : "same";
    for (const line of linesOf(part.value)) {
      if (shown >= CAP) break;
      const gutter = kind === "add" ? `  ${newNo}` : kind === "del" ? `${oldNo}  ` : `${oldNo}`;
      rows.push({ key: `${shown}-${kind}`, kind, text: line, gutter });
      if (kind !== "add") oldNo += 1;
      if (kind !== "del") newNo += 1;
      shown += 1;
    }
  }

  return (
    <div className="max-h-80 overflow-auto font-mono text-[12px] leading-5">
      {rows.map((row) => (
        <div key={row.key} className={rowClass(row.kind)}>
          <span className="inline-block w-10 shrink-0 select-none pr-2 text-right text-mist/70">{row.gutter}</span>
          <span className="inline-block w-4 shrink-0 text-mist">{row.kind === "add" ? "+" : row.kind === "del" ? "−" : " "}</span>
          <span className="whitespace-pre-wrap break-all">{row.text || " "}</span>
        </div>
      ))}
    </div>
  );
}

function SplitDiff({ before, after }: { before: string; after: string }) {
  const rows = sideBySide(before, after).slice(0, CAP);
  return (
    <div className="max-h-80 overflow-auto font-mono text-[12px] leading-5">
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-2">
          <SplitCell cell={row.left} side="left" />
          <SplitCell cell={row.right} side="right" />
        </div>
      ))}
    </div>
  );
}

function SplitCell({ cell, side }: { cell: Cell | null; side: "left" | "right" }) {
  const mark = cell?.mark ?? " ";
  return (
    <div className={`${rowClass(mark === "+" ? "add" : mark === "-" ? "del" : "same")} border-line ${side === "left" ? "border-r" : ""}`}>
      <span className="inline-block w-4 shrink-0 text-mist">{mark === "+" ? "+" : mark === "-" ? "−" : " "}</span>
      <span className="whitespace-pre-wrap break-all">{cell?.text || " "}</span>
    </div>
  );
}

function sideBySide(before: string, after: string): Pair[] {
  const parts = diffLines(before, after);
  const rows: Pair[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const lines = linesOf(part.value);
    const addedNext = part.removed && parts[index + 1]?.added ? linesOf(parts[index + 1].value) : null;
    if (addedNext) {
      const width = Math.max(lines.length, addedNext.length);
      for (let line = 0; line < width; line += 1) {
        rows.push({
          left: lines[line] !== undefined ? { text: lines[line], mark: "-" } : null,
          right: addedNext[line] !== undefined ? { text: addedNext[line], mark: "+" } : null,
        });
      }
      index += 1;
      continue;
    }
    for (const line of lines) {
      if (part.added) rows.push({ left: null, right: { text: line, mark: "+" } });
      else if (part.removed) rows.push({ left: { text: line, mark: "-" }, right: null });
      else rows.push({ left: { text: line, mark: " " }, right: { text: line, mark: " " } });
    }
  }
  return rows;
}

function linesOf(value: string): string[] {
  if (value === "") return [];
  const parts = value.split("\n");
  if (value.endsWith("\n")) parts.pop();
  return parts;
}

function countLines(parts: Change[]): number {
  return parts.reduce((total, part) => total + linesOf(part.value).length, 0);
}

function rowClass(kind: "add" | "del" | "same"): string {
  if (kind === "add") return "bg-emerald/10 text-[#6EE7B7]";
  if (kind === "del") return "bg-crimson/10 text-[#FCA5A5]";
  return "text-mist";
}
