#!/usr/bin/env bun
/**
 * Applies the generated migrations to a *fresh* SQLite file and asserts that
 * every constraint the specs require is enforced by the DATABASE rather than by
 * application code.
 *
 *   bun run db:verify
 *
 * This lives as a Bun script rather than a Vitest test because it needs
 * `bun:sqlite`, which only exists inside the Bun runtime; the Vitest suite is
 * reserved for the pure tally module (see vitest.config.ts).
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { eq } from 'drizzle-orm';
import {
	attendance,
	createDb,
	DEFAULT_GROUP_CONFIG,
	fairness,
	groups,
	members,
	movies,
	newId,
	newInviteToken,
	newRandomSeed,
	pairVotes,
	rounds,
	standingVotes,
	vetoes,
	withConfigDefaults,
	type Db
} from '../src/lib/server/db/index.js';

const dir = mkdtempSync(join(tmpdir(), 'movie-voting-verify-'));
const file = join(dir, 'fresh.db');

let passed = 0;
const failures: string[] = [];

function ok(label: string, fn: () => void) {
	try {
		fn();
		passed++;
		console.log(`  ok  ${label}`);
	} catch (error) {
		failures.push(`${label}: ${(error as Error).message}`);
		console.log(`FAIL  ${label}\n      ${(error as Error).message}`);
	}
}

/** Asserts the callback throws — i.e. the database rejected the write. */
function rejects(label: string, fn: () => void) {
	ok(label, () => {
		let threw = false;
		try {
			fn();
		} catch {
			threw = true;
		}
		assert.equal(threw, true, 'expected the database to reject this write');
	});
}

const db: Db = createDb(file);

console.log(`fresh database: ${file}`);
migrate(db, { migrationsFolder: './drizzle' });
ok('migrations apply to a fresh file', () => assert.equal(existsSync(file), true));
ok('migrations are idempotent (re-run is a no-op)', () =>
	migrate(db, { migrationsFolder: './drizzle' }));

const tables = db.$client
	.query<{ name: string }, []>("select name from sqlite_master where type = 'table' order by name")
	.all()
	.map((row) => row.name)
	.filter((name) => !name.startsWith('__') && !name.startsWith('sqlite_'));
ok('all nine tables exist', () =>
	assert.deepEqual(tables, [
		'attendance',
		'fairness',
		'groups',
		'members',
		'movies',
		'pair_votes',
		'rounds',
		'standing_votes',
		'vetoes'
	]));

ok('foreign keys are ON', () =>
	assert.equal(db.$client.query<{ foreign_keys: number }, []>('pragma foreign_keys').get()?.foreign_keys, 1));
ok('journal mode is WAL', () =>
	assert.equal(
		db.$client.query<{ journal_mode: string }, []>('pragma journal_mode').get()?.journal_mode,
		'wal'
	));

/* --- fixtures ---------------------------------------------------- */

const groupId = newId();
db.insert(groups).values({ id: groupId, name: 'Movie Night', inviteToken: newInviteToken() }).run();

// A config-less ORM insert gets DEFAULT_GROUP_CONFIG injected client-side by
// drizzle's .default(), so the six-knob literal frozen in 0000_init.sql only
// ever reaches rows written by raw SQL. Rows from before the removal of the
// `min_attendee_votes` eligibility floor still carry that key, and no
// migration rewrites them: reads project the blob onto the current knobs, so
// a leftover key is ignored rather than honoured, and the next settings save
// drops it.
ok('group config defaults to all five knobs, ignoring retired keys', () => {
	const row = db.select().from(groups).where(eq(groups.id, groupId)).get();
	assert.deepEqual(withConfigDefaults(row?.config), DEFAULT_GROUP_CONFIG);
	assert.equal(Object.keys(withConfigDefaults(row?.config)).length, 5);

	const legacyId = newId();
	db.run(
		`INSERT INTO groups (id, name, invite_token) VALUES ('${legacyId}', 'Legacy', '${newInviteToken()}')`
	);
	const legacy = db.select().from(groups).where(eq(groups.id, legacyId)).get();
	assert.equal((legacy!.config as unknown as Record<string, unknown>).min_attendee_votes, 3);
	assert.deepEqual(withConfigDefaults(legacy?.config), DEFAULT_GROUP_CONFIG);
	assert.equal('min_attendee_votes' in withConfigDefaults(legacy?.config), false);
});

const ana = newId();
const ben = newId();
db.insert(members).values([
	{ id: ana, groupId, displayName: 'Ana' },
	{ id: ben, groupId, displayName: 'Ben' }
]).run();

const movieIds = [newId(), newId(), newId()].sort();
db.insert(movies).values([
	{ id: movieIds[0], groupId, tmdbId: 1, title: 'A', runtimeMin: 100, suggestedBy: ana },
	{ id: movieIds[1], groupId, tmdbId: 2, title: 'B', runtimeMin: 110, suggestedBy: ben },
	{ id: movieIds[2], groupId, tmdbId: 3, title: 'C', runtimeMin: 120, suggestedBy: ana }
]).run();

const roundId = newId();
db.insert(rounds).values({ id: roundId, groupId, createdBy: ana, randomSeed: newRandomSeed() }).run();

/* --- constraints -------------------------------------------------- */

rejects('members: unique (group_id, display_name)', () =>
	db.insert(members).values({ id: newId(), groupId, displayName: 'Ana' }).run());

rejects('movies: unique (group_id, tmdb_id)', () =>
	db.insert(movies).values({ id: newId(), groupId, tmdbId: 1, title: 'A dup', suggestedBy: ana }).run());

ok('movies: status CHECK rejects unknown status', () => {
	let threw = false;
	try {
		db.$client.run(
			`insert into movies (id, group_id, tmdb_id, title, suggested_by, status) values (?, ?, 99, 'X', ?, 'bogus')`,
			[newId(), groupId, ana]
		);
	} catch {
		threw = true;
	}
	assert.equal(threw, true);
});

db.insert(standingVotes).values({ memberId: ana, movieId: movieIds[0], value: 'yes' }).run();
rejects('standing_votes: unique (member_id, movie_id)', () =>
	db.insert(standingVotes).values({ memberId: ana, movieId: movieIds[0], value: 'no' }).run());
ok('standing_votes: upsert on the unique key is idempotent', () => {
	db.insert(standingVotes)
		.values({ memberId: ana, movieId: movieIds[0], value: 'no' })
		.onConflictDoUpdate({ target: [standingVotes.memberId, standingVotes.movieId], set: { value: 'no' } })
		.run();
	const rows = db.select().from(standingVotes).where(eq(standingVotes.memberId, ana)).all();
	assert.equal(rows.length, 1);
	assert.equal(rows[0].value, 'no');
});

db.insert(attendance).values({ roundId, memberId: ana, attending: true, updatedBy: ana }).run();
rejects('attendance: unique (round_id, member_id)', () =>
	db.insert(attendance).values({ roundId, memberId: ana, attending: false, updatedBy: ben }).run());
ok('attendance: records who set the RSVP (proxy RSVP)', () => {
	db.insert(attendance).values({ roundId, memberId: ben, attending: true, updatedBy: ana }).run();
	const row = db.select().from(attendance).where(eq(attendance.memberId, ben)).get();
	assert.equal(row?.updatedBy, ana);
	assert.equal(row?.runoffSubmittedAt, null);
});

ok('vetoes: movie_id may be null (explicit "no veto")', () =>
	db.insert(vetoes).values({ roundId, memberId: ana, movieId: null }).run());
rejects('vetoes: unique (round_id, member_id)', () =>
	db.insert(vetoes).values({ roundId, memberId: ana, movieId: movieIds[0] }).run());

const [lo, hi] = [movieIds[0], movieIds[1]];
db.insert(pairVotes).values({ roundId, memberId: ana, movieAId: lo, movieBId: hi, winnerId: lo }).run();
rejects('pair_votes: unique (round_id, member_id, pair)', () =>
	db.insert(pairVotes).values({ roundId, memberId: ana, movieAId: lo, movieBId: hi, winnerId: hi }).run());
rejects('pair_votes: CHECK rejects an un-normalised pair (b, a)', () =>
	db.insert(pairVotes).values({ roundId, memberId: ben, movieAId: hi, movieBId: lo, winnerId: lo }).run());
rejects('pair_votes: CHECK rejects a winner outside the pair', () =>
	db.insert(pairVotes).values({ roundId, memberId: ben, movieAId: lo, movieBId: hi, winnerId: movieIds[2] }).run());
ok('pair_votes: winner_id may be null (explicit no preference)', () =>
	db.insert(pairVotes).values({ roundId, memberId: ben, movieAId: lo, movieBId: hi, winnerId: null }).run());

rejects('rounds: at most one round per group before `decided`', () =>
	db.insert(rounds).values({ id: newId(), groupId, createdBy: ana }).run());
ok('rounds: partial index allows a new round once the old one is decided', () => {
	db.update(rounds).set({ state: 'decided' }).where(eq(rounds.id, roundId)).run();
	const second = newId();
	db.insert(rounds).values({ id: second, groupId, createdBy: ana }).run();
	// ...and abandoning also frees the group.
	db.update(rounds).set({ state: 'abandoned' }).where(eq(rounds.id, second)).run();
	const third = newId();
	db.insert(rounds).values({ id: third, groupId, createdBy: ana, state: 'runoff' }).run();
	// a `runoff` round still blocks a new one
	let threw = false;
	try {
		db.insert(rounds).values({ id: newId(), groupId, createdBy: ana }).run();
	} catch {
		threw = true;
	}
	assert.equal(threw, true, '`runoff` must still count as active');
	db.update(rounds).set({ state: 'decided' }).where(eq(rounds.id, third)).run();
});

ok('rounds: random_seed defaults into the uint32 domain', () => {
	const id = newId();
	db.insert(rounds).values({ id, groupId, createdBy: ana }).run();
	const seed = db.select().from(rounds).where(eq(rounds.id, id)).get()!.randomSeed;
	assert.equal(Number.isInteger(seed), true);
	assert.equal(seed >= 0 && seed < 2 ** 32, true);
	db.update(rounds).set({ state: 'abandoned' }).where(eq(rounds.id, id)).run();
});

ok('rounds: finalist_ids round-trips as JSON', () => {
	const id = newId();
	db.insert(rounds).values({ id, groupId, createdBy: ana, finalistIds: movieIds, state: 'decided' }).run();
	assert.deepEqual(db.select().from(rounds).where(eq(rounds.id, id)).get()?.finalistIds, movieIds);
});

ok('fairness: one row per member, never-won is null', () => {
	db.insert(fairness).values({ memberId: ana, lastWinRoundId: null, lastWinAt: null, winsCount: 0 }).run();
	const row = db.select().from(fairness).where(eq(fairness.memberId, ana)).get();
	assert.equal(row?.lastWinAt, null);
	assert.equal(row?.winsCount, 0);
});
rejects('fairness: primary key is member_id', () =>
	db.insert(fairness).values({ memberId: ana }).run());

rejects('foreign keys are enforced (unknown member_id)', () =>
	db.insert(standingVotes).values({ memberId: 'nope', movieId: movieIds[0], value: 'yes' }).run());

db.$client.close();
rmSync(dir, { recursive: true, force: true });

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length > 0) process.exit(1);
