# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
ENV DATABASE_URL="postgresql://reposhild:reposhild@localhost:5432/reposhild?schema=public"
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://reposhild:reposhild@localhost:5432/reposhild?schema=public"
RUN npx prisma generate && npm run build

FROM node:22-alpine AS migrator
WORKDIR /prisma-cli
COPY package-lock.json ./
RUN PRISMA_VERSION="$(node -p "require('./package-lock.json').packages['node_modules/prisma'].version")" \
  && npm install --omit=dev "prisma@${PRISMA_VERSION}"

FROM node:22-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=migrator --chown=nextjs:nodejs /prisma-cli/node_modules /prisma-cli/node_modules
COPY --chmod=755 --chown=nextjs:nodejs docker-entrypoint.sh ./docker-entrypoint.sh
USER nextjs
EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
