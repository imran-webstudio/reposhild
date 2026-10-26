export type Severity = "CRITICAL" | "HIGH" | "MEDIUM";

export type AutoFixStrategy =
  | "delete-file"
  | "sanitize-package-json"
  | "sanitize-config-tail"
  | "sanitize-gitignore"
  | "sanitize-vscode-tasks"
  | "sanitize-vscode-settings"
  | "review-only";

export interface Finding {
  id: string;
  severity: Severity;
  path: string;
  line: number;
  rule: string;
  ruleId: string;
  strategy: AutoFixStrategy;
  message: string;
  /** Raw matched line, unchanged. */
  snippet: string;
  /** Same line with off-screen padding removed so hidden code is visible. */
  revealed: string;
  hiddenPadding: boolean;
}

export interface FetchedFile {
  path: string;
  text: string;
  byteSize: number;
}

export type RepoStatus = "clean" | "infected" | "skipped" | "error";

export interface ScannedRepo {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  archived: boolean;
  fork: boolean;
  isOrg: boolean;
  defaultBranch: string;
  headSha?: string;
  fileModes?: Record<string, string>;
  pushedAt: string | null;
  lastCommitter: string | null;
  htmlUrl: string;
  durationMs: number;
  status: RepoStatus;
  findings: Finding[];
  /** Text of files that produced a finding. Used for the local diff preview. */
  files: Record<string, string>;
  error?: string;
  skippedReason?: string;
  warnings?: string[];
}

export interface FileChange {
  path: string;
  action: "delete" | "modify";
  before: string;
  after: string | null;
  strategies: AutoFixStrategy[];
  rules: string[];
}

export interface LockdownSignal {
  active: boolean;
  pushCount: number;
  repoCount: number;
  windowMinutes: number;
  unfamiliarCommitters: string[];
  summary: string;
}

export interface RateLimitSnapshot {
  remaining: number;
  limit: number;
  resetAt: string | null;
}

export interface ScanEventProgress {
  scanned: number;
  total: number;
  elapsedMs: number;
  repo: ScannedRepo;
}

export interface RemediationResult {
  owner: string;
  name: string;
  mode: "commit" | "pr";
  commitSha: string;
  commitUrl: string;
  prUrl: string | null;
  branch: string;
  message: string;
  changes: FileChange[];
  fallbackToPr: boolean;
}
