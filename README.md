# RepoShield CLI

RepoShield is a Node.js pre-startup malware guard for JavaScript and TypeScript repositories. It scans a project before `npm run dev`, `npm start`, or `npm run build` can launch application code.

It is designed for supply-chain and repository-injection patterns associated with the PolinRider malware campaign, including obfuscated JavaScript appended to config files, extensionless `init` droppers, malicious package scripts, remote shell pipes, encoded PowerShell, VS Code task abuse, and suspicious payload filenames.

## Install

```bash
npm install --save-dev reposhield-cli
```

The executable remains short:

```bash
npx reposhield
```

## Enable automatic protection

If npm allows install scripts, the package adds these hooks automatically:

```json
{
  "scripts": {
    "predev": "reposhield",
    "prestart": "reposhield",
    "prebuild": "reposhield"
  }
}
```

If your npm configuration blocks dependency install scripts, enable the package and run setup manually:

```bash
npm install-scripts approve reposhield-cli
node node_modules/reposhield-cli/bin/install-hooks.mjs
```

You can also add the hooks yourself. Verify them with:

```bash
npm pkg get scripts
```

## What it detects

- Extensionless files named `init`, `api.js`, or other known dropper names.
- Obfuscated JavaScript markers such as `_0x...`, `eval`, `Function`, and hidden payload tails.
- `curl` or `wget` piped into a shell.
- Encoded PowerShell and base64-to-shell execution.
- Package-script hijacking in `package.json`.
- Suspicious executable config and workflow payloads.
- VS Code task and `.gitignore` tricks used to hide or automatically execute code.

## What happens when a finding is found

RepoShield prints the file and line number, blocks the startup command, and asks:

```text
Remove these detected payloads and continue? [y/N]
```

Known dropper files such as `init` are removed completely after confirmation. For ambiguous findings, answer `N` and review the code manually. RepoShield never executes the detected payload to inspect it.

## Limitations

RepoShield is a fast, local, pattern-based guard—not a complete antivirus engine or a guarantee that a repository is clean. It does not replace dependency auditing, lockfile review, secret rotation, endpoint investigation, or a full malware-analysis workflow. Do not automatically delete files you have not reviewed in a production repository.

## Commands

```bash
npx reposhield                 # scan the current project
npm run dev                    # scan first when predev is configured
npm start                      # scan first when prestart is configured
npm run build                  # scan first when prebuild is configured
```

## Search terms

PolinRider malware scanner, PolinRider cleanup, PolinRider repository infection, npm malware scanner, JavaScript malware detector, Node.js supply-chain security, malicious `init` file detector, obfuscated config payload detector, predev security check, repository malware cleanup.

## License

MIT
