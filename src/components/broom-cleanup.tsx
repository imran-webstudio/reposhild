"use client";

import { useEffect, useRef, useState } from "react";

export type BroomCleanupStatus = "idle" | "scanning" | "cleaning" | "clean" | "error";

/** One real finding line shown in the editor backdrop. */
export type CleanupIssue = {
  path: string;
  line: number;
  infected: string;
  cleaned: string;
};

export type BroomCleanupProps = {
  total: number;
  removed: number;
  status: BroomCleanupStatus;
  label?: string;
  loop?: boolean;
  showReplay?: boolean;
  /** Real malware lines being removed. Falls back to sample snippets when omitted. */
  issues?: CleanupIssue[];
};

type HeroState = "idle" | "walk" | "wind" | "swing" | "recover" | "done";
type BugState = "alive" | "splat";
type TokenKind = "kw" | "fn" | "str" | "bad" | "ok" | "muted" | "punc";

type CodeToken = { text: string; kind: TokenKind };

type Bug = {
  x: number;
  ph: number;
  sp: number;
  s: number;
  dir: number;
  st: BugState;
  age: number;
  line: number;
  row: number;
  path: string;
  infected: CodeToken[];
  cleaned: CodeToken[];
};

type Puff = { x: number; y: number; r: number; life: number; vy: number; ch?: string };
type Hit = { x: number; life: number };
type Pose = { hx: number; hy: number; a: number; lean: number };

const SKIN = "#E2B58D";
const LB = 130;
const HANDS_H = 88;
const IMPACT_A = Math.asin(HANDS_H / LB);
const REACH = LB * Math.cos(IMPACT_A) + 14 - 17;
const REST: Pose = { hx: 16, hy: 80, a: 0.5, lean: 0.05 };
const UP: Pose = { hx: 0, hy: 140, a: -2.5, lean: -0.14 };
const HIT: Pose = { hx: 14, hy: HANDS_H, a: IMPACT_A, lean: 0.22 };
const WALK_SPEED = 190;

const SAMPLE_ISSUES: CleanupIssue[] = [
  {
    path: "package.json",
    line: 18,
    infected: '"postinstall": "node node_modules/.cache/p/install.js"',
    cleaned: '"test": "vitest run"',
  },
  {
    path: "package.json",
    line: 22,
    infected: '"preinstall": "unexpected remote installer command"',
    cleaned: "// preinstall hook removed",
  },
];

/** Map scan findings + planned edits into backdrop lines for the broom animation. */
export function cleanupIssuesFromFindings(
  findings: Array<{
    path: string;
    line: number;
    rule: string;
    strategy: string;
    snippet: string;
    revealed: string;
    hiddenPadding: boolean;
  }>,
  changes: Array<{ path: string; action: "delete" | "modify"; after: string | null }>,
): CleanupIssue[] {
  const byPath = new Map(changes.map((change) => [change.path, change]));
  return findings.map((finding) => {
    const infected = flattenSnippet(finding.hiddenPadding ? finding.revealed : finding.snippet);
    const change = byPath.get(finding.path);
    return {
      path: finding.path,
      line: finding.line,
      infected: infected || finding.rule,
      cleaned: cleanedSnippetFor(finding, change, infected),
    };
  });
}

function flattenSnippet(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 140);
}

function cleanedSnippetFor(
  finding: { path: string; line: number; rule: string; strategy: string },
  change: { action: "delete" | "modify"; after: string | null } | undefined,
  infected: string,
) {
  if (!change) {
    return finding.strategy === "review-only"
      ? `// review only · ${finding.rule}`
      : `// cleared · ${finding.rule}`;
  }
  if (change.action === "delete" || change.after == null) {
    return `// deleted ${finding.path}`;
  }
  const afterLines = change.after.split(/\r?\n/);
  const probe = infected.slice(0, Math.min(48, infected.length));
  const stillPresent = probe.length > 0 && change.after.includes(probe);
  if (!stillPresent) {
    const at = afterLines[Math.max(0, finding.line - 1)]?.trim();
    if (at && at.length > 0 && flattenSnippet(at) !== infected) return flattenSnippet(at);
    return `// removed · ${finding.rule}`;
  }
  const at = afterLines[Math.max(0, finding.line - 1)]?.trim();
  return flattenSnippet(at || `// sanitized · ${finding.rule}`);
}

function tokensForLine(text: string, mode: "bad" | "ok" | "muted"): CodeToken[] {
  const value = text.trim() || " ";
  return [{ text: value.length > 96 ? `${value.slice(0, 93)}…` : value, kind: mode }];
}

function theme(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function mix(a: Pose, b: Pose, k: number): Pose {
  return {
    hx: a.hx + (b.hx - a.hx) * k,
    hy: a.hy + (b.hy - a.hy) * k,
    a: a.a + (b.a - a.a) * k,
    lean: a.lean + (b.lean - a.lean) * k,
  };
}

function ease(k: number) {
  return 1 - Math.pow(1 - k, 3);
}

export function BroomCleanup({
  total,
  removed,
  status,
  label = "Pollin Rider",
  loop = false,
  showReplay = false,
  issues,
}: BroomCleanupProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [replayKey, setReplayKey] = useState(0);
  const [liveRemoved, setLiveRemoved] = useState(Math.min(removed, total));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const col: Record<string, string> = {};
    let W = 800;
    let H = 300;
    let u = 1;
    let floorY = 252;
    let t = 0;
    let bugs: Bug[] = [];
    let puffs: Puff[] = [];
    let hits: Hit[] = [];
    let cleared = 0;
    let holdT = 0;
    let shake = 0;
    let frame = 0;
    let last = 0;
    const hero = { x: 0, state: "idle" as HeroState, ts: 0, target: null as Bug | null, step: 0 };

    const desired = () =>
      status === "cleaning" || loop ? total : Math.max(0, Math.min(total, removed));
    const shouldAnimate = () => status === "cleaning" && !reduced.matches && desired() > 0;

    function readCols() {
      col.bg = theme("--site-bg", "#070b09");
      col.bg2 = theme("--site-bg2", "#0c1310");
      col.surface = theme("--site-surface", "#111a14");
      col.ink = theme("--site-t0", "#f3fbf5");
      col.muted = theme("--site-t1", "#aebcb2");
      col.dim = theme("--site-t2", "#74877b");
      col.bug = theme("--site-red", "#f4677a");
      col.ok = theme("--site-green", "#34d97e");
      col.okMid = theme("--site-green-mid", "#1fbf6c");
      col.teal = theme("--site-teal", "#2dd4cf");
      col.floor = theme("--site-border", "#1d2c23");
      col.border2 = theme("--site-border-2", "#28392d");
      col.straw = theme("--site-gold", "#f0c869");
      col.wood = "#B38A5E";
      col.shirt = "#2F6FB0";
    }

    function tokenColor(kind: TokenKind) {
      if (kind === "kw") return col.teal;
      if (kind === "fn") return col.ink;
      if (kind === "str") return col.straw;
      if (kind === "bad") return col.bug;
      if (kind === "ok") return col.ok;
      if (kind === "muted") return col.dim;
      return col.muted;
    }

    function resize() {
      const r = canvas.getBoundingClientRect();
      const d = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, r.width);
      H = Math.max(1, r.width * 3 / 8);
      u = H / 300;
      floorY = H * 0.84;
      canvas.width = Math.round(W * d);
      canvas.height = Math.round(H * d);
      canvas.style.aspectRatio = "8 / 3";
      ctx.setTransform(d, 0, 0, d, 0, 0);
    }

    function reset(startCleared = 0) {
      const n = Math.max(0, total);
      bugs = [];
      puffs = [];
      hits = [];
      cleared = Math.max(0, Math.min(n, startCleared));
      t = 0;
      holdT = 0;
      shake = 0;
      Object.assign(hero, { x: -40 * u, state: "idle", ts: 0, target: null, step: 0 });
      const ambientRows = Math.max(4, n + 2);
      const source = issues && issues.length > 0 ? issues : SAMPLE_ISSUES;
      for (let i = 0; i < n; i++) {
        const issue = source[i % source.length];
        const cleanedKind: TokenKind = issue.cleaned.startsWith("//") ? "muted" : "ok";
        bugs.push({
          x: W * (0.3 + (0.65 * (i + Math.random() * 0.6)) / Math.max(n, 1)),
          ph: Math.random() * 6,
          sp: (Math.random() - 0.5) * 16,
          s: 0.85 + Math.random() * 0.3,
          dir: Math.random() < 0.5 ? -1 : 1,
          st: i < cleared ? "splat" : "alive",
          age: i < cleared ? 2 : 0,
          line: issue.line,
          row: Math.min(ambientRows - 2, i + 1),
          infected: tokensForLine(issue.infected, "bad"),
          cleaned: tokensForLine(issue.cleaned, cleanedKind),
          path: issue.path,
        });
      }
      if (cleared >= n && n > 0) {
        hero.state = "done";
        hero.x = bugs[n - 1].x - REACH * u - 30 * u;
      }
      setLiveRemoved(cleared);
    }

    function impact() {
      const b = hero.target;
      if (b && b.st === "alive") {
        b.st = "splat";
        b.age = 0;
        cleared += 1;
        setLiveRemoved(cleared);
        hits.push({ x: b.x, life: 0.28 });
        const scraps = ["{", "}", ";", "$", "0x", ";;", "!", "/"];
        for (let k = 0; k < 8; k++) {
          puffs.push({
            x: b.x + (Math.random() - 0.5) * 24 * u,
            y: floorY - 8 * u,
            r: (2 + Math.random() * 3) * u,
            life: 0.55,
            vy: -(35 + Math.random() * 70) * u,
            ch: scraps[k % scraps.length],
          });
        }
      }
      shake = 1;
      hero.state = "recover";
      hero.ts = 0;
    }

    function update(dt: number) {
      t += dt;
      hero.ts += dt;
      shake = Math.max(shake - dt * 6, 0);

      if (!shouldAnimate()) {
        if (status === "clean" || (status !== "cleaning" && removed >= total && total > 0)) {
          if (cleared < total) {
            cleared = total;
            bugs.forEach((b) => {
              b.st = "splat";
              b.age = 2;
            });
            hero.state = "done";
            hero.x = bugs.length ? bugs[bugs.length - 1].x - REACH * u - 30 * u : hero.x;
            setLiveRemoved(cleared);
          }
        } else if (status === "idle" || status === "scanning") {
          hero.state = "idle";
        }
        return;
      }

      if (hero.state === "idle" && t > 0.45) hero.state = "walk";

      const busy = hero.state === "wind" || hero.state === "swing";
      for (const b of bugs) {
        b.age += dt;
        if (b.st === "alive" && !(busy && b === hero.target)) {
          b.x = Math.min(Math.max(b.x + b.sp * dt * Math.sin(t * 2 + b.ph), 14), W - 14);
        }
      }

      const goalCleared = desired();
      if (hero.state === "walk") {
        hero.step += dt;
        let tg: Bug | null = null;
        for (const b of bugs) {
          if (b.st === "alive" && cleared < goalCleared && (!tg || b.x < tg.x)) tg = b;
        }
        if (!tg) {
          hero.state = cleared >= bugs.length ? "done" : "idle";
          hero.ts = 0;
        } else {
          const goal = tg.x - REACH * u;
          if (hero.x < goal - 0.5) hero.x = Math.min(hero.x + WALK_SPEED * u * dt, goal);
          else {
            hero.state = "wind";
            hero.ts = 0;
            hero.target = tg;
          }
        }
      } else if (hero.state === "wind") {
        if (hero.ts > 0.4) {
          hero.state = "swing";
          hero.ts = 0;
        }
      } else if (hero.state === "swing") {
        if (hero.ts >= 0.13) impact();
      } else if (hero.state === "recover") {
        if (hero.ts > 0.38) {
          hero.state = "walk";
          hero.ts = 0;
          hero.target = null;
        }
      }

      for (const q of puffs) {
        q.life -= dt;
        q.y += q.vy * dt;
      }
      puffs = puffs.filter((q) => q.life > 0);
      for (const q of hits) q.life -= dt;
      hits = hits.filter((q) => q.life > 0);

      if (cleared >= bugs.length && bugs.length > 0 && hero.state === "done") {
        holdT += dt;
        if (loop && !reduced.matches && holdT > 2.6) reset(0);
      }
    }

    function pose(): Pose {
      if (hero.state === "wind") return mix(REST, UP, ease(Math.min(hero.ts / 0.4, 1)));
      if (hero.state === "swing") {
        const k = Math.min(hero.ts / 0.13, 1);
        return mix(UP, HIT, k * k);
      }
      if (hero.state === "recover") return mix(HIT, REST, ease(Math.min(hero.ts / 0.38, 1)));
      return REST;
    }

    function limb(x1: number, y1: number, x2: number, y2: number, w: number, c: string, bend: number) {
      ctx.strokeStyle = c;
      ctx.lineWidth = w;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      if (bend) ctx.quadraticCurveTo((x1 + x2) / 2, (y1 + y2) / 2 + bend, x2, y2);
      else ctx.lineTo(x2, y2);
      ctx.stroke();
    }

    function drawTokens(tokens: CodeToken[], x: number, y: number, alpha: number, glitch = false) {
      let cursor = x;
      const size = Math.max(9, 11 * u);
      ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
      ctx.textBaseline = "middle";
      for (const token of tokens) {
        const jx = glitch ? Math.sin(t * 40 + cursor) * 0.8 * u : 0;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = tokenColor(token.kind);
        ctx.fillText(token.text, cursor + jx, y);
        cursor += ctx.measureText(token.text).width;
      }
      ctx.globalAlpha = 1;
      return cursor;
    }

    function drawEditorBackdrop() {
      const gutter = 36 * u;
      const padX = 10 * u;
      const lineH = 18 * u;
      const codeTop = 18 * u;

      ctx.fillStyle = col.bg2;
      ctx.fillRect(0, 0, W, H);

      // editor panel
      ctx.fillStyle = col.surface;
      ctx.fillRect(padX, 8 * u, W - padX * 2, floorY - 4 * u);

      // gutter
      ctx.fillStyle = col.bg;
      ctx.fillRect(padX, 8 * u, gutter, floorY - 4 * u);
      ctx.strokeStyle = col.floor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padX + gutter, 8 * u);
      ctx.lineTo(padX + gutter, floorY);
      ctx.stroke();

      // title bar chip — real file path(s) from findings
      ctx.fillStyle = col.border2;
      ctx.fillRect(padX, 8 * u, W - padX * 2, 14 * u);
      ctx.fillStyle = col.dim;
      ctx.font = `${Math.max(8, 9 * u)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
      ctx.textBaseline = "middle";
      const paths = [...new Set(bugs.map((b) => b.path).filter(Boolean))];
      const title =
        paths.length === 0
          ? "infected files"
          : paths.length === 1
            ? `${paths[0]}  ·  removing malware`
            : `${paths[0]} +${paths.length - 1} more  ·  removing malware`;
      ctx.fillText(title, padX + 8 * u, 15 * u);

      // ambient empty lines
      const ambient = Math.max(4, Math.ceil((floorY - codeTop - 40 * u) / lineH));
      ctx.font = `${Math.max(9, 11 * u)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
      for (let i = 0; i < ambient; i++) {
        const y = codeTop + 20 * u + i * lineH;
        if (y > floorY - 28 * u) break;
        ctx.fillStyle = col.dim;
        ctx.globalAlpha = 0.45;
        ctx.fillText(String(i + 1).padStart(2, " "), padX + 8 * u, y);
        ctx.globalAlpha = 0.2;
        ctx.fillStyle = col.muted;
        const quiet =
          i % 3 === 0 ? "  {" : i % 3 === 1 ? '  "name": "app",' : "  // …";
        ctx.fillText(quiet, padX + gutter + 10 * u, y);
        ctx.globalAlpha = 1;
      }

      // infected / cleaned lines tied to bugs
      for (const b of bugs) {
        const row = Math.min(ambient - 1, Math.max(0, b.row));
        const y = codeTop + 20 * u + row * lineH;
        const cleanProgress = b.st === "splat" ? Math.min(Math.max((b.age - 0.1) / 0.45, 0), 1) : 0;
        const scared = b === hero.target && (hero.state === "wind" || hero.state === "swing");

        ctx.fillStyle = col.dim;
        ctx.globalAlpha = 0.85;
        ctx.fillText(String(b.line).padStart(2, " "), padX + 8 * u, y);
        ctx.globalAlpha = 1;

        // highlight strip behind infected / active line
        if (b.st === "alive" || cleanProgress < 1) {
          ctx.fillStyle = b.st === "alive" ? col.bug : col.ok;
          ctx.globalAlpha = b.st === "alive" ? (scared ? 0.14 : 0.08) : 0.1 * (1 - cleanProgress);
          ctx.fillRect(padX + gutter, y - lineH * 0.42, W - padX * 2 - gutter, lineH * 0.84);
          ctx.globalAlpha = 1;
        }

        if (cleanProgress < 1) {
          drawTokens(b.infected, padX + gutter + 10 * u, y, 1 - cleanProgress * 0.85, b.st === "alive" && scared);
        }
        if (cleanProgress > 0) {
          drawTokens(b.cleaned, padX + gutter + 10 * u, y, cleanProgress);
          // small check after cleaned text
          if (cleanProgress > 0.85) {
            ctx.globalAlpha = (cleanProgress - 0.85) / 0.15;
            ctx.strokeStyle = col.ok;
            ctx.lineWidth = 1.6 * u;
            ctx.lineCap = "round";
            const cx = padX + gutter + 10 * u + ctx.measureText(b.cleaned.map((tok) => tok.text).join("")).width + 12 * u;
            ctx.beginPath();
            ctx.moveTo(cx, y);
            ctx.lineTo(cx + 3 * u, y + 3 * u);
            ctx.lineTo(cx + 8 * u, y - 4 * u);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }

        // connector from code line down toward bug
        if (b.st === "alive" || cleanProgress < 0.9) {
          ctx.strokeStyle = b.st === "alive" ? col.bug : col.ok;
          ctx.globalAlpha = b.st === "alive" ? 0.25 : 0.2 * (1 - cleanProgress);
          ctx.lineWidth = 1;
          ctx.setLineDash([3 * u, 3 * u]);
          ctx.beginPath();
          ctx.moveTo(b.x, y + 6 * u);
          ctx.lineTo(b.x, floorY - 16 * u);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        }
      }

      // floor as editor baseline
      ctx.strokeStyle = col.okMid;
      ctx.globalAlpha = 0.35 + (cleared / Math.max(bugs.length, 1)) * 0.45;
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.moveTo(padX, floorY + 2 * u);
      ctx.lineTo(W - padX, floorY + 2 * u);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // status strip
      const progress = bugs.length ? cleared / bugs.length : 0;
      ctx.fillStyle = col.bg;
      ctx.fillRect(padX, floorY + 6 * u, W - padX * 2, 10 * u);
      ctx.fillStyle = col.ok;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(padX, floorY + 6 * u, (W - padX * 2) * progress, 10 * u);
      ctx.globalAlpha = 1;
    }

    function drawHuman() {
      const p = pose();
      const S = u;
      const x = hero.x;
      const walking = hero.state === "walk";
      const hip = { x, y: floorY - 56 * S };
      const sh = { x: x + Math.sin(p.lean) * 46 * S, y: hip.y - Math.cos(p.lean) * 46 * S };
      const head = { x: sh.x + Math.sin(p.lean) * 17 * S + 2 * S, y: sh.y - Math.cos(p.lean) * 17 * S };
      const strike = hero.state === "wind" || hero.state === "swing" || hero.state === "recover";
      const f = walking ? Math.sin(hero.step * 9) * 0.5 : strike ? 0.42 : 0.1;
      const bk = walking ? -f : -0.32;
      for (const ang of [bk, f]) {
        limb(hip.x, hip.y, hip.x + Math.sin(ang) * 56 * S, Math.min(hip.y + Math.cos(ang) * 56 * S, floorY), 8 * S, col.ink, 0);
      }
      limb(hip.x, hip.y, sh.x, sh.y, 15 * S, col.shirt, 0);
      ctx.fillStyle = SKIN;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 10 * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = col.ink;
      ctx.beginPath();
      ctx.arc(head.x, head.y, 10.5 * S, Math.PI * 0.55, Math.PI * 1.75);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(head.x + 4 * S, head.y - 1 * S, 1.5 * S, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = col.ink;
      ctx.lineWidth = 1.6 * S;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(head.x + 1.5 * S, head.y - 4 * S);
      ctx.lineTo(head.x + 7 * S, head.y - (strike ? 1 : 4) * S);
      ctx.stroke();

      const hand = { x: sh.x + p.hx * S, y: floorY - p.hy * S };
      const ex = Math.cos(p.a);
      const ey = Math.sin(p.a);
      const hand2 = { x: hand.x - ex * 24 * S, y: hand.y - ey * 24 * S };
      const splay = hero.state === "recover" ? 1 + Math.max(1 - hero.ts / 0.12, 0) * 0.9 : 1;
      ctx.save();
      ctx.translate(hand.x, hand.y);
      ctx.rotate(p.a);
      ctx.strokeStyle = col.wood;
      ctx.lineWidth = 5 * S;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-28 * S, 0);
      ctx.lineTo((LB - 34) * S, 0);
      ctx.stroke();
      ctx.strokeStyle = col.straw;
      ctx.lineWidth = 2.4 * S;
      for (let i = -6; i <= 6; i++) {
        ctx.beginPath();
        ctx.moveTo((LB - 34) * S, i * 2.4 * S);
        ctx.lineTo((LB + 2) * S, i * 4.2 * S * splay);
        ctx.stroke();
      }
      ctx.fillStyle = col.wood;
      ctx.fillRect((LB - 38) * S, -9 * S, 9 * S, 18 * S);
      ctx.restore();
      ctx.fillStyle = SKIN;
      for (const pt of [hand2, hand]) {
        limb(sh.x, sh.y, pt.x, pt.y, 5 * S, col.shirt, 12 * S);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 3.4 * S, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawBug(b: Bug) {
      const S = u * b.s;
      const flat = b.st === "splat" ? Math.min(b.age / 0.12, 1) : 0;
      const fade = b.st === "splat" ? Math.min(Math.max((b.age - 0.35) / 0.4, 0), 1) : 0;
      const scared = b === hero.target && (hero.state === "wind" || hero.state === "swing");
      const jx = scared ? Math.sin(t * 70) * 1.5 * u : 0;
      if (fade < 1) {
        const w = b.st === "alive" ? Math.sin(t * (scared ? 55 : 22) + b.ph) * (scared ? 3.5 : 2) : 0;
        ctx.save();
        ctx.translate(b.x + jx, floorY - 7 * S);
        ctx.scale(b.dir * S * (1 + 0.5 * flat), S * (1 - 0.72 * flat));
        ctx.globalAlpha = 1 - fade;
        ctx.strokeStyle = col.bug;
        ctx.fillStyle = col.bug;
        ctx.lineWidth = 1.7;
        ctx.lineCap = "round";
        for (let i = -1; i <= 1; i++) {
          const lx = i * 5;
          ctx.beginPath();
          ctx.moveTo(lx, 0);
          ctx.lineTo(lx - 3 + w * i * 0.6, -9);
          ctx.moveTo(lx, 0);
          ctx.lineTo(lx - 3 - w * i * 0.6, 9);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.ellipse(0, 0, 11, 7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(12, 0, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(14, -2);
        ctx.quadraticCurveTo(20, -6, 22, -10 + w * 0.4);
        ctx.moveTo(14, 2);
        ctx.quadraticCurveTo(20, 6, 22, 10 - w * 0.4);
        ctx.stroke();
        ctx.restore();
      }
      if (fade > 0) {
        const r = 9 * u;
        const cx = b.x;
        const cy = floorY - 11 * u;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.strokeStyle = col.ok;
        ctx.lineWidth = 2.2 * u;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.45, cy);
        ctx.lineTo(cx - r * 0.1, cy + r * 0.38);
        ctx.lineTo(cx + r * 0.5, cy - r * 0.35);
        ctx.stroke();
        ctx.restore();
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(Math.sin(t * 90) * 3 * shake * u, 0);
      drawEditorBackdrop();
      for (const b of bugs) drawBug(b);
      drawHuman();
      for (const q of hits) {
        const k = 1 - q.life / 0.28;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = col.straw;
        ctx.lineWidth = 2.4 * u;
        ctx.lineCap = "round";
        for (let i = 0; i <= 6; i++) {
          const a = -Math.PI * (i / 6);
          const r0 = (12 + k * 8) * u;
          const r1 = (24 + k * 26) * u;
          ctx.beginPath();
          ctx.moveTo(q.x + Math.cos(a) * r0, floorY - 4 * u + Math.sin(a) * r0);
          ctx.lineTo(q.x + Math.cos(a) * r1, floorY - 4 * u + Math.sin(a) * r1);
          ctx.stroke();
        }
      }
      for (const q of puffs) {
        ctx.globalAlpha = Math.max(q.life / 0.55, 0);
        if (q.ch) {
          ctx.fillStyle = col.bug;
          ctx.font = `${Math.max(8, 10 * u)}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
          ctx.fillText(q.ch, q.x, q.y);
        } else {
          ctx.fillStyle = col.floor;
          ctx.beginPath();
          ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    function tick(ts: number) {
      const dt = Math.min((ts - last) / 1000 || 0, 0.05);
      last = ts;
      update(dt);
      draw();
      frame = requestAnimationFrame(tick);
    }

    readCols();
    resize();
    const startCleared = loop ? 0 : status === "cleaning" ? 0 : Math.min(total, removed);
    reset(reduced.matches ? desired() : startCleared);
    if (reduced.matches) {
      bugs.forEach((b) => {
        b.st = "splat";
        b.age = 2;
      });
      cleared = bugs.length;
      hero.state = "done";
      if (bugs.length) hero.x = bugs[bugs.length - 1].x - REACH * u - 30 * u;
      setLiveRemoved(cleared);
      draw();
    } else {
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }

    const onResize = () => {
      resize();
      if (reduced.matches) draw();
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(canvas);
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [total, removed, status, loop, label, replayKey, issues]);

  const displayRemoved = status === "cleaning" ? liveRemoved : Math.min(total, removed);
  const state =
    status === "clean" || displayRemoved >= total
      ? "clean"
      : status === "error"
        ? "error — findings remain"
        : status === "scanning"
          ? "scanning"
          : status === "cleaning"
            ? "cleaning"
            : "ready";

  return (
    <div className="w-full" data-testid="broom-cleanup">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${label}: ${state}. ${displayRemoved} of ${total} findings removed.`}
        className="block w-full rounded-xl border border-line bg-app"
      />
      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-mist" aria-live="polite">
        <span>{state === "clean" ? `${label} removed` : `${label} ${state}`}</span>
        <span className="font-mono tabular-nums text-bone">
          {displayRemoved} / {total}
        </span>
      </div>
      {showReplay ? (
        <button type="button" className="btn-ghost mt-3" onClick={() => setReplayKey((key) => key + 1)}>
          Replay demo
        </button>
      ) : null}
    </div>
  );
}
