/** Reject cross-site writes before using a signed-in account's GitHub credentials. */
export function isSameOriginWrite(req: Request): boolean {
  if (req.headers.get("sec-fetch-site") === "cross-site") return false;
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return false;
  const origin = req.headers.get("origin");
  if (!origin) return true; // Non-browser clients still require a valid session cookie.
  try { return origin === new URL(process.env.AUTH_URL || req.url).origin; } catch { return false; }
}
