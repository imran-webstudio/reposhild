# RepoShield

Dark dashboard that scans the signed-in GitHub account for supply-chain and repo-jacking malware without cloning repositories. Infected files can be previewed as a diff and cleaned in one commit.

Demo mode is on by default. It streams ten fixture repositories, including a synthetic PolinRider-style `storefront` sample (`api.js`, a padded `postcss.config.js` line, `package.json` script hooks, and a `.vscode/tasks.json` folder-open task). Those fixtures contain detection markers only. They do not open a network connection or read credentials.

## Setup

```bash
npm install
npm test
npm run dev
```

Open http://localhost:3000. **Scan All Repos** runs the simulation immediately.

To scan a real account, create a GitHub OAuth App with callback URL `http://localhost:3000/api/auth/callback/github` and copy `.env.example` to `.env.local`:

```bash
AUTH_SECRET=            # openssl rand -base64 32
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
AUTH_URL=http://localhost:3000
```

The app requests the `repo` and `read:org` scopes. The access token stays inside the encrypted Auth.js JWT cookie. It is not written to Postgres and it is not copied onto the browser session object.

Signed-in scans are stored: GitHub login, display name, avatar, each scan, the repositories and findings in that scan, and each cleanup commit or pull request. Turn **Demo** off after signing in. The history menu reloads a past scan, and the latest one opens automatically.

Turn **Demo / Simulation Mode** off, sign in, and scan. **Commit Fix to Default Branch** creates one commit through the Git Data API (`getRef` → `getCommit` → `createBlob` → `createTree` with `base_tree` → `createCommit` → `updateRef`). If the default branch rejects the update, RepoShield opens a pull request instead. **Open Fix PR** always uses a `reposhield/sanitize-*` branch.

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

Copy `.env.example` to `/root/reposhild/.env` on the server, fill in the GitHub OAuth values, `AUTH_SECRET`, `AUTH_URL` (the public https origin), and a Postgres password. `POSTGRES_PASSWORD` and the password inside `DATABASE_URL` must match. That file has to exist before the first deploy. The workflow copies `docker-compose.yml` itself. Postgres is only on the Compose network, so it does not take port 5432 on the VPS. Local `docker compose up` also reads `docker-compose.override.yml` and publishes Postgres on `127.0.0.1:5432`.

```bash
docker compose up -d --build
```

The app container runs `prisma migrate deploy` before it listens. Postgres data stays in the `postgres_data` volume across restarts.

Pushes to `main` run the tests, build `your-dockerhub-user/reposhild`, and on the VPS log in to Docker Hub, pull that exact image, and wait until `/api/setup` is healthy. The workflow needs `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `VPS_HOST`, and `VPS_PASSWORD`. Pull requests only run the tests.

The published image is the Next.js standalone server. It does not contain the TypeScript source, the test tools, or the full dependency tree. The Prisma query engine and migration CLI are the only extra runtime files, so the container can open Postgres and apply migrations. The process runs as a non-root user.
