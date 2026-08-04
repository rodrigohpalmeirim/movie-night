/**
 * Stars: the write path, the database's cross-column rule, the Phase 1 rung, the
 * frozen snapshot, and the veto flip's obligation to put a star back.
 *
 * voting-spec, Phase 1 → Stars: a star is an UPGRADED yes, unlimited, and the
 * highest-priority tie-breaker after the approval count — "Nothing else."
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { standingVotes, vetoes } from './db/index.js';
import { unwrap, type Result } from './result.js';
import { setStandingVote } from './services/movies.js';
import {
	advanceRound,
	castVeto,
	createRound,
	evaluateRunoff,
	planAdvance,
	setRsvp
} from './services/rounds.js';
import { buildPoolView, buildRevealView } from './services/views.js';
import { BASE_NOW, createTestWorld, type TestWorld } from './testing.js';

let world: TestWorld | undefined;
afterEach(() => {
	world?.cleanup();
	world = undefined;
});

function code(result: Result<unknown>): string {
	if (result.ok) throw new Error('expected a failure');
	return result.code;
}

/* ------------------------------------------------------------------ */
/* The write path                                                      */
/* ------------------------------------------------------------------ */

describe('starring is part of the standing-vote upsert', () => {
	function solo() {
		const w = createTestWorld({ memberNames: ['Ana'], movies: [{ title: 'Alien' }] });
		return {
			w,
			args: {
				db: w.db,
				groupId: w.group.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Alien').id
			}
		};
	}

	test('a yes with a star is one row, not two', () => {
		const { w, args } = solo();
		world = w;
		const row = unwrap(setStandingVote({ ...args, value: 'yes', starred: true }));
		expect(row.value).toBe('yes');
		expect(row.starred).toBe(true);
		expect(w.db.select().from(standingVotes).all().length).toBe(1);
	});

	test('starring a film that was never answered upserts it to a starred yes', () => {
		// Matches the existing upsert, which never required a row to exist first.
		const { w, args } = solo();
		world = w;
		const row = unwrap(setStandingVote({ ...args, starred: true }));
		expect(row.value).toBe('yes');
		expect(row.starred).toBe(true);
	});

	test('starring a film answered "no" upgrades it to a starred yes', () => {
		const { w, args } = solo();
		world = w;
		unwrap(setStandingVote({ ...args, value: 'no' }));
		const row = unwrap(setStandingVote({ ...args, starred: true }));
		expect(row.value).toBe('yes');
		expect(row.starred).toBe(true);
	});

	test('unstarring falls back to a plain yes, never to "no" or to nothing', () => {
		const { w, args } = solo();
		world = w;
		unwrap(setStandingVote({ ...args, value: 'yes', starred: true }));
		const row = unwrap(setStandingVote({ ...args, starred: false }));
		expect(row.value).toBe('yes');
		expect(row.starred).toBe(false);
		expect(w.db.select().from(standingVotes).all().length).toBe(1);
	});

	test('re-affirming a yes without a star flag keeps the star', () => {
		// The pool and swipe screens post a bare `value`; a right-swipe on a starred
		// film must not quietly demote it.
		const { w, args } = solo();
		world = w;
		unwrap(setStandingVote({ ...args, value: 'yes', starred: true }));
		expect(unwrap(setStandingVote({ ...args, value: 'yes' })).starred).toBe(true);
	});

	test('voting "no" drops the star, because a star cannot outlive its yes', () => {
		const { w, args } = solo();
		world = w;
		unwrap(setStandingVote({ ...args, value: 'yes', starred: true }));
		const row = unwrap(setStandingVote({ ...args, value: 'no' }));
		expect(row.value).toBe('no');
		expect(row.starred).toBe(false);
	});

	test('a star on an explicit "no" is rejected rather than reinterpreted', () => {
		const { w, args } = solo();
		world = w;
		expect(code(setStandingVote({ ...args, value: 'no', starred: true }))).toBe('invalid_input');
		expect(w.db.select().from(standingVotes).all().length).toBe(0);
	});

	test('an empty request is rejected', () => {
		const { w, args } = solo();
		world = w;
		expect(code(setStandingVote({ ...args }))).toBe('invalid_input');
	});

	test('a non-boolean star is rejected', () => {
		const { w, args } = solo();
		world = w;
		expect(code(setStandingVote({ ...args, value: 'yes', starred: 'yes please' }))).toBe(
			'invalid_input'
		);
	});

	test('there is nothing to unstar before anything has been swiped', () => {
		const { w, args } = solo();
		world = w;
		expect(code(setStandingVote({ ...args, starred: false }))).toBe('invalid_input');
		expect(w.db.select().from(standingVotes).all().length).toBe(0);
	});

	test('a member may star any number of films (unlimited, no budget)', () => {
		const w = createTestWorld({
			memberNames: ['Ana'],
			movies: [{ title: 'Alien' }, { title: 'Brazil' }, { title: 'Casino' }]
		});
		world = w;
		for (const title of ['Alien', 'Brazil', 'Casino']) {
			unwrap(
				setStandingVote({
					db: w.db,
					groupId: w.group.id,
					memberId: w.member('Ana').id,
					movieId: w.movie(title).id,
					value: 'yes',
					starred: true
				})
			);
		}
		expect(w.db.select().from(standingVotes).all().filter((row) => row.starred).length).toBe(3);
	});

	test('the pool view shows me my own star and nobody else’s', () => {
		const w = createTestWorld({ memberNames: ['Ana', 'Ben'], movies: [{ title: 'Alien' }] });
		world = w;
		unwrap(
			setStandingVote({
				db: w.db,
				groupId: w.group.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Alien').id,
				value: 'yes',
				starred: true
			})
		);
		const mine = buildPoolView({ db: w.db, group: w.group, me: w.member('Ana') }).movies[0];
		expect(mine.myVote).toBe('yes');
		expect(mine.myStarred).toBe(true);
		const theirs = buildPoolView({ db: w.db, group: w.group, me: w.member('Ben') }).movies[0];
		expect(theirs.myVote).toBeNull();
		expect(theirs.myStarred).toBe(false);
	});
});

/* ------------------------------------------------------------------ */
/* The Phase 1 rung, end to end                                        */
/* ------------------------------------------------------------------ */

const MEMBERS = ['Ana', 'Ben', 'Cal', 'Dee'];

/**
 * A world with a genuine tie AT the finalist boundary. Alien takes the first slot
 * on 4 yes-votes; Brazil and Casino are indistinguishable — Ana and Ben yes, Cal
 * no, same runtime, same suggester, so same coverage, approval and fairness — and
 * compete for the second. With no stars that boundary falls all the way to seeded
 * random; one star settles it outright.
 */
function tiedBoundary(options: { starOn?: string; starBy?: string } = {}) {
	const w = createTestWorld({
		memberNames: MEMBERS,
		movies: [
			{ title: 'Alien', runtimeMin: 100, suggestedBy: 'Ana' },
			{ title: 'Brazil', runtimeMin: 100, suggestedBy: 'Ana' },
			{ title: 'Casino', runtimeMin: 100, suggestedBy: 'Ana' }
		],
		config: { n_finalists: 2 }
	});
	const round = unwrap(
		createRound({ db: w.db, groupId: w.group.id, actorId: w.member('Ana').id, now: BASE_NOW, seed: 1234 })
	);
	for (const name of MEMBERS) {
		unwrap(
			setRsvp({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member(name).id,
				attending: true,
				actorId: w.member(name).id,
				now: BASE_NOW
			})
		);
	}
	const ballots: Record<string, Array<[string, 'yes' | 'no']>> = {
		// Unanimous: the uncontested first slot.
		Alien: MEMBERS.map((name) => [name, 'yes']),
		Brazil: [
			['Ana', 'yes'],
			['Ben', 'yes'],
			['Cal', 'no']
		],
		Casino: [
			['Ana', 'yes'],
			['Ben', 'yes'],
			['Cal', 'no']
		]
	};
	for (const [title, rows] of Object.entries(ballots)) {
		for (const [name, value] of rows) {
			unwrap(
				setStandingVote({
					db: w.db,
					groupId: w.group.id,
					memberId: w.member(name).id,
					movieId: w.movie(title).id,
					value,
					starred: value === 'yes' && options.starOn === title && (options.starBy ?? 'Ana') === name,
					now: BASE_NOW
				})
			);
		}
	}
	return { w, round };
}

describe('stars decide the finalist boundary and nothing else', () => {
	test('one star promotes the film it is on', () => {
		const { w, round } = tiedBoundary({ starOn: 'Brazil' });
		world = w;
		const plan = unwrap(
			planAdvance({ db: w.db, groupId: w.group.id, config: w.config, round, now: BASE_NOW })
		);
		if (plan.kind === 'runoff_to_decided') throw new Error('unreachable');
		expect(plan.phase1.finalistIds).toEqual([w.movie('Alien').id, w.movie('Brazil').id]);
		expect(plan.phase1.boundaryTiebreak?.rule).toBe('stars');
		expect(plan.phase1.boundaryTiebreak?.contested.sort()).toEqual(
			[w.movie('Brazil').id, w.movie('Casino').id].sort()
		);
		// ...and with the star on the other film, the other film is promoted.
		const other = tiedBoundary({ starOn: 'Casino' });
		const otherPlan = unwrap(
			planAdvance({
				db: other.w.db,
				groupId: other.w.group.id,
				config: other.w.config,
				round: other.round,
				now: BASE_NOW
			})
		);
		if (otherPlan.kind === 'runoff_to_decided') throw new Error('unreachable');
		expect(otherPlan.phase1.finalistIds).toEqual([
			other.w.movie('Alien').id,
			other.w.movie('Casino').id
		]);
		other.w.cleanup();
	});

	test('with no star at all the same boundary is decided by seeded random', () => {
		const { w, round } = tiedBoundary();
		world = w;
		const plan = unwrap(
			planAdvance({ db: w.db, groupId: w.group.id, config: w.config, round, now: BASE_NOW })
		);
		if (plan.kind === 'runoff_to_decided') throw new Error('unreachable');
		expect(plan.phase1.boundaryTiebreak?.rule).toBe('seeded_random');
	});

	test('a non-attendee’s star is as inert as their vote', () => {
		const { w, round } = tiedBoundary({ starOn: 'Brazil', starBy: 'Ana' });
		world = w;
		// Ana is the only starrer; RSVP her out and the star leaves with her.
		unwrap(
			setRsvp({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				attending: false,
				actorId: w.member('Ana').id,
				now: BASE_NOW
			})
		);
		const plan = unwrap(
			planAdvance({ db: w.db, groupId: w.group.id, config: w.config, round, now: BASE_NOW })
		);
		if (plan.kind === 'runoff_to_decided') throw new Error('unreachable');
		const brazil = plan.phase1.tallies.find((t) => t.movieId === w.movie('Brazil').id);
		expect(brazil?.starVotes).toBe(0);
		expect(plan.phase1.boundaryTiebreak?.rule).toBe('seeded_random');
	});

	test('the star is frozen into the round’s snapshot and published at the reveal', () => {
		const { w, round } = tiedBoundary({ starOn: 'Brazil' });
		world = w;
		const advanced = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id, now: BASE_NOW })
		);
		const starred = advanced.round.standingSnapshot?.filter((row) => row.starred === true) ?? [];
		expect(starred.length).toBe(1);
		expect(starred[0].movie_id).toBe(w.movie('Brazil').id);

		const runoff = unwrap(evaluateRunoff({ db: w.db, groupId: w.group.id, round: advanced.round }));
		expect(runoff.tallies.find((t) => t.movieId === w.movie('Brazil').id)?.starVotes).toBe(1);

		// And it survives into the reveal payload, where aggregates become public.
		const decided = unwrap(
			advanceRound({
				db: w.db,
				groupId: w.group.id,
				config: w.config,
				roundId: advanced.round.id,
				now: BASE_NOW
			})
		);
		const reveal = buildRevealView({ db: w.db, group: w.group, round: decided.round });
		expect(reveal.tallies.find((t) => t.movieId === w.movie('Brazil').id)?.starVotes).toBe(1);
		expect(reveal.tallies.find((t) => t.movieId === w.movie('Alien').id)?.starVotes).toBe(0);
	});

	test('a star cast after the freeze cannot move this round’s numbers', () => {
		const { w, round } = tiedBoundary({ starOn: 'Brazil' });
		world = w;
		const advanced = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id, now: BASE_NOW })
		);
		unwrap(
			setStandingVote({
				db: w.db,
				groupId: w.group.id,
				memberId: w.member('Ben').id,
				movieId: w.movie('Alien').id,
				starred: true,
				now: new Date(BASE_NOW.getTime() + 60_000)
			})
		);
		const runoff = unwrap(evaluateRunoff({ db: w.db, groupId: w.group.id, round: advanced.round }));
		expect(runoff.tallies.find((t) => t.movieId === w.movie('Alien').id)?.starVotes).toBe(0);
	});
});

/* ------------------------------------------------------------------ */
/* The veto flip                                                       */
/* ------------------------------------------------------------------ */

describe('the veto flip drops a star and can put it back', () => {
	function runoffWithStar() {
		const { w, round } = tiedBoundary({ starOn: 'Brazil', starBy: 'Ana' });
		const advanced = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id, now: BASE_NOW })
		);
		return { w, round: advanced.round };
	}

	const myVote = (w: TestWorld, name: string, title: string) =>
		w.db
			.select()
			.from(standingVotes)
			.where(
				and(
					eq(standingVotes.memberId, w.member(name).id),
					eq(standingVotes.movieId, w.movie(title).id)
				)
			)
			.get();

	test('vetoing my own starred film sets it to "no" and unstars it', () => {
		const { w, round } = runoffWithStar();
		world = w;
		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Brazil').id,
				now: new Date(BASE_NOW.getTime() + 1000)
			})
		);
		const row = myVote(w, 'Ana', 'Brazil');
		expect(row?.value).toBe('no');
		expect(row?.starred).toBe(false);
		// The veto remembers what it destroyed, star included.
		const veto = w.db.select().from(vetoes).where(eq(vetoes.roundId, round.id)).get();
		expect(veto?.previousStandingValue).toBe('yes');
		expect(veto?.previousStarred).toBe(true);
	});

	test('retracting the veto restores the STARRED yes exactly', () => {
		const { w, round } = runoffWithStar();
		world = w;
		const args = {
			db: w.db,
			groupId: w.group.id,
			roundId: round.id,
			memberId: w.member('Ana').id
		};
		unwrap(castVeto({ ...args, movieId: w.movie('Brazil').id, now: new Date(BASE_NOW.getTime() + 1000) }));
		unwrap(castVeto({ ...args, movieId: null, now: new Date(BASE_NOW.getTime() + 2000) }));
		const row = myVote(w, 'Ana', 'Brazil');
		expect(row?.value).toBe('yes');
		expect(row?.starred).toBe(true);
	});

	test('moving the veto elsewhere restores the star on the old target', () => {
		const { w, round } = runoffWithStar();
		world = w;
		const args = {
			db: w.db,
			groupId: w.group.id,
			roundId: round.id,
			memberId: w.member('Ana').id
		};
		unwrap(castVeto({ ...args, movieId: w.movie('Brazil').id, now: new Date(BASE_NOW.getTime() + 1000) }));
		unwrap(castVeto({ ...args, movieId: w.movie('Alien').id, now: new Date(BASE_NOW.getTime() + 2000) }));
		expect(myVote(w, 'Ana', 'Brazil')?.starred).toBe(true);
		expect(myVote(w, 'Ana', 'Brazil')?.value).toBe('yes');
		expect(myVote(w, 'Ana', 'Alien')?.value).toBe('no');
		expect(myVote(w, 'Ana', 'Alien')?.starred).toBe(false);
	});

	test('a star added after the flip is the member’s own answer and survives a retraction', () => {
		const { w, round } = runoffWithStar();
		world = w;
		const args = {
			db: w.db,
			groupId: w.group.id,
			roundId: round.id,
			memberId: w.member('Ana').id
		};
		// Ana vetoes Alien (a plain, unswiped-by-her... in fact a "yes"), then stars it
		// again from the pool screen: her later explicit edit wins over the restore.
		unwrap(castVeto({ ...args, movieId: w.movie('Alien').id, now: new Date(BASE_NOW.getTime() + 1000) }));
		unwrap(
			setStandingVote({
				db: w.db,
				groupId: w.group.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Alien').id,
				value: 'yes',
				starred: true,
				now: new Date(BASE_NOW.getTime() + 2000)
			})
		);
		unwrap(castVeto({ ...args, movieId: null, now: new Date(BASE_NOW.getTime() + 3000) }));
		const row = myVote(w, 'Ana', 'Alien');
		expect(row?.value).toBe('yes');
		expect(row?.starred).toBe(true);
	});
});
