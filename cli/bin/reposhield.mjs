#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if (!['darwin', 'linux'].includes(process.platform)) {
  console.error('RepoShield global protection currently supports macOS and Linux.');
  process.exit(1);
}
const engine = fileURLToPath(new URL('../lib/reposhield_guard.py', import.meta.url));
const result = spawnSync('/usr/bin/python3', ['-I', '-S', '-B', engine, ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) {
  console.error('RepoShield needs Python 3 at /usr/bin/python3:', result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
