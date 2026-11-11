import { githubAccessSettingsUrl } from "@/lib/github/access-settings";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    githubAccessUrl: githubAccessSettingsUrl(process.env.AUTH_GITHUB_ID),
    githubConfigured: Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
  });
}
