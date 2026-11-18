#!/usr/bin/env node

// Run the published checker against the project from which the CLI was invoked.
await import("../scripts/check-integrity.mjs");
