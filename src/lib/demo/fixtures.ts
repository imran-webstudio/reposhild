import { analyzeRepositoryFiles, statusFor } from "@/lib/scanner/engine";
import type { LockdownSignal, RateLimitSnapshot, ScannedRepo } from "@/lib/scanner/types";
import { demoFilesFor } from "@/lib/demo/store";
import {
  BRANCH_STRUCTURE_JSON,
  CLEAN_GITIGNORE,
  CLEAN_PACKAGE_JSON,
  CLEAN_POSTCSS,
  CLEAN_SETTINGS,
  CLEAN_WORKFLOW,
  INFECTED_GITIGNORE,
  INFECTED_NEXT_CONFIG,
  INFECTED_PACKAGE_JSON,
  INFECTED_POSTCSS,
  INFECTED_SETTINGS,
  INFECTED_TASKS,
  INFECTED_WEBPACK,
  PASSWORD_FILE,
  PORTFOLIO_PACKAGE_JSON,
  SYNTHETIC_API_JS,
  TEMP_AUTO_PUSH_BAT,
  TEMP_INTERACTIVE_PUSH_BAT,
  WORKFLOW_CURL,
} from "@/lib/demo/samples";

export interface DemoRepository {
  id: string;
  owner: string;
  name: string;
  isOrg: boolean;
  private: boolean;
  archived: boolean;
  fork: boolean;
  defaultBranch: string;
  pushedAt: string;
  lastCommitter: string;
  files: Record<string, string>;
}

export const DEMO_LOCKDOWN: LockdownSignal = {
  active: true,
  demo: true,
  pushCount: 47,
  repoCount: 12,
  windowMinutes: 120,
  unfamiliarCommitters: ["supply-bot"],
  summary: "47 pushes across 12 repositories in 38 minutes by an unfamiliar committer (supply-bot).",
};

export const DEMO_RATE: RateLimitSnapshot = {
  remaining: 4812,
  limit: 5000,
  resetAt: null,
  simulated: true,
};

export const DEMO_REPOS: DemoRepository[] = [
  {
    id: "demo-storefront",
    owner: "northwind",
    name: "storefront",
    isOrg: true,
    private: true,
    archived: false,
    fork: false,
    defaultBranch: "main",
    pushedAt: "2026-10-23T08:14:00.000Z",
    lastCommitter: "supply-bot",
    files: {
      "package.json": INFECTED_PACKAGE_JSON,
      "postcss.config.js": INFECTED_POSTCSS,
      ".gitignore": INFECTED_GITIGNORE,
      "api.js": SYNTHETIC_API_JS,
      ".vscode/tasks.json": INFECTED_TASKS,
      ".vscode/settings.json": INFECTED_SETTINGS,
    },
  },
  {
    id: "demo-billing",
    owner: "northwind",
    name: "billing-api",
    isOrg: true,
    private: false,
    archived: false,
    fork: false,
    defaultBranch: "main",
    pushedAt: "2026-10-23T08:11:00.000Z",
    lastCommitter: "supply-bot",
    files: {
      "package.json": CLEAN_PACKAGE_JSON,
      "webpack.config.js": INFECTED_WEBPACK,
      "branch_structure.json": BRANCH_STRUCTURE_JSON,
      "temp_auto_push.bat": TEMP_AUTO_PUSH_BAT,
    },
  },
  {
    id: "demo-design",
    owner: "northwind",
    name: "design-system",
    isOrg: true,
    private: false,
    archived: false,
    fork: false,
    defaultBranch: "main",
    pushedAt: "2026-10-20T15:04:00.000Z",
    lastCommitter: "ada",
    files: {
      "package.json": CLEAN_PACKAGE_JSON,
      "postcss.config.js": CLEAN_POSTCSS,
      ".github/workflows/ci.yml": CLEAN_WORKFLOW,
      ".vscode/settings.json": CLEAN_SETTINGS,
    },
  },
  {
    id: "demo-docs",
    owner: "northwind",
    name: "docs",
    isOrg: true,
    private: false,
    archived: false,
    fork: false,
    defaultBranch: "main",
    pushedAt: "2026-09-02T11:20:00.000Z",
    lastCommitter: "ada",
    files: {
      ".gitignore": CLEAN_GITIGNORE,
    },
  },
  {
    id: "demo-portfolio",
    owner: "ada",
    name: "portfolio",
    isOrg: false,
    private: false,
    archived: false,
    fork: false,
    defaultBranch: "main",
    pushedAt: "2026-10-22T16:02:00.000Z",
    lastCommitter: "ada",
    files: {
      "package.json": PORTFOLIO_PACKAGE_JSON,
      "next.config.mjs": INFECTED_NEXT_CONFIG,
    },
  },
  {
    id: "demo-dotfiles",
    owner: "ada",
    name: "dotfiles",
    isOrg: false,
    private: false,
    archived: false,
    fork: false,
    defaultBranch: "main",
    pushedAt: "2026-10-23T07:40:00.000Z",
    lastCommitter: "supply-bot",
    files: {
      ".gitignore": INFECTED_GITIGNORE,
      password: PASSWORD_FILE,
    },
  },
  {
    id: "demo-notes",
    owner: "ada",
    name: "notes",
    isOrg: false,
    private: false,
    archived: false,
    fork: true,
    defaultBranch: "main",
    pushedAt: "2026-08-19T09:12:00.000Z",
    lastCommitter: "ada",
    files: {
      ".gitignore": CLEAN_GITIGNORE,
    },
  },
  {
    id: "demo-cli",
    owner: "ada",
    name: "cli",
    isOrg: false,
    private: false,
    archived: false,
    fork: false,
    defaultBranch: "main",
    pushedAt: "2026-10-21T18:33:00.000Z",
    lastCommitter: "ada",
    files: {
      "api.js": SYNTHETIC_API_JS,
      ".vscode/tasks.json": INFECTED_TASKS,
      "package.json": `{
  "name": "cli",
  "scripts": {
    "prepare": "node api.js && echo keep-me",
    "dev": "node ./api.js && tsc -w"
  }
}
`,
    },
  },
  {
    id: "demo-experiments",
    owner: "ada",
    name: "experiments",
    isOrg: false,
    private: false,
    archived: false,
    fork: false,
    defaultBranch: "main",
    pushedAt: "2026-10-23T08:02:00.000Z",
    lastCommitter: "supply-bot",
    files: {
      ".gitignore": "node_modules\ntemp_interactive_push.bat\n",
      "temp_interactive_push.bat": TEMP_INTERACTIVE_PUSH_BAT,
      ".github/workflows/setup.yml": WORKFLOW_CURL,
    },
  },
  {
    id: "demo-mobile",
    owner: "northwind",
    name: "mobile",
    isOrg: true,
    private: false,
    archived: true,
    fork: false,
    defaultBranch: "main",
    pushedAt: "2026-04-11T10:00:00.000Z",
    lastCommitter: "ada",
    files: {
      "package.json": CLEAN_PACKAGE_JSON,
    },
  },
];

function stableDuration(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 33 + char.charCodeAt(0)) >>> 0;
  return 42 + (hash % 150);
}

export async function scanDemo(
  onRepo: (update: { scanned: number; total: number; elapsedMs: number; repo: ScannedRepo }) => void,
  signal?: AbortSignal,
): Promise<{ elapsedMs: number }> {
  const started = Date.now();
  const total = DEMO_REPOS.length;
  for (let index = 0; index < DEMO_REPOS.length; index += 1) {
    if (signal?.aborted) {
      throw new DOMException("The scan was cancelled.", "AbortError");
    }
    await wait(120, signal);
    const demo = DEMO_REPOS[index];
    const files = demoFilesFor(`${demo.owner}/${demo.name}`, demo.files);
    const fetched = Object.entries(files).map(([path, text]) => ({
      path,
      text,
      byteSize: text.length,
    }));
    const analyzed = analyzeRepositoryFiles(fetched);
    const repo: ScannedRepo = {
      id: demo.id,
      owner: demo.owner,
      name: demo.name,
      fullName: `${demo.owner}/${demo.name}`,
      private: demo.private,
      archived: demo.archived,
      fork: demo.fork,
      isOrg: demo.isOrg,
      defaultBranch: demo.defaultBranch,
      pushedAt: demo.pushedAt,
      lastCommitter: demo.lastCommitter,
      htmlUrl: `https://github.com/${demo.owner}/${demo.name}`,
      durationMs: stableDuration(demo.name),
      status: statusFor(analyzed.findings),
      findings: analyzed.findings,
      files: analyzed.files,
      warnings: [],
    };
    onRepo({
      scanned: index + 1,
      total,
      elapsedMs: Date.now() - started,
      repo,
    });
  }
  return { elapsedMs: Date.now() - started };
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The scan was cancelled.", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("The scan was cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
