#!/bin/sh
set -eu
node /prisma-cli/node_modules/prisma/build/index.js migrate deploy --schema=/app/prisma/schema.prisma
exec node server.js
