/**
 * SQLite connection, via Drizzle on Bun's built-in `bun:sqlite` driver.
 *
 * One file, WAL mode, foreign keys on. The database is opened lazily so that
 * importing the schema (in scripts, tests, or drizzle-kit) never has the side
 * effect of creating a file.
 */

import { Database } from 'bun:sqlite';
import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as schema from './schema.js';

export * from './schema.js';
export * from './config.js';
export * from './ids.js';
export { schema };

export type Db = BunSQLiteDatabase<typeof schema> & { $client: Database };

export const DEFAULT_DATABASE_URL = './data/movie-voting.db';

export function databaseUrl(): string {
	return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/** Opens a connection and applies the pragmas the app relies on. */
export function createDb(url: string = databaseUrl()): Db {
	if (url !== ':memory:') mkdirSync(dirname(url), { recursive: true });
	const sqlite = new Database(url, { create: true });
	// WAL: concurrent readers while a writer commits — the app-spec's choice.
	sqlite.exec('PRAGMA journal_mode = WAL;');
	// SQLite defaults foreign keys OFF per connection; the schema depends on them.
	sqlite.exec('PRAGMA foreign_keys = ON;');
	sqlite.exec('PRAGMA busy_timeout = 5000;');
	sqlite.exec('PRAGMA synchronous = NORMAL;');
	return drizzle(sqlite, { schema }) as Db;
}

let singleton: Db | undefined;

/** The process-wide connection. One small server, one file. */
export function getDb(): Db {
	singleton ??= createDb();
	return singleton;
}
