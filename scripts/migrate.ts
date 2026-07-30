#!/usr/bin/env bun
/**
 * Applies every generated migration in ./drizzle to the SQLite file at
 * $DATABASE_URL (default ./data/movie-voting.db). Idempotent.
 *
 *   bun run db:migrate
 *   DATABASE_URL=/tmp/fresh.db bun run db:migrate
 */

import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { createDb, databaseUrl } from '../src/lib/server/db/index.js';

const url = databaseUrl();
const db = createDb(url);
migrate(db, { migrationsFolder: './drizzle' });
console.log(`migrations applied to ${url}`);
db.$client.close();
