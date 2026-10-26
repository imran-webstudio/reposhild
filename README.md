# RepoShield

Dark dashboard that scans the signed-in GitHub account for supply-chain and repo-jacking malware without cloning repositories. Infected files can be previewed as a diff and cleaned in one commit.

## Setup

```bash
npm install
npm test
npm run dev
```

Open http://localhost:3000, sign in with GitHub, then **Scan All Repos**.

Create a GitHub OAuth App with callback URL `http://localhost:3000/api/auth/callback/github` and copy `.env.example` to `.env.local`:

```bash
AUTH_SECRET=            # openssl rand -base64 32
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
AUTH_URL=http://localhost:3000
```

The app requests the `repo` and `read:org` scopes. The access token stays inside the encrypted Auth.js JWT cookie. It is not written to Postgres and it is not copied onto the browser session object.

Signed-in scans are stored: GitHub login, display name, avatar, each scan, the repositories and findings in that scan, and each cleanup commit or pull request. The history menu reloads a past scan, and the latest one opens automatically.

**Commit Fix to Default Branch** creates one commit through the Git Data API (`getRef` → `getCommit` → `createBlob` → `createTree` with `base_tree` → `createCommit` → `updateRef`). If the default branch rejects the update, RepoShield opens a pull request instead. **Open Fix PR** always uses a `reposhield/sanitize-*` branch.

## How a scan stays small

1. `repos.listForAuthenticatedUser` pages through personal and org repositories.
2. Each non-empty repo gets one recursive `git.getTree` call, forty at a time.
3. Images, video, fonts, archives, lockfiles, `dist/`, `build/`, `.next/`, `node_modules/`, and blobs over 250 KB are skipped.
4. High-risk paths are read with one GraphQL query per repo (`object(expression: "HEAD:<path>") { ... on Blob { text } }`), chunked at 20 files.
5. Rules in `src/lib/scanner/rules.ts` flag script hijacks, config tails, known dropper names, `.gitignore` cloaking, and folder-open tasks.

The emergency banner reads `/users/{username}/events`. It lights up for more than 20 pushes across two or more repositories in two hours, or for a similar wave from committers other than you. The buttons open GitHub’s token, SSH key, and OAuth app settings.

## Tests

```bash
npm test
```

Vitest checks that `node api.js &&` is stripped from `package.json` while dependencies stay put, and that the padded `postcss.config.js` payload on line 10 is removed without breaking `module.exports`.

## VPS

Copy `.env.example` to `/root/reposhild/.env` on the server, fill in the GitHub OAuth values, `AUTH_SECRET`, `AUTH_URL` (the public https origin), and a Postgres password. `POSTGRES_PASSWORD` and the password inside `DATABASE_URL` must match. That file has to exist before the first deploy. The workflow copies `docker-compose.yml` itself. The public address is port 3210, because port 3000 on this VPS is already used. Postgres is only on the Compose network, so it does not take port 5432 on the VPS. Local `docker compose up` also reads `docker-compose.override.yml` and publishes Postgres on `127.0.0.1:5432`.

```bash
docker compose up -d --build
```

The app container runs `prisma migrate deploy` before it listens. Postgres data stays in the `postgres_data` volume across restarts.

Pushes to `main` run the tests, build `your-dockerhub-user/reposhild`, and on the VPS log in to Docker Hub, pull that exact image, and wait until `/api/setup` is healthy. The workflow needs `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `VPS_HOST`, and `VPS_PASSWORD`. Pull requests only run the tests.

The published image is the Next.js standalone server. It does not contain the TypeScript source, the test tools, or the full dependency tree. The Prisma query engine and migration CLI are the only extra runtime files, so the container can open Postgres and apply migrations. The process runs as a non-root user.

## Administration

Open `/admin` after signing in with an authorized GitHub account. The dashboard shows total users, users active in the last seven days, scan totals, and cleanup totals. The Users view supports name, username, and GitHub ID search, join-date filters, activity-status filters, and per-user activity. The Activity log supports user/repository search, action, outcome, and time filters. Both views paginate on the server.

Set `ADMIN_GITHUB_IDS` to comma-separated **numeric GitHub account IDs**, not usernames. The authorized project owner `imran-webstudio` currently has ID `277946130`. Set this on the server as well as locally:

```dotenv
ADMIN_GITHUB_IDS=277946130
```

An empty allowlist grants nobody access. Both the page and `/api/admin` enforce the allowlist on the server. GitHub tokens, cookies, source-file text, and request bodies are never included in activity logs or admin responses. Activity records include sign-ins and sign-outs, scan starts and outcomes, viewed historical scans, and cleanup requests and outcomes. Fix PRs are pending work and do not clear default-branch findings until merged and rescanned.

Apply the new database migration before using the dashboard:

```bash
npm run db:migrate
```

The migration adds activity records, last-activity timestamps, and scan revision IDs. It backfills existing scans and cleanups; past sign-ins, views, and failed cleanup attempts cannot be reconstructed. The Docker entrypoint applies migrations automatically on deployment. Unverified legacy users remain isolated and are never linked by username. After a username change, the permanent GitHub ID retains history; a displaced login is labeled `retired:<internal-id>`.

Historical scans without a stored revision must be scanned again before cleanup. Cleanup checks the revision shown in the preview, pins every file read to that revision, and refuses writes if the branch changes. Unread files and truncated trees produce incomplete results, never a clean result.

## Integrity checks and incident follow-up

The root `api.js` runner and an obfuscated PostCSS tail were removed on 26 October 2026. Evidence copies from this workstation were preserved outside the runnable repository at `/tmp/reposhild-audit-evidence/` (temporary storage, not a permanent archive). The standalone `scripts/check-integrity.mjs` inspects the package scripts and executable build configurations as text before the development server, tests, or build starts. CI and Docker also run it before affected build steps. These targeted checks are a regression guard, not a general malware scanner.

If this checkout or a previous affected image was executed, investigate the developer workstation and build runners, revoke exposed GitHub authorizations, and rotate accessible deployment, database, and application secrets from a trusted environment. Removing project files does not establish that those environments are clean. No credential rotation is performed automatically.

Inter, Space Grotesk, and JetBrains Mono are bundled locally with their Open Font License files, so builds do not depend on Google Fonts network responses.
