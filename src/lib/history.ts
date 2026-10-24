export type StoredScanStatus = "RUNNING" | "COMPLETED" | "FAILED" | "ABORTED";

export interface ScanSummary {
  id: string;
  status: StoredScanStatus;
  startedAt: string;
  finishedAt: string | null;
  elapsedMs: number | null;
  repoTotal: number;
  repoScanned: number;
  infectedCount: number;
  criticalCount: number;
  error: string | null;
}

export interface RemediationSummary {
  id: string;
  fullName: string;
  mode: "commit" | "pr";
  commitUrl: string;
  prUrl: string | null;
  message: string;
  createdAt: string;
  fallbackToPr: boolean;
}
