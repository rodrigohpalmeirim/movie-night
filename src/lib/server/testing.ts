/**
 * Integration-test harness: a real SQLite file with the real migrations applied.
 *
 * Nothing is mocked except TMDB (network) — the point of these tests is that the
 * constraints, conditional updates and snapshots behave against actual SQLite.
 */

import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
	createDb,
	groups,
	movies as moviesTable,
	newId,
	withConfigDefaults,
	type Db,
	type Group,
	type GroupConfig,
	type Member,
	type Movie,
	type MovieDetails
} from './db/index.js';
import type { ActorContext } from './context.js';
import { claimMember, createGroup } from './services/groups.js';
import { unwrap } from './result.js';
import { TmdbClient } from './tmdb.js';

export interface TestWorld {
	db: Db;
	group: Group;
	config: GroupConfig;
	members: Member[];
	movies: Movie[];
	member(displayName: string): Member;
	movie(title: string): Movie;
	actor(displayName: string, now?: Date): ActorContext;
	/** Re-reads the group row (invite token / config may have changed). */
	reloadGroup(): Group;
	cleanup(): void;
}

export interface SeedMovie {
	title: string;
	runtimeMin?: number | null;
	suggestedBy?: string;
	status?: Movie['status'];
	watchedAt?: Date | null;
	/** Left null by default: a seeded pool is a pool the backfill has not reached. */
	details?: MovieDetails | null;
}

let tmdbCounter = 0;

export const BASE_NOW = new Date('2026-07-30T18:00:00Z');

export function createTestWorld(input: {
	memberNames: string[];
	movies?: SeedMovie[];
	config?: Partial<GroupConfig>;
	now?: Date;
}): TestWorld {
	const dir = mkdtempSync(join(tmpdir(), 'movie-voting-itest-'));
	const db = createDb(join(dir, 'test.db'));
	migrate(db, { migrationsFolder: './drizzle' });

	const now = input.now ?? BASE_NOW;
	const created = unwrap(createGroup(db, { name: 'Movie Night', memberName: input.memberNames[0], now }));
	const members: Member[] = [created.member];
	for (const [index, name] of input.memberNames.slice(1).entries()) {
		// Stagger join dates so rotation fairness has a deterministic order.
		members.push(
			unwrap(
				claimMember(db, {
					groupId: created.group.id,
					name,
					now: new Date(now.getTime() + (index + 1) * 1000)
				})
			)
		);
	}

	if (input.config) {
		const merged = { ...withConfigDefaults(created.group.config), ...input.config };
		db.update(groups).set({ config: merged }).where(eq(groups.id, created.group.id)).run();
	}

	const reload = () => db.select().from(groups).where(eq(groups.id, created.group.id)).get()!;
	let group = reload();

	const world: TestWorld = {
		db,
		group,
		config: withConfigDefaults(group.config),
		members,
		movies: [],
		member(displayName) {
			const found = members.find((m) => m.displayName === displayName);
			if (!found) throw new Error(`no member named ${displayName}`);
			return found;
		},
		movie(title) {
			const found = world.movies.find((m) => m.title === title);
			if (!found) throw new Error(`no movie titled ${title}`);
			return found;
		},
		actor(displayName, at) {
			return {
				db,
				group: world.group,
				config: world.config,
				member: world.member(displayName),
				now: at ?? now
			};
		},
		reloadGroup() {
			group = reload();
			world.group = group;
			world.config = withConfigDefaults(group.config);
			return group;
		},
		cleanup() {
			db.$client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	};

	for (const seed of input.movies ?? []) {
		world.movies.push(
			db
				.insert(moviesTable)
				.values({
					id: newId(),
					groupId: group.id,
					tmdbId: 1000 + tmdbCounter++,
					title: seed.title,
					year: 2020,
					runtimeMin: seed.runtimeMin === undefined ? 100 : seed.runtimeMin,
					posterPath: `/${seed.title}.jpg`,
					details: seed.details ?? null,
					detailsFetchedAt: seed.details ? now : null,
					suggestedBy: world.member(seed.suggestedBy ?? input.memberNames[0]).id,
					addedAt: now,
					status: seed.status ?? 'pool',
					watchedAt: seed.watchedAt ?? null
				})
				.returning()
				.get()
		);
	}

	return world;
}

/**
 * A TMDB client backed by a canned catalogue, so no test touches the network.
 * `configured` is true here; the 503 path is exercised with a client that has no
 * API key at all.
 */
export interface CatalogueEntry {
	title: string;
	runtime: number | null;
	year?: number;
	/**
	 * Raw `append_to_response` blocks (`videos`, `credits`, `release_dates`)
	 * merged into the detail payload, so a test can hand the extraction real
	 * TMDB-shaped extras — or, by leaving it out, prove a bare payload is fine.
	 */
	extras?: Record<string, unknown>;
}

export function fakeTmdb(
	catalogue: Record<number, CatalogueEntry>,
	options: { failWith?: number; onDetail?: (tmdbId: number) => void } = {}
): TmdbClient {
	return new TmdbClient({
		apiKey: 'test-key',
		certCountry: 'PT',
		fetchImpl: async (input) => {
			const url = String(input);
			if (options.failWith) return new Response('nope', { status: options.failWith });

			const detail = url.match(/\/movie\/(\d+)/);
			if (detail) {
				options.onDetail?.(Number(detail[1]));
				const entry = catalogue[Number(detail[1])];
				if (!entry) return new Response('{}', { status: 404 });
				return Response.json({
					id: Number(detail[1]),
					title: entry.title,
					release_date: `${entry.year ?? 2021}-05-01`,
					poster_path: `/p${detail[1]}.jpg`,
					runtime: entry.runtime,
					...entry.extras
				});
			}

			const query = new URL(url).searchParams.get('query')?.toLowerCase() ?? '';
			return Response.json({
				results: Object.entries(catalogue)
					.filter(([, entry]) => entry.title.toLowerCase().includes(query))
					.map(([id, entry]) => ({
						id: Number(id),
						title: entry.title,
						release_date: `${entry.year ?? 2021}-05-01`,
						poster_path: `/p${id}.jpg`,
						overview: ''
					}))
			});
		}
	});
}

/**
 * Recursively collects every key present in a payload, so the hidden-tallies test
 * can prove an aggregate appears *nowhere* rather than spot-checking the handful
 * of fields a test author happened to think of.
 */
export function collectKeys(value: unknown, into = new Set<string>()): Set<string> {
	if (Array.isArray(value)) {
		for (const item of value) collectKeys(item, into);
	} else if (value !== null && typeof value === 'object') {
		for (const [key, child] of Object.entries(value)) {
			into.add(key);
			collectKeys(child, into);
		}
	}
	return into;
}

/**
 * Key names that may only appear behind a completed reveal.
 *
 * Deliberately broad, and deliberately including `winner` / `winnerId`: before a
 * reveal, the only place those may legitimately appear is inside the viewer's OWN
 * `me` block, which the test strips before scanning. If a future field genuinely
 * needs one of these names pre-decided, that is a conversation, not a test to
 * loosen.
 */
export const AGGREGATE_KEYS = [
	'approval',
	'coverage',
	'yesVotes',
	'noVotes',
	// A star count is an aggregate like any other. The viewer's own star travels as
	// `myStarred` (inside `me`, or beside `myVote` on the pool screen), which is
	// their own answer and never gated.
	'starVotes',
	'attendeeVotes',
	'tallies',
	'matrix',
	'aWins',
	'bWins',
	'noPreference',
	'copeland',
	'condorcetWinnerId',
	'counts',
	'vetoCounts',
	'disqualifiedIds',
	'survivingIds',
	'vetoesIgnored',
	'effectiveVetoes',
	'tiebreakRuleUsed',
	'randomSeed',
	'byMember',
	'winner',
	'winnerId'
] as const;
