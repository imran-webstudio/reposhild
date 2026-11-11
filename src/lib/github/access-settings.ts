/** OAuth client IDs are public; secrets and access tokens must never enter this URL. */
export function githubAccessSettingsUrl(clientId: string | undefined): string {
  return clientId && /^[A-Za-z0-9_]{1,128}$/.test(clientId)
    ? `https://github.com/settings/connections/applications/${encodeURIComponent(clientId)}`
    : "https://github.com/settings/applications";
}
