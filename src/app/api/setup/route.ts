export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    githubConfigured: Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
    databaseConfigured: Boolean(process.env.DATABASE_URL),
  });
}
