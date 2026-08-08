# Movie Night — SvelteKit built with svelte-adapter-bun, served by Bun.
#
# The adapter emits a standalone server at ./build/index.js. Vite inlines the
# app's own code, but the server chunks still import `drizzle-orm` (and Bun's
# built-in `bun:sqlite`), so the runtime stage carries production node_modules.
#
# Migrations are NOT applied when the app boots — nothing in src/ calls the
# migrator — so scripts/migrate.ts is bundled alongside the server and runs
# once before it, against ./drizzle. Idempotent, so restarts are cheap.

FROM oven/bun:1.3.14-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build \
	&& bun build scripts/migrate.ts --target=bun --outfile build/migrate.js

# Production dependencies only (drizzle-orm).
FROM oven/bun:1.3.14-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY drizzle ./drizzle
COPY package.json ./

# The SQLite file belongs on a mounted volume; the app creates it on first run.
ENV DATABASE_URL=/data/movie-voting.db
RUN mkdir -p /data && chown bun:bun /data
VOLUME /data

# HOST/PORT the adapter binds to. ORIGIN (or PROTOCOL_HEADER/HOST_HEADER behind
# a proxy) is required at run time or every form POST fails CSRF — see
# .env.example.
ENV HOST=0.0.0.0 \
	PORT=3000
EXPOSE 3000

USER bun

CMD ["sh", "-c", "bun ./build/migrate.js && exec bun ./build/index.js"]
