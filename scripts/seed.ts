#!/usr/bin/env bun
/**
 * Dev seed: one fully-populated demo group at a stable URL.
 *
 *   bun run seed
 *   DATABASE_URL=/tmp/scratch.db bun run seed
 *
 * Creates "Movie Club" behind the fixed invite token `dev-movie-club`, so the
 * dev URL never changes: http://localhost:5173/g/dev-movie-club
 *
 * What it builds
 *   - 5 members with staggered join dates (rotation fairness measures never-won
 *     members from their join date, so the dates have to differ).
 *   - 12 pool movies + 1 removed + 2 watched, all from HARDCODED TMDB fixtures.
 *     Nothing here touches the TMDB API: the movies go in through the real
 *     `suggestMovie` service with a `TmdbClient` whose `fetchImpl` serves the
 *     fixtures, so ids, titles, years, runtimes and poster paths are real and
 *     posters render, but the script works offline and with no API key.
 *   - 2 finished nights (state `watched`) driven through the actual lifecycle —
 *     RSVP, finalists, vetoes, a full pairwise round robin, reveal, "we watched
 *     it" — so their reveal data and the fairness counters are consistent by
 *     construction rather than by hand-written rows.
 *   - Tonight's round, left in OPEN with 3 of 5 RSVPed and a standing-vote
 *     spread engineered to exercise the interesting tally edges (see
 *     TONIGHT below). The script then runs `planAdvance` WITHOUT applying it and
 *     asserts those edges really hold, so a broken fixture fails loudly here
 *     instead of looking plausible in the UI.
 *
 * Idempotent: re-running deletes and recreates only the group whose invite token
 * is `dev-movie-club`. Every other group in the database is left alone.
 *
 * Everything that can go through a service does. The three exceptions, each
 * unavoidable and each satisfying the constraints it touches by hand:
 *   1. pinning the invite token (no service sets a chosen token — only
 *      `regenerateInviteToken`, which picks a random one);
 *   2. deleting standing votes (absence of a row is the third state, "not yet
 *      seen", and no service can produce it);
 *   3. the wipe, which deletes in FK order.
 */

import assert from 'node:assert/strict';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import {
	createDb,
	databaseUrl,
	fairness,
	groups,
	members,
	movies,
	rounds,
	standingVotes,
	withConfigDefaults,
	type Db,
	type Member,
	type Movie
} from '../src/lib/server/db/index.js';
import { findGroupByToken } from '../src/lib/server/context.js';
import { unwrap } from '../src/lib/server/result.js';
import { claimMember, createGroup } from '../src/lib/server/services/groups.js';
import { removeMovie, setStandingVote, suggestMovie } from '../src/lib/server/services/movies.js';
import {
	advanceRound,
	castPairVote,
	castVeto,
	createRound,
	markWatched,
	planAdvance,
	setRsvp
} from '../src/lib/server/services/rounds.js';
import { TmdbClient } from '../src/lib/server/tmdb.js';

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const INVITE_TOKEN = 'dev-movie-club';
const GROUP_NAME = 'Movie Club';

const MEMBER_NAMES = ['Ana', 'Ben', 'Cal', 'Dee', 'Eve'] as const;
type MemberName = (typeof MEMBER_NAMES)[number];

/**
 * Join dates, in days before now. They must differ: rotation fairness ranks a
 * never-won member by join date, and tonight's finalist boundary leans on that
 * ordering (Cal has waited longest, Ana won most recently).
 */
const JOINED_DAYS_AGO: Record<MemberName, number> = { Ana: 90, Ben: 88, Cal: 60, Dee: 45, Eve: 20 };

interface Fixture {
	title: string;
	year: number;
	/** Real TMDB id — the same id the search proxy would have returned. */
	tmdbId: number;
	/** Real runtime: it feeds tiebreak rule 4 and one boundary tie depends on it. */
	runtimeMin: number;
	/** Real TMDB poster path, so `image.tmdb.org` actually serves artwork. */
	posterPath: string;
	suggestedBy: MemberName;
	/** Suggested this many days ago. Never before the suggester joined. */
	addedDaysAgo: number;
}

const FIXTURES: Fixture[] = [
	// Added early enough to be in play for the first night.
	{ title: 'The Thing', year: 1982, tmdbId: 1091, runtimeMin: 109, posterPath: '/tzGY49kseSE9QAKk47uuDGwnSCu.jpg', suggestedBy: 'Ben', addedDaysAgo: 85 },
	{ title: 'Spider-Man: Into the Spider-Verse', year: 2018, tmdbId: 324857, runtimeMin: 117, posterPath: '/iiZZdoQBEYBv6id8su7ImL0oCbD.jpg', suggestedBy: 'Ana', addedDaysAgo: 80 },
	{ title: 'The Matrix', year: 1999, tmdbId: 603, runtimeMin: 136, posterPath: '/f89U3ADr1oiB1s9GkdPOEpXUk5H.jpg', suggestedBy: 'Cal', addedDaysAgo: 78 },
	{ title: 'Pulp Fiction', year: 1994, tmdbId: 680, runtimeMin: 154, posterPath: '/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg', suggestedBy: 'Ben', addedDaysAgo: 75 },
	{ title: 'Spirited Away', year: 2001, tmdbId: 129, runtimeMin: 125, posterPath: '/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg', suggestedBy: 'Cal', addedDaysAgo: 70 },
	{ title: 'Mad Max: Fury Road', year: 2015, tmdbId: 76341, runtimeMin: 120, posterPath: '/hA2ple9q4qnwxp3hKVNhroipsir.jpg', suggestedBy: 'Ben', addedDaysAgo: 66 },
	{ title: 'Parasite', year: 2019, tmdbId: 496243, runtimeMin: 132, posterPath: '/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg', suggestedBy: 'Ana', addedDaysAgo: 50 },
	// The long-runtime half of tonight's boundary tie.
	{ title: 'Blade Runner 2049', year: 2017, tmdbId: 335984, runtimeMin: 164, posterPath: '/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg', suggestedBy: 'Dee', addedDaysAgo: 44 },
	{ title: 'Portrait of a Lady on Fire', year: 2019, tmdbId: 531428, runtimeMin: 122, posterPath: '/2LquGwEYPeeIzabnhcpEuwMBEDL.jpg', suggestedBy: 'Cal', addedDaysAgo: 30 },
	{ title: 'Everything Everywhere All at Once', year: 2022, tmdbId: 545611, runtimeMin: 139, posterPath: '/w3LxiVYdWWRvEVdn5RYq6jIqkb1.jpg', suggestedBy: 'Dee', addedDaysAgo: 25 },
	{ title: 'Arrival', year: 2016, tmdbId: 329865, runtimeMin: 116, posterPath: '/x2FJsf1ElAgr63Y3PNPtJrcmpoe.jpg', suggestedBy: 'Ana', addedDaysAgo: 22 },
	// The short-runtime half of tonight's boundary tie.
	{ title: 'Whiplash', year: 2014, tmdbId: 244786, runtimeMin: 106, posterPath: '/7fn624j5lj3xTme2SgiLCeuedmO.jpg', suggestedBy: 'Eve', addedDaysAgo: 19 },
	{ title: 'Alien', year: 1979, tmdbId: 348, runtimeMin: 117, posterPath: '/vfrQk5IPloGg1v9Rzbh2Eg3VGyM.jpg', suggestedBy: 'Eve', addedDaysAgo: 10 },
	// The joke suggestion, removed further down.
	{ title: 'Cats', year: 2019, tmdbId: 458723, runtimeMin: 110, posterPath: '/aCnF5Z05a1ykfsvS68mFWCGtI13.jpg', suggestedBy: 'Ben', addedDaysAgo: 8 },
	// Nobody has swiped this one — it is everyone's top-up stack.
	{ title: 'Coco', year: 2017, tmdbId: 354912, runtimeMin: 105, posterPath: '/gGEsBPAijhVUFoiNpgZXqRVWJt2.jpg', suggestedBy: 'Eve', addedDaysAgo: 5 }
];

/**
 * A group's standing votes as they stood on one night: one row per movie, one
 * character per member in MEMBER_NAMES order.
 *
 *   y = yes, n = no, . = no row at all ("not yet seen" — the third state)
 *
 * A whole matrix per night is deliberate. Standing votes are permanent but
 * *revisable*, so the honest way to seed three nights is to state what the pool
 * looked like on each of them; the finished nights keep their own frozen
 * `standing_snapshot`, so rewriting the live layer afterwards cannot disturb
 * their reveals — which is exactly the invariant this fixture demonstrates.
 */
type VoteMatrix = Record<string, string>;

/** Night 1, 41 days ago. 4 attendees (Eve had not joined yet). */
const NIGHT_1: VoteMatrix = {
	//                                    Ana Ben Cal Dee Eve
	'The Thing': /*                    */ 'yyyy.',
	'The Matrix': /*                   */ 'yyyn.',
	'Pulp Fiction': /*                 */ 'yyny.',
	'Spirited Away': /*                */ 'ynyy.',
	'Mad Max: Fury Road': /*           */ 'nyyy.',
	// 3 of 4 saw it, only 1 yes: eligible, but below the approval floor.
	'Blade Runner 2049': /*            */ 'nny..',
	// 2 of 4: below the coverage floor, so it waits for the next round — and
	// then wins it.
	'Spider-Man: Into the Spider-Verse': 'y..y.',
	Parasite: /*                       */ '..yy.'
};

/** Night 2, 16 days ago. All 5 attend. */
const NIGHT_2: VoteMatrix = {
	//                                    Ana Ben Cal Dee Eve
	'Spider-Man: Into the Spider-Verse': 'yyyyy',
	Parasite: /*                       */ 'yyyyn',
	'Portrait of a Lady on Fire': /*   */ 'yynyn',
	'Everything Everywhere All at Once': 'yyyn.',
	'Mad Max: Fury Road': /*           */ 'ynyny',
	// Approval of exactly 0.5 — the floor is inclusive, so this one is a
	// candidate and misses the finalist cut on yes-votes alone.
	'Pulp Fiction': /*                 */ 'ynny.',
	'The Matrix': /*                   */ 'nnyn.',
	'Blade Runner 2049': /*            */ 'nnynn',
	'Spirited Away': /*                */ 'ny...',
	Arrival: /*                        */ 'yy...',
	Whiplash: /*                       */ 'y..y.'
};

/**
 * Tonight. Attendees are Ana, Ben and Cal, which makes the floors bite at:
 *   coverage_floor 0.6 → at least 2 of 3 attendee votes
 *   min_attendee_votes 3 → all 3 attendees must have swiped it
 *   approval_floor 0.5 → at least 2 yes of 3
 *
 * The engineered edges, all asserted at the bottom of this script:
 *   - Parasite alone has 3 yes → the clear rank 1.
 *   - FIVE movies sit on exactly 2 yes of 3, competing for the 4 remaining
 *     finalist slots: a genuine tie at the finalist boundary. Approval cannot
 *     separate them (2/3 each), so rotation fairness ranks them by suggester —
 *     Cal (never won, joined earliest) > Ben (won night 1) > Ana (won night 2) >
 *     Dee and Eve, who are not attending and therefore have no fairness claim at
 *     all. That leaves Whiplash (Eve) and Blade Runner 2049 (Dee) tied on every
 *     rung down to runtime, where 106 min beats 164 min. The boundary is
 *     decided by `shortest_runtime` and the reveal will say so.
 *   - Alien: 1 of 3 → below the coverage floor.
 *   - Coco: 0 of 3 → below the coverage floor, and everyone's swipe stack.
 *   - Everything Everywhere and Portrait: 2 of 3 → clear coverage (0.67 ≥ 0.6)
 *     but fail MIN_ATTENDEE_VOTES, which is a different and separately reported
 *     reason.
 *   - Pulp Fiction: fully swiped, 1 yes of 3 → eligible, below the approval
 *     floor. The Matrix is the same with 0 yes.
 */
const TONIGHT: VoteMatrix = {
	//                                    Ana Ben Cal Dee Eve
	Parasite: /*                       */ 'yyyyn',
	'Spirited Away': /*                */ 'nyyy.',
	'Mad Max: Fury Road': /*           */ 'yynny',
	Arrival: /*                        */ 'yny.y',
	Whiplash: /*                       */ 'nyyyy',
	'Blade Runner 2049': /*            */ 'yynyn',
	'Pulp Fiction': /*                 */ 'nynyn',
	'The Matrix': /*                   */ 'nnnyy',
	Alien: /*                          */ 'n..y.',
	'Everything Everywhere All at Once': 'yy..y',
	'Portrait of a Lady on Fire': /*   */ 'y.yy.',
	Coco: /*                           */ '.....'
};

/* ------------------------------------------------------------------ */
/* Clock                                                              */
/* ------------------------------------------------------------------ */

const NOW = new Date();
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS);

/* ------------------------------------------------------------------ */
/* Offline TMDB                                                        */
/* ------------------------------------------------------------------ */

/**
 * A `TmdbClient` that answers `/movie/<id>` from FIXTURES and never opens a
 * socket, so movies enter the pool through the real `suggestMovie` path (and
 * therefore through its duplicate, restore and cooldown rules) with no API key
 * and no network.
 */
function fixtureTmdb(): TmdbClient {
	const byId = new Map(FIXTURES.map((fixture) => [fixture.tmdbId, fixture]));
	return new TmdbClient({
		apiKey: 'seed-fixtures',
		fetchImpl: async (input) => {
			const match = String(input).match(/\/movie\/(\d+)/);
			const fixture = match ? byId.get(Number(match[1])) : undefined;
			if (!fixture) return new Response('{}', { status: 404 });
			return Response.json({
				id: fixture.tmdbId,
				title: fixture.title,
				release_date: `${fixture.year}-06-01`,
				runtime: fixture.runtimeMin,
				poster_path: fixture.posterPath
			});
		}
	});
}

/* ------------------------------------------------------------------ */
/* Wipe                                                                */
/* ------------------------------------------------------------------ */

/**
 * Deletes exactly one group — the one holding our invite token — and everything
 * hanging off it, in foreign-key order. `groups` cascades to members, movies and
 * rounds, but `movies.suggested_by`, `rounds.winner_id` and `fairness.member_id`
 * have no ON DELETE action, so a single `delete from groups` would race its own
 * cascades. Explicit ordering avoids relying on that.
 */
function wipeGroup(db: Db, inviteToken: string): boolean {
	const group = findGroupByToken(db, inviteToken);
	if (!group) return false;

	const memberIds = db
		.select({ id: members.id })
		.from(members)
		.where(eq(members.groupId, group.id))
		.all()
		.map((row) => row.id);
	const movieIds = db
		.select({ id: movies.id })
		.from(movies)
		.where(eq(movies.groupId, group.id))
		.all()
		.map((row) => row.id);

	db.transaction((tx) => {
		const inner = tx as unknown as Db;
		if (movieIds.length > 0) {
			inner.delete(standingVotes).where(inArray(standingVotes.movieId, movieIds)).run();
		}
		if (memberIds.length > 0) {
			inner.delete(fairness).where(inArray(fairness.memberId, memberIds)).run();
		}
		// Cascades attendance, vetoes and pair votes.
		inner.delete(rounds).where(eq(rounds.groupId, group.id)).run();
		inner.delete(movies).where(eq(movies.groupId, group.id)).run();
		inner.delete(members).where(eq(members.groupId, group.id)).run();
		inner.delete(groups).where(eq(groups.id, group.id)).run();
	});
	return true;
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

/*
 * Refuse to run unless this is explicitly a development database.
 *
 * The whole point of this script is a *guessable* invite token, and the invite
 * token is the only credential the app has: anyone who knows `dev-movie-club`
 * has full access to that group. Left unguarded, one stray `bun run seed`
 * against a production DATABASE_URL would publish a permanently open group on a
 * server whose other groups are protected by 192 bits of randomness.
 */
if (process.env.DEV_MODE !== '1' && !process.argv.includes('--force')) {
	console.error(
		'refusing to seed: this creates a group behind the guessable token ' +
			`"${INVITE_TOKEN}".\n` +
			'Re-run with DEV_MODE=1 (or --force) once you are sure DATABASE_URL is a dev database.\n' +
			`  DATABASE_URL=${databaseUrl()}`
	);
	process.exit(1);
}

const url = databaseUrl();
const db = createDb(url);
migrate(db, { migrationsFolder: './drizzle' });

const wiped = wipeGroup(db, INVITE_TOKEN);
console.log(`database: ${url}`);
console.log(wiped ? `wiped the previous "${INVITE_TOKEN}" group` : `no previous "${INVITE_TOKEN}" group`);

/* --- group and members -------------------------------------------- */

const created = unwrap(
	createGroup(db, { name: GROUP_NAME, memberName: 'Ana', now: daysAgo(JOINED_DAYS_AGO.Ana) })
);
// No service assigns a chosen invite token; `regenerateInviteToken` only picks a
// random one. Pinning it is the whole point of the fixture, so it is set here.
const group = db
	.update(groups)
	.set({ inviteToken: INVITE_TOKEN })
	.where(eq(groups.id, created.group.id))
	.returning()
	.get();
const config = withConfigDefaults(group.config);

const memberByName = new Map<MemberName, Member>([['Ana', created.member]]);
for (const name of MEMBER_NAMES.slice(1) as MemberName[]) {
	memberByName.set(
		name,
		unwrap(claimMember(db, { groupId: group.id, name, now: daysAgo(JOINED_DAYS_AGO[name]) }))
	);
}
const member = (name: MemberName): Member => {
	const found = memberByName.get(name);
	if (!found) throw new Error(`no member named ${name}`);
	return found;
};

/* --- movies -------------------------------------------------------- */

const tmdb = fixtureTmdb();
for (const fixture of FIXTURES) {
	const outcome = unwrap(
		await suggestMovie({
			db,
			groupId: group.id,
			config,
			actorId: member(fixture.suggestedBy).id,
			tmdbId: fixture.tmdbId,
			tmdb,
			now: daysAgo(fixture.addedDaysAgo)
		})
	);
	assert.equal(outcome.kind, 'created', `${fixture.title} should be a fresh suggestion`);
	assert.equal(outcome.movie.runtimeMin, fixture.runtimeMin);
	assert.equal(outcome.movie.posterPath, fixture.posterPath);
}

const movieByTitle = (title: string): Movie => {
	const found = db
		.select()
		.from(movies)
		.where(and(eq(movies.groupId, group.id), eq(movies.title, title)))
		.get();
	if (!found) throw new Error(`no movie titled ${title}`);
	return found;
};

/* --- standing votes ------------------------------------------------ */

/**
 * Applies one night's matrix to every movie still in the pool. Watched movies
 * are skipped: their standing votes are archived, not rewritten (and their
 * round reads a frozen snapshot anyway).
 */
function applyStandingVotes(matrix: VoteMatrix, at: Date): void {
	const rows = db
		.select()
		.from(movies)
		.where(and(eq(movies.groupId, group.id), inArray(movies.status, ['pool', 'removed'])))
		.all();

	for (const movie of rows) {
		const spec = matrix[movie.title] ?? '.....';
		MEMBER_NAMES.forEach((name, index) => {
			const who = member(name);
			// A member cannot have voted before joining.
			if (who.createdAt.getTime() > at.getTime()) return;
			const mark = spec[index] ?? '.';
			if (mark === '.') {
				// Absence of a row IS the third state; no service can express it.
				db.delete(standingVotes)
					.where(and(eq(standingVotes.memberId, who.id), eq(standingVotes.movieId, movie.id)))
					.run();
				return;
			}
			unwrap(
				setStandingVote({
					db,
					groupId: group.id,
					memberId: who.id,
					movieId: movie.id,
					value: mark === 'y' ? 'yes' : 'no',
					now: at
				})
			);
		});
	}
}

/* --- rounds -------------------------------------------------------- */

interface NightPlan {
	label: string;
	matrix: VoteMatrix;
	attendees: MemberName[];
	createdAt: Date;
	runoffAt: Date;
	decidedAt: Date;
	watchedAt: Date;
	seed: number;
	/** member → the finalist they veto, or null for an explicit pass. */
	vetoes: Array<[MemberName, string | null]>;
	/** member → their preference order over the surviving finalists, best first. */
	rankings: Array<[MemberName, string[]]>;
	/** Pairs a member has no preference on. */
	noPreference?: Array<[MemberName, [string, string]]>;
	expect: {
		finalists: string[];
		survivors: string[];
		winner: string;
		tiebreakRule: string | null;
	};
}

function runNight(plan: NightPlan): string {
	applyStandingVotes(plan.matrix, plan.createdAt);

	const round = unwrap(
		createRound({
			db,
			groupId: group.id,
			actorId: member(plan.attendees[0]).id,
			now: plan.createdAt,
			seed: plan.seed
		})
	);
	for (const name of plan.attendees) {
		unwrap(
			setRsvp({
				db,
				groupId: group.id,
				roundId: round.id,
				memberId: member(name).id,
				attending: true,
				actorId: member(name).id,
				now: plan.createdAt
			})
		);
	}

	const toRunoff = unwrap(
		advanceRound({ db, groupId: group.id, config, roundId: round.id, now: plan.runoffAt })
	);
	assert.equal(toRunoff.plan.kind, 'open_to_runoff', `${plan.label}: expected a runoff`);
	assert.deepEqual(
		[...(toRunoff.round.finalistIds ?? [])].sort(),
		plan.expect.finalists.map((title) => movieByTitle(title).id).sort(),
		`${plan.label}: unexpected finalists`
	);

	for (const [name, target] of plan.vetoes) {
		unwrap(
			castVeto({
				db,
				groupId: group.id,
				roundId: round.id,
				memberId: member(name).id,
				movieId: target === null ? null : movieByTitle(target).id,
				now: plan.runoffAt
			})
		);
	}

	const skip = new Set(
		(plan.noPreference ?? []).map(([name, pair]) => `${name}|${[...pair].sort().join('|')}`)
	);
	for (const [name, ranking] of plan.rankings) {
		assert.deepEqual([...ranking].sort(), [...plan.expect.survivors].sort(), `${plan.label}: ${name} ranking`);
		for (let i = 0; i < ranking.length; i++) {
			for (let j = i + 1; j < ranking.length; j++) {
				const better = movieByTitle(ranking[i]);
				const worse = movieByTitle(ranking[j]);
				const indifferent = skip.has(`${name}|${[ranking[i], ranking[j]].sort().join('|')}`);
				unwrap(
					castPairVote({
						db,
						groupId: group.id,
						roundId: round.id,
						memberId: member(name).id,
						a: better.id,
						b: worse.id,
						winner: indifferent ? null : better.id,
						now: plan.runoffAt
					})
				);
			}
		}
	}

	const decided = unwrap(
		advanceRound({ db, groupId: group.id, config, roundId: round.id, now: plan.decidedAt })
	);
	assert.equal(decided.plan.kind, 'runoff_to_decided');
	assert.equal(decided.round.winnerId, movieByTitle(plan.expect.winner).id, `${plan.label}: winner`);
	assert.equal(decided.round.tiebreakRuleUsed, plan.expect.tiebreakRule, `${plan.label}: tiebreak rule`);

	unwrap(markWatched({ db, groupId: group.id, roundId: round.id, now: plan.watchedAt }));
	console.log(
		`night: ${plan.label} — winner "${plan.expect.winner}"` +
			`${plan.expect.tiebreakRule ? ` (tiebreak: ${plan.expect.tiebreakRule})` : ' (Condorcet winner)'}`
	);
	return round.id;
}

/**
 * Night 1. A clean Condorcet win: The Thing beats every survivor head-to-head,
 * so no tiebreak rung is used at all. Dee vetoes The Matrix, which is what makes
 * the round robin 4 movies / 6 pairs instead of 5 / 10.
 */
runNight({
	label: '41 days ago',
	matrix: NIGHT_1,
	attendees: ['Ana', 'Ben', 'Cal', 'Dee'],
	createdAt: daysAgo(41),
	runoffAt: daysAgo(40),
	decidedAt: new Date(daysAgo(40).getTime() + 2 * HOUR_MS),
	watchedAt: daysAgo(39),
	seed: 20240117,
	vetoes: [
		['Dee', 'The Matrix'],
		['Ana', null],
		['Ben', null],
		['Cal', null]
	],
	rankings: [
		['Ana', ['The Thing', 'Spirited Away', 'Pulp Fiction', 'Mad Max: Fury Road']],
		['Ben', ['The Thing', 'Mad Max: Fury Road', 'Pulp Fiction', 'Spirited Away']],
		['Cal', ['Spirited Away', 'The Thing', 'Mad Max: Fury Road', 'Pulp Fiction']],
		['Dee', ['The Thing', 'Pulp Fiction', 'Mad Max: Fury Road', 'Spirited Away']]
	],
	noPreference: [['Cal', ['Pulp Fiction', 'Mad Max: Fury Road']]],
	expect: {
		finalists: ['The Thing', 'The Matrix', 'Pulp Fiction', 'Spirited Away', 'Mad Max: Fury Road'],
		survivors: ['The Thing', 'Pulp Fiction', 'Spirited Away', 'Mad Max: Fury Road'],
		winner: 'The Thing',
		tiebreakRule: null
	}
});

/**
 * Night 2. A three-way Condorcet cycle (Spider-Verse > Parasite > Portrait >
 * Spider-Verse) with everyone agreeing Everything Everywhere is last. Copeland
 * ties the cycle at 2 wins each, so the reveal is decided one rung down, on
 * approval — which is the case the history screen should show off.
 */
runNight({
	label: '16 days ago',
	matrix: NIGHT_2,
	attendees: ['Ana', 'Ben', 'Cal', 'Dee', 'Eve'],
	createdAt: daysAgo(16),
	runoffAt: daysAgo(15),
	decidedAt: new Date(daysAgo(15).getTime() + 2 * HOUR_MS),
	watchedAt: daysAgo(13),
	seed: 20240208,
	vetoes: [
		['Eve', 'Mad Max: Fury Road'],
		['Ana', null],
		['Ben', null],
		['Cal', null],
		['Dee', null]
	],
	rankings: [
		['Ana', ['Spider-Man: Into the Spider-Verse', 'Parasite', 'Portrait of a Lady on Fire', 'Everything Everywhere All at Once']],
		['Dee', ['Spider-Man: Into the Spider-Verse', 'Parasite', 'Portrait of a Lady on Fire', 'Everything Everywhere All at Once']],
		['Ben', ['Parasite', 'Portrait of a Lady on Fire', 'Spider-Man: Into the Spider-Verse', 'Everything Everywhere All at Once']],
		['Eve', ['Parasite', 'Portrait of a Lady on Fire', 'Spider-Man: Into the Spider-Verse', 'Everything Everywhere All at Once']],
		['Cal', ['Portrait of a Lady on Fire', 'Spider-Man: Into the Spider-Verse', 'Parasite', 'Everything Everywhere All at Once']]
	],
	expect: {
		finalists: [
			'Spider-Man: Into the Spider-Verse',
			'Parasite',
			'Portrait of a Lady on Fire',
			'Everything Everywhere All at Once',
			'Mad Max: Fury Road'
		],
		survivors: [
			'Spider-Man: Into the Spider-Verse',
			'Parasite',
			'Portrait of a Lady on Fire',
			'Everything Everywhere All at Once'
		],
		winner: 'Spider-Man: Into the Spider-Verse',
		tiebreakRule: 'approval'
	}
});

/* --- tonight ------------------------------------------------------- */

applyStandingVotes(TONIGHT, hoursAgo(6));

// The joke suggestion, removed by someone else. Removed movies keep their
// standing votes (there are none) and drop out of eligibility and coverage.
unwrap(
	removeMovie({
		db,
		groupId: group.id,
		movieId: movieByTitle('Cats').id,
		actorId: member('Cal').id,
		now: daysAgo(7)
	})
);

const tonight = unwrap(
	createRound({
		db,
		groupId: group.id,
		actorId: member('Ana').id,
		now: hoursAgo(3),
		closesAt: new Date(NOW.getTime() + 4 * HOUR_MS),
		seed: 20240301
	})
);
// 3 of 5 in. Dee is explicitly out and was marked by Ana, so the round screen
// shows a proxy RSVP ("out — marked by Ana"); Eve has not answered at all,
// which is the third, default state.
for (const name of ['Ana', 'Ben', 'Cal'] as MemberName[]) {
	unwrap(
		setRsvp({
			db,
			groupId: group.id,
			roundId: tonight.id,
			memberId: member(name).id,
			attending: true,
			actorId: member(name).id,
			now: hoursAgo(2)
		})
	);
}
unwrap(
	setRsvp({
		db,
		groupId: group.id,
		roundId: tonight.id,
		memberId: member('Dee').id,
		attending: false,
		actorId: member('Ana').id,
		now: hoursAgo(2)
	})
);

/* ------------------------------------------------------------------ */
/* Self-check: the edges this fixture exists to exercise               */
/* ------------------------------------------------------------------ */

// `planAdvance` computes without writing, so the round stays OPEN for the dev to
// drive by hand. Everything below is what tapping "Close swiping & pick
// finalists" will produce.
const plan = unwrap(planAdvance({ db, groupId: group.id, config, round: tonight, now: NOW }));
assert.equal(plan.kind, 'open_to_runoff');
if (plan.kind !== 'open_to_runoff') throw new Error('unreachable');
const phase1 = plan.phase1;

const titleOf = new Map(
	db
		.select()
		.from(movies)
		.where(eq(movies.groupId, group.id))
		.all()
		.map((movie) => [movie.id, movie.title])
);
const titleFor = (id: string) => titleOf.get(id) ?? id;

assert.equal(phase1.attendeeCount, 3, 'tonight has 3 attendees');
assert.deepEqual(
	phase1.finalistIds.map(titleFor),
	['Parasite', 'Spirited Away', 'Mad Max: Fury Road', 'Arrival', 'Whiplash'],
	'tonight’s finalists'
);
assert.equal(phase1.boundaryTiebreak?.rule, 'shortest_runtime', 'the boundary tie is decided on runtime');
assert.deepEqual(
	phase1.boundaryTiebreak?.contested.map(titleFor).sort(),
	['Blade Runner 2049', 'Whiplash'],
	'the two movies still tied at the boundary'
);

const reason = (title: string) =>
	phase1.tallies.find((tally) => titleFor(tally.movieId) === title)?.ineligibleReason ?? null;
assert.equal(reason('Alien'), 'coverage_floor', 'Alien is below the coverage floor');
assert.equal(reason('Coco'), 'coverage_floor', 'Coco is below the coverage floor');
assert.equal(reason('Everything Everywhere All at Once'), 'min_attendee_votes');
assert.equal(reason('Portrait of a Lady on Fire'), 'min_attendee_votes');
assert.equal(reason('Cats'), 'not_in_pool', 'the removed movie is not eligible');

const pulp = phase1.tallies.find((tally) => titleFor(tally.movieId) === 'Pulp Fiction')!;
assert.equal(pulp.eligible, true, 'Pulp Fiction is fully swiped, so it is eligible');
assert.equal(pulp.clearsApprovalFloor, false, 'Pulp Fiction is below the approval floor');

const fairnessRows = db
	.select({ memberId: fairness.memberId, wins: fairness.winsCount })
	.from(fairness)
	.innerJoin(members, eq(members.id, fairness.memberId))
	.where(eq(members.groupId, group.id))
	.all();
const winsByName = new Map(
	fairnessRows.map((row) => [
		[...memberByName.entries()].find(([, m]) => m.id === row.memberId)?.[0] ?? row.memberId,
		row.wins
	])
);
assert.deepEqual(
	Object.fromEntries(winsByName),
	{ Ana: 1, Ben: 1, Cal: 0, Dee: 0, Eve: 0 },
	'fairness counters match the two watched nights'
);
const watchedRounds = db
	.select({ id: rounds.id })
	.from(rounds)
	.where(and(eq(rounds.groupId, group.id), eq(rounds.state, 'watched')))
	.all();
assert.equal(watchedRounds.length, 2, 'two finished nights in history');

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

const pad = (value: string, width: number) => value.padEnd(width);
console.log('\ntonight — OPEN, 3 of 5 in (Ana, Ben, Cal in · Dee out, marked by Ana · Eve no answer)');
console.log(`  ${pad('movie', 36)}${pad('votes', 7)}${pad('yes', 5)}${pad('appr', 6)}status`);
for (const tally of [...phase1.tallies].sort((a, b) => b.yesVotes - a.yesVotes || titleFor(a.movieId).localeCompare(titleFor(b.movieId)))) {
	const finalistIndex = phase1.finalistIds.indexOf(tally.movieId);
	const status = !tally.eligible
		? `ineligible: ${tally.ineligibleReason}`
		: !tally.clearsApprovalFloor
			? 'below approval floor'
			: finalistIndex >= 0
				? `FINALIST #${finalistIndex + 1}`
				: 'candidate, missed the cut';
	console.log(
		`  ${pad(titleFor(tally.movieId), 36)}${pad(`${tally.attendeeVotes}/3`, 7)}${pad(String(tally.yesVotes), 5)}` +
			`${pad(tally.approval.toFixed(2), 6)}${status}`
	);
}
console.log(
	`  boundary tie: ${phase1.boundaryTiebreak?.rule} between ` +
		`${phase1.boundaryTiebreak?.contested.map(titleFor).join(' and ')}`
);

const origin = process.env.ORIGIN ?? 'http://localhost:5173';
console.log(`\nmembers: ${MEMBER_NAMES.join(', ')}`);
console.log(`join URL: ${origin}/g/${INVITE_TOKEN}`);
console.log('run with DEV_MODE=1 to switch between members from the amber bar at the bottom.');

db.$client.close();
