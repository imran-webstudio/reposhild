import { getToken } from "next-auth/jwt";

export interface GitHubSession {
  token: string;
  login: string;
}

/** Read the GitHub access token from the encrypted Auth.js cookie. Never send it to the browser. */
export async function getGitHubToken(req: Request): Promise<GitHubSession | null> {
  const secret =
    process.env.AUTH_SECRET || (process.env.NODE_ENV === "production" ? undefined : "reposhild-local-dev-secret");
  if (!secret) return null;

  const forwarded = req.headers.get("x-forwarded-proto");
  const secureCookie = forwarded ? forwarded.split(",")[0]?.trim() === "https" : process.env.NODE_ENV === "production";
  const jwt = await getToken({ req, secret, secureCookie });
  if (!jwt || typeof jwt.accessToken !== "string" || jwt.accessToken.length === 0) return null;
  if (typeof jwt.expiresAt === "number" && jwt.expiresAt * 1000 < Date.now()) return null;
  return {
    token: jwt.accessToken,
    login: typeof jwt.login === "string" ? jwt.login : "",
  };
}
