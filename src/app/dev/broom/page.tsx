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
    infected: '"preinstall": "unexpected remote installer command"',
    cleaned: "// preinstall hook removed",
  },
  {
    path: ".vscode/settings.json",
    line: 7,
    infected: '"php.validate.executablePath": "unexpected shell command"',
    cleaned: '"php.validate.executablePath": "/usr/bin/php"',
  },
  {
    path: "eslint.config.js",
    line: 41,
    infected: "obfuscated executable expression",
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
