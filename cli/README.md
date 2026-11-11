# RepoShield CLI

Install globally from this repository (no registry publication is required):

```sh
npm install --global --ignore-scripts ./cli
reposhield enable
```

Or install the packaged `.tgz` with `npm install --global --ignore-scripts PATH_TO_PACKAGE.tgz`.

Open a new terminal, reload Cursor/VS Code, then run:

```sh
reposhield status
git pull origin main
git push
```

`reposhield` alone shows status. `reposhield scan HEAD` scans the current committed snapshot. `reposhield disable` restores managed Git configuration/hooks, shell configuration and editor Git paths where they have not changed externally. The runtime stays installed so existing shells can safely pass through to native Git when disabled.

Global means **all repositories for the current OS account**, not other users or remote servers. No root access is needed. macOS/Linux, `/usr/bin/git` and `/usr/bin/python3` are required. The package has no dependencies and no installation lifecycle scripts.

The runtime is copied outside checkouts to `~/Library/Application Support/RepoShield/runtime` on macOS, or `$XDG_DATA_HOME/reposhield/runtime` (default `~/.local/share/reposhield/runtime`) on Linux. Normal terminal Git commands use its Git wrapper after shell reload. Cursor/VS Code strict-JSON settings are updated when present; JSONC settings are left intact with manual instructions. Other Git clients must be configured to use that wrapper for pull protection.

The global pre-push hook covers repositories without an overriding local hook path. The wrapper automatically installs a chained local gate when custom hooks override the global setting, preserving those hooks. Previously created RepoShield local installations migrate automatically on the next wrapped push. Existing local hooks keep their original exit status. Global disable restores registered repository-local hooks too.

Pulls are fetched without checkout, inspected as immutable Git objects, and fast-forwarded only after all checks pass. Pushes inspect the actual outgoing commit snapshots, including intermediate commits. Findings identify the file, line, reason, commit and cleanup instruction. Nothing from the repository is imported or executed by the scanner. Prior user hooks may run after the scanner approves a push.

Limits: targeted campaign signatures, 8 MiB per blob, 128 MiB per scan, 30,000 files per tree, 500 commits per range. Unreadable objects, unknown remote bases, submodules, limits or suspicious custom checkout/transport drivers block rather than approve. Fast-forward pulls require a clean working tree. False positives require review; there are no path-wide test exclusions.

This is **client-side protection**, not antivirus or an access-control boundary against an attacker controlling your account. Absolute Git binaries, explicit hook overrides, `--no-verify` outside the shim and other clients can bypass it. Clone, checkout, switch, merge, rebase, reset and worktree creation are not automatically scanned. GitHub credentials, infected remote branches and affected machines/build runners still require incident response. No website, credentials or remote repository is changed by enable/disable.

Rebuild the bundled engine after changing the canonical scanner:

```sh
python3 scripts/build-guard-package.py
```

## Upgrading from v0.2.0

Version 0.3.1 includes the fix for the global reference-transaction hook blocking git init, and removes a legacy command launcher that could shadow npm upgrades. After installing v0.3.1, activate the freshly installed package explicitly once:

```sh
node "$(npm root --global)/@imran-webstudio/reposhield-cli/bin/reposhield.mjs" enable
```

Open a new terminal/reload the editor, then check `reposhield --version` reports 0.3.1. Ordinary `reposhield enable` works for subsequent use.

Version 0.2.2 supports `git pull --tags origin main`. Incoming tags are staged privately and scanned before publication; conflicting tags and unsupported non-commit tags block with an explanation. Pulls remain fast-forward only. Error output distinguishes suspicious-code findings from operation/configuration failures; an operation error is not a malware verdict.

## Automatic repair (v0.3.0)

After updating and running `reposhield enable`, opt in once:

```sh
reposhield repair on
reposhield repair status
```

Use `reposhield repair off` to return to blocking without automatic edits or browser handoffs.

**Push:** the Git wrapper can remove supported padding-hidden campaign payloads from a clean checkout's private, linear outgoing commits, preserve other edits/file modes/commit metadata, rescan the reconstructed history and continue the original push. The final pre-push hook scans the actual ref updates again. A recovery ref under `refs/reposhield/recovery/` retains the original local tip; the CLI prints its name. Inspect it with `git show REF` or `git log REF`. Recovery is a manual operation; do not restore an infected snapshot into an active development checkout.

Only a single current-branch push is eligible (`git push`, `git push origin`, `git push origin main`, optional `-u` and common editor display flags and common editor display flags). Complex/multiple refspecs and flags still use the blocking hook. Shared history, another local branch/tag containing outgoing commits, signed commits, merges, dirty checkouts, unknown payloads or scan limits require manual review. Automatic repair never force-pushes. Commit IDs change for repaired private commits and their descendants; the retained original refs must not be published.

**Pull:** when a suspicious-code finding blocks a GitHub pull, the wrapper prints and opens a fixed HTTPS web repair link with repository, branch and pinned SHA only. It does not upload local code, tokens or environment files. Sign in to the web app to inspect the diff, then choose **Repair branch** or **Open repair PR**. Merely opening a link never writes to GitHub. Protected branches can use a PR; preserve its repair commit/footer when merging. Return to the Git client and retry the pull afterward.

The web app uses its existing GitHub session, fetches immutable source from GitHub, and rechecks `expectedHeadOid` when committing. The CLI never trusts a success message: it recomputes the exact complete parent-to-repair tree and independently scans the final snapshot. Only findings tied to those exact repaired blobs and an ancestral repair commit can be accepted in historical incoming commits. Existing infected history is not erased. Tags remain separately scanned and are never whitelisted by a branch repair; use `--no-tags` if you need to pull only a repaired branch while reviewing tags separately. Unsupported findings stay blocked with file and line instructions.

The web app's `/guard/pull` feature must be deployed before enabling browser handoff. Global means the current OS account; configure every GUI client to use the managed Git wrapper.

For a new branch or merge referencing previously published history, the pre-push gate can fetch the same destination into private refs and distinguish already-remote commits from newly uploaded snapshots. It always scans the final tip and every novel commit; a clean tip cannot hide a new infected intermediate commit. Unknown/mismatched destinations and missing coverage remain blocked.

## Sync after a web cleanup (v0.3.1)

With `reposhield repair on`, a normal current-branch push now handles the case where the web app has committed its fix but the local checkout still has the old payload:

```sh
git push origin main
```

If the remote is ahead only by exact, independently verified `padding-tail-v1` repair commits, the guard advances a behind-only checkout to the repair. If you also have private linear local development commits, it removes supported payloads from those snapshots and rebuilds them on top of the verified remote repair. Legitimate local edits and commit metadata are retained, the original tip is retained under a printed recovery ref, and every outgoing snapshot is rescanned before the original push continues. No force push is used.

This is limited to a clean checkout and unshared, unsigned, non-merge local history. Ordinary remote development changes, ambiguous/missing repair receipts, shared local history, unknown payloads or concurrent changes remain blocked for review. An old scan/cleanup in the web app does not edit uncommitted files on a computer. Commit or safely stash unrelated local work before invoking automatic synchronization.
