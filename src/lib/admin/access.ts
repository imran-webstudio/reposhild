/** Admin privileges belong to immutable GitHub IDs. No configured IDs means no administrators. */
export function isAdminGitHubId(githubId: string | null | undefined): boolean {
  if (!githubId || !/^\d+$/.test(githubId)) return false;
  return (process.env.ADMIN_GITHUB_IDS ?? "").split(",").map((id) => id.trim()).filter((id) => /^\d+$/.test(id)).includes(githubId);
}
