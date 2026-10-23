export class CleanError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CleanError";
    this.status = status;
  }
}

export function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Request failed";
  return message
    .replace(/gh[opsu]_[A-Za-z0-9]+/g, "[token]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[token]")
    .replace(/Bearer\s+\S+/gi, "Bearer [token]")
    .slice(0, 500);
}

export function httpStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && (error as { name: string }).name === "AbortError";
}
