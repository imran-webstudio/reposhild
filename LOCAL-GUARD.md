# Local Git protection

**Recommended:** install the global CLI with `npm install --global --ignore-scripts ./cli`, then run `reposhield enable`. See [cli/README.md](cli/README.md). The per-repository installation below remains available for selective protection. Global enable handles new repositories automatically through its Git wrapper and global push hook.

RepoShield's website scans GitHub data. Blocking commands on a workstation requires this local guard. The guard uses Python 3's standard library and the system Git; it never installs packages or imports/runs repository JavaScript. It is a targeted campaign detector, not antivirus or a security boundary against an attacker already controlling your account or host.

## Install in each repository

Keep the runtime outside every checkout you protect. Otherwise a pull could replace the protection itself.

```sh
cd /absolute/path/to/repository
/usr/bin/python3 /absolute/path/to/reposhild/scripts/reposhield_guard.py install --runtime /absolute/path/to/trusted-reposhield-runtime
```

The installer copies the guard to that runtime and installs a repository-local pre-push hook. Existing hooks are preserved and delegated to; pre-push scanning happens before the old pre-push hook. Installation metadata is in the Git common directory's `reposhield-install.json`. Installation does not modify remote GitHub repositories, rewrite history, revoke credentials or install npm.

For ordinary terminal `git pull` and `git push`, prepend the shim directory to PATH in your shell configuration:

```sh
export PATH=/absolute/path/to/trusted-reposhield-runtime/bin:"$PATH"
```

Start a new terminal and run `command -v git` to verify it resolves to the shim. The shim accepts `-C`, common display/locking options, a narrow allowlist of harmless editor configuration overrides and ordinary Git subcommands. It rejects unsupported global options instead of allowing configuration overrides to bypass the guard. `git pull` uses the configured upstream; `git pull origin main` is explicit. Pulls support fast-forward only. The shim refuses `push --no-verify` and refuses pushes from repositories without its installed pre-push hook.

An IDE must use the shim as its Git executable to intercept its pulls. Native pre-push hooks protect ordinary pushes from Git clients that honor hooks, but raw `/usr/bin/git pull`, GUI clients using another Git implementation, configuration overrides and `--no-verify` can bypass client-side controls. Git has no universal pre-pull hook. No website or local hook can promise to intercept all clients. Server-side required checks/rulesets are needed for team-wide enforcement; ordinary Actions checks run after a push and do not themselves prevent receiving a malicious commit.

## Scan and pull explicitly

```sh
/usr/bin/python3 /absolute/path/to/trusted-reposhield-runtime/reposhield_guard.py scan HEAD
/usr/bin/python3 /absolute/path/to/trusted-reposhield-runtime/reposhield_guard.py pull origin main
```

Push checks inspect immutable committed objects from the actual pre-push ref updates, not just the working tree. They scan each outgoing commit and its full tree, including intermediate commits, extensionless scripts and font files. Deletion-only updates are allowed. Missing remote base objects, unreadable objects, unsupported submodules and scan limits block the operation; they are never called clean. A new branch with an infected historical commit is blocked even when its tip is clean. Audit/rewrite that history separately; do not bypass the gate to upload malware. A cleanup commit replacing an already-remote infected base is permitted if all newly outgoing snapshots are clean.

Guarded pull requires a clean working tree. It fetches one explicit branch into a private temporary ref with tags, FETCH_HEAD writes, submodule recursion and repository hooks disabled. It scans the final snapshot and incoming commit snapshots, accepting historical findings only when their exact repaired blobs and complete cleanup tree are independently verified, verifies that HEAD and the working tree did not change during inspection, and performs only a fast-forward to the exact scanned SHA. A blocked pull leaves HEAD and the working tree unchanged; downloaded Git objects may remain until normal Git garbage collection. Custom transport commands, shell credential helpers and filter/merge attributes require manual review to avoid executing configured drivers during checkout. Other Git commands, including switch, checkout, merge, reset and worktree creation, are not automatically scanned by the shim.

Each finding prints escaped JSON with `path`, `line`, `rule`, `instruction` and `commit`. Payload source is not printed or executed. Review the listed file and line, quarantine fake fonts/dropper files, restore a verified clean version or carefully remove an appended loader, review the diff and scan the new commit. Without opt-in repair, the gate never edits code. Version 0.3.0 adds `reposhield repair on`: see cli/README.md for precise supported push repairs and authenticated pull handoff. It never force-pushes.

Limits: 8 MiB per blob, 128 MiB total unique path/blob data per operation, 30,000 files per tree and 500 outgoing/incoming commits. Exceeding a limit blocks the operation. Signatures can miss new malware and can flag benign content. Test fixtures containing literal payloads may require review rather than blanket exclusions. One manually reviewed RepoShield fixture is exempted only at its exact path and SHA-256; changing or appending any bytes removes that exemption.

## Mac recovery after this incident

The known downloader and infected npm installation were quarantined and the identified processes terminated. Do not restore those quarantined files, copy old node_modules or reinstall tools using the compromised installation. Replace Node/npm from a trusted distribution only after credential containment. Use an updated phone/tablet to revoke GitHub tokens, exposed SSH keys, unrecognized apps/sessions and other exposed service credentials if no computer is trusted. Do not issue replacement credentials to this Mac yet.

Clean every affected remote branch and executable init script before cloning/running them again. CI runners, deployed build environments and other developer devices that executed infected configs need their own response. A targeted scan cannot establish complete host cleanliness; trusted erase/reinstall remains the strongest recovery option, but restoring infected code afterward can reinfect it.

## Tests

```sh
/usr/bin/python3 -B -m unittest discover -s scripts -p test_reposhield_guard.py
```

Tests use disposable local/bare Git repositories, synthetic never-executed payloads and the standard library. They verify actual push rejection, prior-hook delegation, infected pull rejection without checkout, successful clean fast-forward, dirty-tree refusal, intermediate-commit scanning, missing-base/size failures, fake-font handling and shim bypass refusal.

## Uninstall

Read `.git/reposhield-install.json` (or the common Git directory for worktrees). Restore its `previous_local_hooks_path` with `git config --local core.hooksPath VALUE`, or unset the local setting if it was null. Use `/usr/bin/git` for that administrative operation. Remove the PATH block from your shell configuration. Keep the runtime until all repositories have been restored; do not delete a runtime that active hooks still reference.

## Repair workflow

See [cli/README.md](cli/README.md#automatic-repair-v030) for automatic private push repair, recovery refs, web pull handoff and independently verified historical repairs. The web route never writes on GET or trusts a repair patch submitted by the browser. Unknown findings and infected tags stay blocked.
