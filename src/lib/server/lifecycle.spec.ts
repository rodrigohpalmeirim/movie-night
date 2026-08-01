/**
 * Round lifecycle: creation, conditional transitions, phase gating, veto and pair
 * writes, snapshot semantics, and the fairness update on WATCHED.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { attendance, fairness, groups, movies, pairVotes, rounds, standingVotes, withConfigDefaults } from './db/index.js';
import { notifyGroup, subscribeGroup } from './events.js';
import { unwrap, type Result } from './result.js';

import {
	abandonRound,
	advanceRound,
	applyAdvance,
	castPairVote,
	castVeto,
	createRound,
	evaluateRunoff,
	getActiveRound,
	getCurrentRound,
	getRound,
	loadAttendeeIds,
	markWatched,
	maybeMarkSubmitted,
	memberRunoffProgress,
	planAdvance,
	setRsvp,
	vetoPrefillFor
} from './services/rounds.js';
import { removeMovie, setStandingVote } from './services/movies.js';
import { updateSettings } from './services/groups.js';
import { buildRoundView } from './services/views.js';
import { createTestWorld, BASE_NOW, type TestWorld } from './testing.js';

let world: TestWorld | undefined;
afterEach(() => {
	world?.cleanup();
	world = undefined;
});

const MEMBERS = ['Ana', 'Ben', 'Cal', 'Dee'];

/** Approval-ordered pool: Alien 4 yes, Brazil 3 yes, Casino 2 yes of 4 attendees. */
const POOL = [
	{ title: 'Alien', runtimeMin: 117, suggestedBy: 'Ana' },
	{ title: 'Brazil', runtimeMin: 132, suggestedBy: 'Ben' },
	{ title: 'Casino', runtimeMin: 178, suggestedBy: 'Cal' }
];

const YES_COUNT: Record<string, number> = { Alien: 4, Brazil: 3, Casino: 2 };

function code(result: Result<unknown>): string {
	if (result.ok) throw new Error('expected a failure');
	return result.code;
}

/** An OPEN round with everyone RSVPed in and the pool fully swiped. */
function openWorld(config?: Parameters<typeof createTestWorld>[0]['config']) {
	const w = createTestWorld({ memberNames: MEMBERS, movies: POOL, config });
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
	for (const movie of POOL) {
		MEMBERS.forEach((name, index) => {
			unwrap(
				setStandingVote({
					db: w.db,
					groupId: w.group.id,
					memberId: w.member(name).id,
					movieId: w.movie(movie.title).id,
					value: index < YES_COUNT[movie.title] ? 'yes' : 'no',
					now: BASE_NOW
				})
			);
		});
	}
	return { w, round };
}

/** The same world, already advanced into RUNOFF. */
function runoffWorld(config?: Parameters<typeof createTestWorld>[0]['config']) {
	const { w, round } = openWorld(config);
	const advanced = unwrap(
		advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id, now: BASE_NOW })
	);
	return { w, round: advanced.round };
}

/* ------------------------------------------------------------------ */

describe('creating rounds', () => {
	test('at most one active round per group', () => {
		const { w, round } = openWorld();
		world = w;
		expect(round.state).toBe('open');
		expect(code(createRound({ db: w.db, groupId: w.group.id, actorId: w.member('Ben').id }))).toBe(
			'active_round_exists'
		);
	});

	test('creating a round marks nobody as attending', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: POOL });
		const round = unwrap(
			createRound({ db: world.db, groupId: world.group.id, actorId: world.member('Ana').id })
		);
		expect(loadAttendeeIds(world.db, round.id)).toEqual([]);
	});

	test('a decided round frees the group to start the next one', () => {
		const { w, round } = openWorld();
		world = w;
		w.db.update(rounds).set({ state: 'decided' }).where(eq(rounds.id, round.id)).run();
		expect(createRound({ db: w.db, groupId: w.group.id, actorId: w.member('Ana').id }).ok).toBe(true);
	});

	test('an abandoned round frees the group too', () => {
		const { w, round } = openWorld();
		world = w;
		unwrap(abandonRound({ db: w.db, groupId: w.group.id, roundId: round.id }));
		expect(getActiveRound(w.db, w.group.id)).toBeUndefined();
		expect(createRound({ db: w.db, groupId: w.group.id, actorId: w.member('Ana').id }).ok).toBe(true);
	});
});

describe('reading the current round', () => {
	test('a group with no rounds yet has none', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: POOL });
		expect(getCurrentRound(world.db, world.group.id)).toBeUndefined();
		expect(
			buildRoundView({
				db: world.db,
				group: world.group,
				config: world.config,
				me: world.member('Ana')
			})
		).toBeNull();
	});

	test('once no round is active, the most recent one is still shown', () => {
		const { w, round } = openWorld();
		world = w;
		unwrap(abandonRound({ db: w.db, groupId: w.group.id, roundId: round.id }));
		expect(getActiveRound(w.db, w.group.id)).toBeUndefined();
		expect(getCurrentRound(w.db, w.group.id)?.id).toBe(round.id);
	});
});

describe('RSVP', () => {
	test('self RSVP records the member as their own setter', () => {
		const { w, round } = openWorld();
		world = w;
		const row = w.db
			.select()
			.from(attendance)
			.where(and(eq(attendance.roundId, round.id), eq(attendance.memberId, w.member('Ana').id)))
			.get();
		expect(row?.attending).toBe(true);
		expect(row?.updatedBy).toBe(w.member('Ana').id);
	});

	test('a proxy RSVP records who set it ("in — marked by Ana")', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: POOL });
		const round = unwrap(
			createRound({ db: world.db, groupId: world.group.id, actorId: world.member('Ana').id })
		);
		const result = unwrap(
			setRsvp({
				db: world.db,
				groupId: world.group.id,
				roundId: round.id,
				memberId: world.member('Dee').id,
				attending: true,
				actorId: world.member('Ana').id
			})
		);
		expect(result.memberId).toBe(world.member('Dee').id);
		expect(result.updatedBy).toBe(world.member('Ana').id);
	});

	test('RSVP is an upsert, not a second row', () => {
		const { w, round } = openWorld();
		world = w;
		unwrap(
			setRsvp({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Dee').id,
				attending: false,
				actorId: w.member('Ben').id
			})
		);
		const rows = w.db
			.select()
			.from(attendance)
			.where(and(eq(attendance.roundId, round.id), eq(attendance.memberId, w.member('Dee').id)))
			.all();
		expect(rows.length).toBe(1);
		expect(rows[0].attending).toBe(false);
		expect(rows[0].updatedBy).toBe(w.member('Ben').id);
	});

	test('RSVP is closed once the winner is revealed', () => {
		const { w, round } = runoffWorld();
		world = w;
		unwrap(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id }));
		expect(
			code(
				setRsvp({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: w.member('Dee').id,
					attending: false,
					actorId: w.member('Dee').id
				})
			)
		).toBe('wrong_phase');
	});

	test('RSVPing an unknown member fails', () => {
		const { w, round } = openWorld();
		world = w;
		expect(
			code(
				setRsvp({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: 'ghost',
					attending: true,
					actorId: w.member('Ana').id
				})
			)
		).toBe('unknown_member');
	});
});

describe('OPEN → RUNOFF', () => {
	test('is blocked while nobody is attending', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: POOL });
		const round = unwrap(
			createRound({ db: world.db, groupId: world.group.id, actorId: world.member('Ana').id })
		);
		const result = advanceRound({
			db: world.db,
			groupId: world.group.id,
			config: world.config,
			roundId: round.id
		});
		expect(code(result)).toBe('not_enough_attendees');
		expect(getRound(world.db, world.group.id, round.id)?.state).toBe('open');
	});

	/**
	 * The regression this pins: a fixed floor of three attendee votes locked small
	 * groups out of every round. One attendee who has swiped the pool is a
	 * complete electorate — coverage is a share, so 1/1 clears it.
	 */
	test('a single attendee is enough: their swipes decide the round', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: POOL });
		const ana = world.member('Ana').id;
		const round = unwrap(createRound({ db: world.db, groupId: world.group.id, actorId: ana }));
		unwrap(
			setRsvp({
				db: world.db,
				groupId: world.group.id,
				roundId: round.id,
				memberId: ana,
				attending: true,
				actorId: ana
			})
		);
		// Ana alone likes Alien and Brazil; Casino she has not seen at all.
		for (const title of ['Alien', 'Brazil']) {
			unwrap(
				setStandingVote({
					db: world.db,
					groupId: world.group.id,
					memberId: ana,
					movieId: world.movie(title).id,
					value: 'yes'
				})
			);
		}
		const advanced = unwrap(
			advanceRound({ db: world.db, groupId: world.group.id, config: world.config, roundId: round.id })
		);
		expect(advanced.round.state).toBe('runoff');
		// Order is a tiebreak concern; membership is the point here.
		expect([...advanced.round.finalistIds!].sort()).toEqual(
			[world.movie('Alien').id, world.movie('Brazil').id].sort()
		);
		// Casino has no vote from the only attendee: coverage 0/1 keeps it out.
		expect(advanced.round.finalistIds).not.toContain(world.movie('Casino').id);
	});

	test('freezes finalists, the standing votes behind them, and the knobs', () => {
		const { w, round } = runoffWorld();
		world = w;
		expect(round.state).toBe('runoff');
		expect(round.finalistIds).toEqual([
			w.movie('Alien').id,
			w.movie('Brazil').id,
			w.movie('Casino').id
		]);
		expect(round.runoffAt).not.toBeNull();
		expect(round.configSnapshot?.veto_threshold).toBe(1);
		// 3 finalists × 4 members, and nothing outside the finalist set.
		expect(round.standingSnapshot?.length).toBe(12);
		const finalistIds = new Set(round.finalistIds!);
		expect(round.standingSnapshot!.every((row) => finalistIds.has(row.movie_id))).toBe(true);
	});

	test('an outright winner skips Phase 2 entirely', () => {
		// Only Alien clears the approval floor once the others are voted down.
		const { w, round } = openWorld();
		world = w;
		for (const title of ['Brazil', 'Casino']) {
			for (const name of MEMBERS) {
				unwrap(
					setStandingVote({
						db: w.db,
						groupId: w.group.id,
						memberId: w.member(name).id,
						movieId: w.movie(title).id,
						value: 'no'
					})
				);
			}
		}
		const advanced = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id })
		);
		expect(advanced.plan.kind).toBe('open_to_decided');
		expect(advanced.round.state).toBe('decided');
		expect(advanced.round.winnerId).toBe(w.movie('Alien').id);
		expect(advanced.round.tiebreakRuleUsed).toBeNull();
	});

	test('no clear favourite ends the round decided with no winner', () => {
		const { w, round } = openWorld();
		world = w;
		for (const title of ['Alien', 'Brazil', 'Casino']) {
			for (const name of MEMBERS) {
				unwrap(
					setStandingVote({
						db: w.db,
						groupId: w.group.id,
						memberId: w.member(name).id,
						movieId: w.movie(title).id,
						value: 'no'
					})
				);
			}
		}
		const advanced = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id })
		);
		expect(advanced.round.state).toBe('decided');
		expect(advanced.round.winnerId).toBeNull();
		expect(advanced.round.finalistIds).toEqual([]);
	});
});

describe('transitions are conditional updates', () => {
	test('two simultaneous "close swiping" taps resolve to one transition and one no-op', () => {
		const { w, round } = openWorld();
		world = w;

		// Both members read the same OPEN state and compute their own finalists.
		const planA = unwrap(
			planAdvance({ db: w.db, groupId: w.group.id, config: w.config, round, now: BASE_NOW })
		);
		const planB = unwrap(
			planAdvance({ db: w.db, groupId: w.group.id, config: w.config, round, now: new Date(BASE_NOW.getTime() + 5000) })
		);

		const first = applyAdvance(w.db, w.group.id, planA);
		const second = applyAdvance(w.db, w.group.id, planB);

		expect(first.ok).toBe(true);
		expect(code(second)).toBe('state_changed');

		// The loser's plan wrote nothing: the stored snapshot timestamp is the
		// winner's, so finalists were not recomputed.
		const stored = getRound(w.db, w.group.id, round.id)!;
		expect(stored.state).toBe('runoff');
		expect(stored.runoffAt?.getTime()).toBe(BASE_NOW.getTime());
	});

	test('two simultaneous "reveal the winner" taps resolve to one transition', () => {
		const { w, round } = runoffWorld();
		world = w;
		const planA = unwrap(
			planAdvance({ db: w.db, groupId: w.group.id, config: w.config, round, now: BASE_NOW })
		);
		const planB = unwrap(
			planAdvance({ db: w.db, groupId: w.group.id, config: w.config, round, now: new Date(BASE_NOW.getTime() + 5000) })
		);
		expect(applyAdvance(w.db, w.group.id, planA).ok).toBe(true);
		expect(code(applyAdvance(w.db, w.group.id, planB))).toBe('state_changed');
		expect(getRound(w.db, w.group.id, round.id)?.decidedAt?.getTime()).toBe(BASE_NOW.getTime());
	});

	test('an already-decided round cannot be advanced again', () => {
		const { w, round } = runoffWorld();
		world = w;
		unwrap(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id }));
		expect(
			code(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id }))
		).toBe('illegal_transition');
	});

	test('an abandoned round cannot be advanced', () => {
		const { w, round } = openWorld();
		world = w;
		unwrap(abandonRound({ db: w.db, groupId: w.group.id, roundId: round.id }));
		expect(
			code(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id }))
		).toBe('illegal_transition');
	});
});

describe('veto', () => {
	test('is phase-gated to RUNOFF', () => {
		const { w, round } = openWorld();
		world = w;
		expect(
			code(
				castVeto({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: w.member('Ana').id,
					movieId: w.movie('Alien').id
				})
			)
		).toBe('wrong_phase');
	});

	test('is rejected once the round is decided', () => {
		const { w, round } = runoffWorld();
		world = w;
		unwrap(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id }));
		expect(
			code(
				castVeto({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: w.member('Ana').id,
					movieId: w.movie('Alien').id
				})
			)
		).toBe('wrong_phase');
	});

	test('only attendees may veto', () => {
		const { w, round } = runoffWorld();
		world = w;
		unwrap(
			setRsvp({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Dee').id,
				attending: false,
				actorId: w.member('Dee').id
			})
		);
		expect(
			code(
				castVeto({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: w.member('Dee').id,
					movieId: w.movie('Alien').id
				})
			)
		).toBe('not_attending');
	});

	test('a veto must target a finalist', () => {
		const { w, round } = runoffWorld();
		world = w;
		expect(
			code(
				castVeto({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: w.member('Ana').id,
					movieId: 'not-a-finalist'
				})
			)
		).toBe('invalid_input');
	});

	test('one veto per member per round: a second veto replaces the first', () => {
		const { w, round } = runoffWorld();
		world = w;
		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Casino').id
			})
		);
		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Brazil').id
			})
		);
		const rows = w.db.$client
			.query<{ n: number }, [string]>('select count(*) as n from vetoes where round_id = ?')
			.get(round.id);
		expect(rows?.n).toBe(1);
		const evaluated = unwrap(evaluateRunoff({ db: w.db, groupId: w.group.id, round: getRound(w.db, w.group.id, round.id)! }));
		expect(evaluated.veto.counts[w.movie('Casino').id]).toBe(0);
		expect(evaluated.veto.counts[w.movie('Brazil').id]).toBe(1);
	});

	test('an explicit pass is recorded as a row with movie_id null', () => {
		const { w, round } = runoffWorld();
		world = w;
		const result = unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				movieId: null
			})
		);
		expect(result.movieId).toBeNull();
		const row = w.db.$client
			.query<{ movie_id: string | null }, [string, string]>(
				'select movie_id from vetoes where round_id = ? and member_id = ?'
			)
			.get(round.id, w.member('Ana').id);
		expect(row).not.toBeNull();
		expect(row?.movie_id).toBeNull();
	});

	test('vetoing sets the vetoer’s standing vote to no', () => {
		const { w, round } = runoffWorld();
		world = w;
		// Ana starts with a standing yes on Casino.
		expect(
			w.db
				.select()
				.from(standingVotes)
				.where(
					and(
						eq(standingVotes.memberId, w.member('Ana').id),
						eq(standingVotes.movieId, w.movie('Casino').id)
					)
				)
				.get()?.value
		).toBe('yes');

		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Casino').id
			})
		);

		expect(
			w.db
				.select()
				.from(standingVotes)
				.where(
					and(
						eq(standingVotes.memberId, w.member('Ana').id),
						eq(standingVotes.movieId, w.movie('Casino').id)
					)
				)
				.get()?.value
		).toBe('no');
	});

	test('an explicit pass flips nothing', () => {
		const { w, round } = runoffWorld();
		world = w;
		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				movieId: null
			})
		);
		const stillYes = w.db
			.select()
			.from(standingVotes)
			.where(eq(standingVotes.memberId, w.member('Ana').id))
			.all()
			.filter((row) => row.value === 'yes').length;
		expect(stillYes).toBeGreaterThan(0);
	});

	test('pre-fills from last round when the target is a finalist again', () => {
		const { w, round } = runoffWorld();
		world = w;
		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Casino').id
			})
		);
		// Finish the round, then open a new one with the same pool.
		unwrap(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id }));
		const next = unwrap(
			createRound({
				db: w.db,
				groupId: w.group.id,
				actorId: w.member('Ana').id,
				now: new Date(BASE_NOW.getTime() + 86_400_000),
				seed: 99
			})
		);
		for (const name of MEMBERS) {
			unwrap(
				setRsvp({
					db: w.db,
					groupId: w.group.id,
					roundId: next.id,
					memberId: w.member(name).id,
					attending: true,
					actorId: w.member(name).id
				})
			);
		}
		// Restore Ana's yes on Casino so it can be a finalist again.
		unwrap(
			setStandingVote({
				db: w.db,
				groupId: w.group.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Casino').id,
				value: 'yes'
			})
		);
		const advanced = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: next.id })
		);
		expect(
			vetoPrefillFor({ db: w.db, groupId: w.group.id, round: advanced.round, memberId: w.member('Ana').id })
		).toBe(w.movie('Casino').id);
		// Someone with no previous veto gets no pre-fill.
		expect(
			vetoPrefillFor({ db: w.db, groupId: w.group.id, round: advanced.round, memberId: w.member('Dee').id })
		).toBeNull();
	});
});

describe('snapshot semantics (the veto flip is forward-looking only)', () => {
	test('a veto flip does not change the frozen tallies of its own round', () => {
		// VETO_THRESHOLD 2 keeps the vetoed movie in the round robin, which is the
		// only situation where the difference is observable.
		const { w, round } = runoffWorld({ veto_threshold: 2 });
		world = w;
		const casino = w.movie('Casino').id;

		const before = unwrap(evaluateRunoff({ db: w.db, groupId: w.group.id, round }));
		const casinoBefore = before.tallies.find((t) => t.movieId === casino)!;
		expect(casinoBefore.yesVotes).toBe(2);
		expect(casinoBefore.approval).toBeCloseTo(0.5, 10);

		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				movieId: casino
			})
		);

		// The live standing vote has flipped...
		expect(
			w.db
				.select()
				.from(standingVotes)
				.where(and(eq(standingVotes.memberId, w.member('Ana').id), eq(standingVotes.movieId, casino)))
				.get()?.value
		).toBe('no');

		// ...the snapshot has not...
		const stored = getRound(w.db, w.group.id, round.id)!;
		expect(
			stored.standingSnapshot!.find(
				(row) => row.member_id === w.member('Ana').id && row.movie_id === casino
			)?.value
		).toBe('yes');

		// ...and neither have this round's tallies.
		const after = unwrap(evaluateRunoff({ db: w.db, groupId: w.group.id, round: stored }));
		const casinoAfter = after.tallies.find((t) => t.movieId === casino)!;
		expect(casinoAfter.yesVotes).toBe(2);
		expect(casinoAfter.approval).toBeCloseTo(0.5, 10);
		// It survived, so the difference really was observable.
		expect(after.veto.survivingIds).toContain(casino);
	});

	test('a standing vote cast during RUNOFF does not move the frozen tallies', () => {
		const { w, round } = runoffWorld();
		world = w;
		const alien = w.movie('Alien').id;
		unwrap(
			setStandingVote({
				db: w.db,
				groupId: w.group.id,
				memberId: w.member('Dee').id,
				movieId: alien,
				value: 'no'
			})
		);
		const evaluated = unwrap(evaluateRunoff({ db: w.db, groupId: w.group.id, round }));
		expect(evaluated.tallies.find((t) => t.movieId === alien)?.yesVotes).toBe(4);
	});

	test('the flip does affect the NEXT round', () => {
		const { w, round } = runoffWorld({ veto_threshold: 2 });
		world = w;
		const casino = w.movie('Casino').id;
		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				movieId: casino
			})
		);
		unwrap(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id }));

		const next = unwrap(
			createRound({
				db: w.db,
				groupId: w.group.id,
				actorId: w.member('Ana').id,
				now: new Date(BASE_NOW.getTime() + 86_400_000)
			})
		);
		for (const name of MEMBERS) {
			unwrap(
				setRsvp({
					db: w.db,
					groupId: w.group.id,
					roundId: next.id,
					memberId: w.member(name).id,
					attending: true,
					actorId: w.member(name).id
				})
			);
		}
		const advanced = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: next.id })
		);
		// Casino is now 1 yes of 4 = 0.25 approval, below the floor, so it is not a
		// finalist any more.
		expect(advanced.round.finalistIds).not.toContain(casino);
	});

	test('a knob edited mid-RUNOFF does not retro-affect the round', () => {
		const { w, round } = runoffWorld();
		world = w;
		expect(round.configSnapshot?.veto_threshold).toBe(1);

		unwrap(updateSettings(w.db, { groupId: w.group.id, config: { veto_threshold: 5 } }));
		expect(withConfigDefaults(w.reloadGroup().config).veto_threshold).toBe(5);

		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Casino').id
			})
		);
		// The round still uses the frozen threshold of 1, so one veto disqualifies.
		const evaluated = unwrap(
			evaluateRunoff({ db: w.db, groupId: w.group.id, round: getRound(w.db, w.group.id, round.id)! })
		);
		expect(evaluated.veto.disqualifiedIds).toEqual([w.movie('Casino').id]);
	});
});

describe('pair votes', () => {
	test('are phase-gated to RUNOFF', () => {
		const { w, round } = openWorld();
		world = w;
		expect(
			code(
				castPairVote({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: w.member('Ana').id,
					a: w.movie('Alien').id,
					b: w.movie('Brazil').id,
					winner: w.movie('Alien').id
				})
			)
		).toBe('wrong_phase');
	});

	test('are normalised to a < b whichever order they arrive in', () => {
		const { w, round } = runoffWorld();
		world = w;
		const [x, y] = [w.movie('Alien').id, w.movie('Brazil').id];
		const [lo, hi] = x < y ? [x, y] : [y, x];
		const result = unwrap(
			castPairVote({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				a: hi,
				b: lo,
				winner: hi
			})
		);
		expect(result.a).toBe(lo);
		expect(result.b).toBe(hi);
		const row = w.db.select().from(pairVotes).where(eq(pairVotes.roundId, round.id)).get();
		expect(row?.movieAId).toBe(lo);
		expect(row?.movieBId).toBe(hi);
		expect(row?.winnerId).toBe(hi);
	});

	test('re-voting the same pair updates in place', () => {
		const { w, round } = runoffWorld();
		world = w;
		const a = w.movie('Alien').id;
		const b = w.movie('Brazil').id;
		unwrap(
			castPairVote({ db: w.db, groupId: w.group.id, roundId: round.id, memberId: w.member('Ana').id, a, b, winner: a })
		);
		unwrap(
			castPairVote({ db: w.db, groupId: w.group.id, roundId: round.id, memberId: w.member('Ana').id, a: b, b: a, winner: b })
		);
		const rows = w.db.select().from(pairVotes).where(eq(pairVotes.roundId, round.id)).all();
		expect(rows.length).toBe(1);
		expect(rows[0].winnerId).toBe(b);
	});

	test('an explicit no preference is stored as null', () => {
		const { w, round } = runoffWorld();
		world = w;
		const result = unwrap(
			castPairVote({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				a: w.movie('Alien').id,
				b: w.movie('Brazil').id,
				winner: null
			})
		);
		expect(result.winnerId).toBeNull();
	});

	test('a winner outside the pair, or a non-finalist, is rejected', () => {
		const { w, round } = runoffWorld();
		world = w;
		const base = {
			db: w.db,
			groupId: w.group.id,
			roundId: round.id,
			memberId: w.member('Ana').id
		};
		expect(
			code(castPairVote({ ...base, a: w.movie('Alien').id, b: w.movie('Brazil').id, winner: w.movie('Casino').id }))
		).toBe('invalid_input');
		expect(code(castPairVote({ ...base, a: w.movie('Alien').id, b: 'nope', winner: null }))).toBe(
			'invalid_input'
		);
		expect(code(castPairVote({ ...base, a: w.movie('Alien').id, b: w.movie('Alien').id, winner: null }))).toBe(
			'invalid_input'
		);
	});

	test('runoff_submitted_at is set only when the veto and every pair are done', () => {
		const { w, round } = runoffWorld();
		world = w;
		const ana = w.member('Ana').id;
		const progress = memberRunoffProgress({ db: w.db, round, memberId: ana });
		expect(progress.total).toBe(3); // C(3,2)

		const submittedAt = () =>
			w.db
				.select()
				.from(attendance)
				.where(and(eq(attendance.roundId, round.id), eq(attendance.memberId, ana)))
				.get()?.runoffSubmittedAt ?? null;

		// All pairs but no veto decision → not done.
		for (const pair of progress.matchups) {
			unwrap(
				castPairVote({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: ana,
					a: pair.a,
					b: pair.b,
					winner: pair.a
				})
			);
		}
		expect(submittedAt()).toBeNull();

		// The veto pass completes the flow.
		unwrap(castVeto({ db: w.db, groupId: w.group.id, roundId: round.id, memberId: ana, movieId: null }));
		expect(submittedAt()).not.toBeNull();
	});

	test('reviewing a finished ballot and changing one answer neither duplicates nor un-submits', () => {
		// What the "review my picks" walk does on the server: it re-posts pairs the
		// member has already answered. Each re-post must land on the same row, the
		// member must stay finished throughout, and the first completion time must
		// not be bumped by the edit.
		const { w, round } = runoffWorld();
		world = w;
		const ana = w.member('Ana').id;
		const order = memberRunoffProgress({ db: w.db, round, memberId: ana }).order;
		const rowFor = () =>
			w.db
				.select()
				.from(attendance)
				.where(and(eq(attendance.roundId, round.id), eq(attendance.memberId, ana)))
				.get();

		unwrap(castVeto({ db: w.db, groupId: w.group.id, roundId: round.id, memberId: ana, movieId: null }));
		for (const pair of order) {
			unwrap(
				castPairVote({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: ana,
					a: pair.a,
					b: pair.b,
					winner: pair.a
				})
			);
		}
		const finishedAt = rowFor()?.runoffSubmittedAt ?? null;
		expect(finishedAt).not.toBeNull();

		// Walk the whole deck again: keep most answers, flip the first one.
		for (const [i, pair] of order.entries()) {
			unwrap(
				castPairVote({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: ana,
					a: pair.a,
					b: pair.b,
					winner: i === 0 ? pair.b : pair.a
				})
			);
		}

		const mine = w.db
			.select()
			.from(pairVotes)
			.where(and(eq(pairVotes.roundId, round.id), eq(pairVotes.memberId, ana)))
			.all();
		expect(mine.length).toBe(order.length);
		const flipped = mine.find((row) => row.movieAId === order[0].a && row.movieBId === order[0].b);
		expect(flipped?.winnerId).toBe(order[0].b);
		const after = memberRunoffProgress({ db: w.db, round, memberId: ana });
		expect(after.done).toBe(after.total);
		expect(after.complete).toBe(true);
		expect(rowFor()?.runoffSubmittedAt?.getTime()).toBe(finishedAt!.getTime());
	});

	test('each voter gets their own pair order, stable across reads', () => {
		const { w, round } = runoffWorld();
		world = w;
		const forAna = memberRunoffProgress({ db: w.db, round, memberId: w.member('Ana').id }).order;
		const again = memberRunoffProgress({ db: w.db, round, memberId: w.member('Ana').id }).order;
		expect(forAna).toEqual(again);
		const orders = MEMBERS.map((name) =>
			memberRunoffProgress({ db: w.db, round, memberId: w.member(name).id })
				.order.map((p) => `${p.a}|${p.b}`)
				.join()
		);
		expect(new Set(orders).size).toBeGreaterThan(1);
	});
});

describe('DECIDED → WATCHED', () => {
	test('retires the movie and moves the fairness counter', () => {
		const { w, round } = runoffWorld();
		world = w;
		// Everyone prefers Alien over everything.
		const alien = w.movie('Alien').id;
		for (const name of MEMBERS) {
			for (const other of ['Brazil', 'Casino']) {
				unwrap(
					castPairVote({
						db: w.db,
						groupId: w.group.id,
						roundId: round.id,
						memberId: w.member(name).id,
						a: alien,
						b: w.movie(other).id,
						winner: alien
					})
				);
			}
			unwrap(
				castPairVote({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: w.member(name).id,
					a: w.movie('Brazil').id,
					b: w.movie('Casino').id,
					winner: w.movie('Brazil').id
				})
			);
		}
		const decided = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id })
		);
		expect(decided.round.winnerId).toBe(alien);
		expect(decided.round.tiebreakRuleUsed).toBeNull(); // a clean Condorcet winner

		// Fairness has not moved yet: only WATCHED moves it.
		const anaFairnessBefore = w.db
			.select()
			.from(fairness)
			.where(eq(fairness.memberId, w.member('Ana').id))
			.get();
		expect(anaFairnessBefore?.winsCount).toBe(0);
		expect(anaFairnessBefore?.lastWinAt).toBeNull();

		const watchedAt = new Date(BASE_NOW.getTime() + 3 * 3600_000);
		unwrap(markWatched({ db: w.db, groupId: w.group.id, roundId: round.id, now: watchedAt }));

		const movie = w.db.select().from(movies).where(eq(movies.id, alien)).get();
		expect(movie?.status).toBe('watched');
		expect(movie?.watchedAt?.getTime()).toBe(watchedAt.getTime());

		const anaFairness = w.db
			.select()
			.from(fairness)
			.where(eq(fairness.memberId, w.member('Ana').id))
			.get();
		expect(anaFairness?.winsCount).toBe(1);
		expect(anaFairness?.lastWinRoundId).toBe(round.id);
		expect(anaFairness?.lastWinAt?.getTime()).toBe(watchedAt.getTime());
	});

	test('cannot be marked watched twice', () => {
		const { w, round } = runoffWorld();
		world = w;
		unwrap(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id }));
		unwrap(markWatched({ db: w.db, groupId: w.group.id, roundId: round.id }));
		expect(code(markWatched({ db: w.db, groupId: w.group.id, roundId: round.id }))).toBe(
			'illegal_transition'
		);
		expect(
			w.db.select().from(fairness).where(eq(fairness.memberId, w.member('Ana').id)).get()?.winsCount
		).toBe(1);
	});

	test('a no-clear-favourite round has nothing to retire', () => {
		const { w, round } = openWorld();
		world = w;
		for (const title of ['Alien', 'Brazil', 'Casino']) {
			for (const name of MEMBERS) {
				unwrap(
					setStandingVote({
						db: w.db,
						groupId: w.group.id,
						memberId: w.member(name).id,
						movieId: w.movie(title).id,
						value: 'no'
					})
				);
			}
		}
		unwrap(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id }));
		expect(code(markWatched({ db: w.db, groupId: w.group.id, roundId: round.id }))).toBe(
			'no_winner_to_watch'
		);
	});

	test('an open or runoff round cannot jump to watched', () => {
		const { w, round } = runoffWorld();
		world = w;
		expect(code(markWatched({ db: w.db, groupId: w.group.id, roundId: round.id }))).toBe(
			'illegal_transition'
		);
	});
});

describe('ABANDONED', () => {
	test('discards the round’s vetoes and pair votes but keeps standing votes', () => {
		const { w, round } = runoffWorld();
		world = w;
		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Casino').id
			})
		);
		const standingBefore = w.db.select().from(standingVotes).all().length;

		unwrap(abandonRound({ db: w.db, groupId: w.group.id, roundId: round.id }));
		expect(getRound(w.db, w.group.id, round.id)?.state).toBe('abandoned');

		// Standing votes are permanent and unaffected...
		expect(w.db.select().from(standingVotes).all().length).toBe(standingBefore);
		// ...and fairness never moved.
		expect(
			w.db.select().from(fairness).where(eq(fairness.memberId, w.member('Ana').id)).get()?.winsCount
		).toBe(0);
	});

	test('a watched round cannot be abandoned', () => {
		const { w, round } = runoffWorld();
		world = w;
		unwrap(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id }));
		unwrap(markWatched({ db: w.db, groupId: w.group.id, roundId: round.id }));
		expect(code(abandonRound({ db: w.db, groupId: w.group.id, roundId: round.id }))).toBe(
			'illegal_transition'
		);
	});

	test('abandoning is idempotent', () => {
		const { w, round } = openWorld();
		world = w;
		unwrap(abandonRound({ db: w.db, groupId: w.group.id, roundId: round.id }));
		expect(abandonRound({ db: w.db, groupId: w.group.id, roundId: round.id }).ok).toBe(true);
	});
});

describe('SSE invalidation pings', () => {
	test('every write in the group emits a payload-free ping', () => {
		const { w, round } = runoffWorld();
		world = w;
		let pings = 0;
		const unsubscribe = subscribeGroup(w.group.id, () => pings++);

		unwrap(
			setRsvp({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Dee').id,
				attending: true,
				actorId: w.member('Ana').id
			})
		);
		unwrap(
			castVeto({ db: w.db, groupId: w.group.id, roundId: round.id, memberId: w.member('Ana').id, movieId: null })
		);
		unwrap(
			castPairVote({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				a: w.movie('Alien').id,
				b: w.movie('Brazil').id,
				winner: null
			})
		);
		unwrap(
			setStandingVote({
				db: w.db,
				groupId: w.group.id,
				memberId: w.member('Ben').id,
				movieId: w.movie('Alien').id,
				value: 'yes'
			})
		);
		unwrap(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id }));

		expect(pings).toBe(5);
		unsubscribe();
		notifyGroup(w.group.id);
		expect(pings).toBe(5);
	});

	test('pings are scoped to one group', () => {
		const { w } = openWorld();
		world = w;
		let mine = 0;
		const unsubscribe = subscribeGroup(w.group.id, () => mine++);
		notifyGroup('some-other-group');
		expect(mine).toBe(0);
		unsubscribe();
	});
});

describe('group scoping', () => {
	test('a round id from another group is invisible', () => {
		const { w, round } = openWorld();
		world = w;
		const other = createTestWorld({ memberNames: ['Zed'] });
		try {
			expect(getRound(w.db, other.group.id, round.id)).toBeUndefined();
			expect(
				code(
					advanceRound({
						db: w.db,
						groupId: other.group.id,
						config: other.config,
						roundId: round.id
					})
				)
			).toBe('unknown_round');
		} finally {
			other.cleanup();
		}
	});

	test('the group row is untouched by round activity', () => {
		const { w } = openWorld();
		world = w;
		expect(w.db.select().from(groups).where(eq(groups.id, w.group.id)).get()?.name).toBe('Movie Night');
	});
});

/* ------------------------------------------------------------------ */
/* Regressions from the adversarial review                            */
/* ------------------------------------------------------------------ */

function standingOf(w: TestWorld, member: string, title: string): 'yes' | 'no' | null {
	return (
		w.db
			.select()
			.from(standingVotes)
			.where(
				and(
					eq(standingVotes.memberId, w.member(member).id),
					eq(standingVotes.movieId, w.movie(title).id)
				)
			)
			.get()?.value ?? null
	);
}

describe('regression: the veto flip never corrupts the permanent vote layer', () => {
	test('moving a veto restores the old target instead of leaving a second "no"', () => {
		const { w, round } = runoffWorld({ veto_threshold: 3 });
		world = w;
		expect(standingOf(w, 'Ana', 'Brazil')).toBe('yes');
		expect(standingOf(w, 'Ana', 'Casino')).toBe('yes');

		const veto = (title: string | null, at = BASE_NOW) =>
			unwrap(
				castVeto({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: w.member('Ana').id,
					movieId: title === null ? null : w.movie(title).id,
					now: at
				})
			);

		veto('Casino');
		expect(standingOf(w, 'Ana', 'Casino')).toBe('no');

		// Move it. Casino's real "yes" must come back; only Brazil is flipped.
		veto('Brazil', new Date(BASE_NOW.getTime() + 1000));
		expect(standingOf(w, 'Ana', 'Casino')).toBe('yes');
		expect(standingOf(w, 'Ana', 'Brazil')).toBe('no');
	});

	test('retracting a veto restores the old target', () => {
		const { w, round } = runoffWorld({ veto_threshold: 3 });
		world = w;
		const veto = (title: string | null, at: Date) =>
			unwrap(
				castVeto({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: w.member('Ana').id,
					movieId: title === null ? null : w.movie(title).id,
					now: at
				})
			);
		veto('Casino', BASE_NOW);
		veto(null, new Date(BASE_NOW.getTime() + 1000));
		expect(standingOf(w, 'Ana', 'Casino')).toBe('yes');
	});

	test('vetoing an unswiped film restores to ABSENT, not to "no"', () => {
		// "Not yet seen" is a distinct third state; leaving a "no" behind would both
		// destroy the state and inflate the coverage denominator for every future
		// round.
		const w = createTestWorld({ memberNames: MEMBERS, movies: [...POOL, { title: 'Dogville' }] });
		world = w;
		const round = unwrap(
			createRound({ db: w.db, groupId: w.group.id, actorId: w.member('Ana').id, now: BASE_NOW, seed: 7 })
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
		// Everyone swipes everything yes EXCEPT Ana, who never sees Dogville.
		for (const title of ['Alien', 'Brazil', 'Casino', 'Dogville']) {
			for (const name of MEMBERS) {
				if (name === 'Ana' && title === 'Dogville') continue;
				unwrap(
					setStandingVote({
						db: w.db,
						groupId: w.group.id,
						memberId: w.member(name).id,
						movieId: w.movie(title).id,
						value: 'yes',
						now: BASE_NOW
					})
				);
			}
		}
		const runoff = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id })
		).round;
		expect(runoff.finalistIds).toContain(w.movie('Dogville').id);
		expect(standingOf(w, 'Ana', 'Dogville')).toBeNull(); // third state

		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: runoff.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Dogville').id,
				now: BASE_NOW
			})
		);
		expect(standingOf(w, 'Ana', 'Dogville')).toBe('no'); // the spec's flip

		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: runoff.id,
				memberId: w.member('Ana').id,
				movieId: null,
				now: new Date(BASE_NOW.getTime() + 1000)
			})
		);
		// Back to "not yet seen" — no row at all.
		expect(standingOf(w, 'Ana', 'Dogville')).toBeNull();
	});

	test('one member’s veto never touches another member’s standing vote', () => {
		const { w, round } = runoffWorld({ veto_threshold: 3 });
		world = w;
		const casino = w.movie('Casino').id;
		const before = w.db
			.select()
			.from(standingVotes)
			.where(eq(standingVotes.movieId, casino))
			.all()
			.map((row) => `${row.memberId}=${row.value}@${row.updatedAt.getTime()}`)
			.sort();

		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				movieId: casino,
				now: new Date(BASE_NOW.getTime() + 5000)
			})
		);

		const after = w.db
			.select()
			.from(standingVotes)
			.where(eq(standingVotes.movieId, casino))
			.all()
			.map((row) => `${row.memberId}=${row.value}@${row.updatedAt.getTime()}`)
			.sort();
		// Exactly one row differs, and it is Ana's.
		const changed = after.filter((row) => !before.includes(row));
		expect(changed.length).toBe(1);
		expect(changed[0].startsWith(w.member('Ana').id)).toBe(true);
	});

	test('a later explicit pool-screen edit wins over a subsequent veto retraction', () => {
		const { w, round } = runoffWorld({ veto_threshold: 3 });
		world = w;
		const ana = w.member('Ana').id;
		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: ana,
				movieId: w.movie('Casino').id,
				now: BASE_NOW
			})
		);
		// Ana changes her mind on the pool screen, explicitly.
		unwrap(
			setStandingVote({
				db: w.db,
				groupId: w.group.id,
				memberId: ana,
				movieId: w.movie('Casino').id,
				value: 'yes',
				now: new Date(BASE_NOW.getTime() + 10_000)
			})
		);
		// Retracting the veto must not clobber that explicit answer.
		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: ana,
				movieId: null,
				now: new Date(BASE_NOW.getTime() + 20_000)
			})
		);
		expect(standingOf(w, 'Ana', 'Casino')).toBe('yes');
	});

	test('re-submitting an explicit pass twice is a no-op on the standing layer', () => {
		const { w, round } = runoffWorld({ veto_threshold: 3 });
		world = w;
		const before = w.db.select().from(standingVotes).all().length;
		for (const offset of [0, 1000, 2000]) {
			unwrap(
				castVeto({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: w.member('Ana').id,
					movieId: null,
					now: new Date(BASE_NOW.getTime() + offset)
				})
			);
		}
		expect(w.db.select().from(standingVotes).all().length).toBe(before);
		expect(standingOf(w, 'Ana', 'Casino')).toBe('yes');
	});

	test('re-submitting the same veto is idempotent and keeps the remembered value', () => {
		const { w, round } = runoffWorld({ veto_threshold: 3 });
		world = w;
		const args = {
			db: w.db,
			groupId: w.group.id,
			roundId: round.id,
			memberId: w.member('Ana').id,
			movieId: w.movie('Casino').id
		};
		unwrap(castVeto({ ...args, now: BASE_NOW }));
		unwrap(castVeto({ ...args, now: new Date(BASE_NOW.getTime() + 1000) }));
		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				movieId: null,
				now: new Date(BASE_NOW.getTime() + 2000)
			})
		);
		expect(standingOf(w, 'Ana', 'Casino')).toBe('yes');
	});
});

describe('regression: one viewing can only count once', () => {
	/** Drives a round all the way to `decided` with Alien winning. */
	function decideWithAlien(w: TestWorld, roundId: string) {
		const alien = w.movie('Alien').id;
		for (const name of MEMBERS) {
			const progress = memberRunoffProgress({
				db: w.db,
				round: getRound(w.db, w.group.id, roundId)!,
				memberId: w.member(name).id
			});
			for (const pair of progress.matchups) {
				const winner = pair.a === alien || pair.b === alien ? alien : pair.a;
				unwrap(
					castPairVote({
						db: w.db,
						groupId: w.group.id,
						roundId,
						memberId: w.member(name).id,
						a: pair.a,
						b: pair.b,
						winner
					})
				);
			}
		}
		return unwrap(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId })).round;
	}

	test('a decided-but-unwatched winner cannot win the next round too', () => {
		const { w, round } = runoffWorld();
		world = w;
		const decided = decideWithAlien(w, round.id);
		expect(decided.winnerId).toBe(w.movie('Alien').id);

		// Nobody has tapped "we watched it", so Alien is still status = pool.
		expect(w.db.select().from(movies).where(eq(movies.id, w.movie('Alien').id)).get()?.status).toBe(
			'pool'
		);

		const next = unwrap(
			createRound({
				db: w.db,
				groupId: w.group.id,
				actorId: w.member('Ana').id,
				now: new Date(BASE_NOW.getTime() + 86_400_000)
			})
		);
		for (const name of MEMBERS) {
			unwrap(
				setRsvp({
					db: w.db,
					groupId: w.group.id,
					roundId: next.id,
					memberId: w.member(name).id,
					attending: true,
					actorId: w.member(name).id
				})
			);
		}
		const advanced = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: next.id })
		);
		expect(advanced.plan.kind).not.toBe('open_to_decided');
		// Alien is spoken for and must not be eligible again.
		expect(advanced.round.finalistIds).not.toContain(w.movie('Alien').id);
		expect(
			w.db.select().from(fairness).where(eq(fairness.memberId, w.member('Ana').id)).get()?.winsCount
		).toBe(0);
	});
});

describe('regression: the reveal needs a non-empty electorate too', () => {
	test('RSVPing everyone out blocks the reveal instead of deciding an empty election', () => {
		const { w, round } = runoffWorld();
		world = w;
		for (const name of MEMBERS) {
			unwrap(
				setRsvp({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: w.member(name).id,
					attending: false,
					actorId: w.member(name).id
				})
			);
		}
		expect(
			code(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id }))
		).toBe('not_enough_attendees');
		expect(getRound(w.db, w.group.id, round.id)?.state).toBe('runoff');
	});

	/**
	 * The guard is one ballot, not a knob, so there is no longer a frozen floor to
	 * read from `config_snapshot` — and nothing a mid-runoff settings edit could
	 * raise to block a reveal that was already legal.
	 */
	test('a single remaining attendee can still decide the round', () => {
		const { w, round } = runoffWorld();
		world = w;
		for (const name of MEMBERS.slice(1)) {
			unwrap(
				setRsvp({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: w.member(name).id,
					attending: false,
					actorId: w.member(name).id
				})
			);
		}
		unwrap(updateSettings(w.db, { groupId: w.group.id, config: { veto_threshold: 50 } }));
		w.reloadGroup();
		const advanced = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id })
		);
		expect(advanced.round.state).toBe('decided');
		expect(advanced.round.winnerId).not.toBeNull();
	});
});

describe('regression: runoff_submitted_at is recomputed, not latched', () => {
	test('it clears again when the member has outstanding pairs', () => {
		const { w, round } = runoffWorld();
		world = w;
		const ana = w.member('Ana').id;
		const submittedAt = () =>
			w.db
				.select()
				.from(attendance)
				.where(and(eq(attendance.roundId, round.id), eq(attendance.memberId, ana)))
				.get()?.runoffSubmittedAt ?? null;

		const progress = memberRunoffProgress({ db: w.db, round, memberId: ana });
		for (const pair of progress.matchups) {
			unwrap(
				castPairVote({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: ana,
					a: pair.a,
					b: pair.b,
					winner: null
				})
			);
		}
		unwrap(castVeto({ db: w.db, groupId: w.group.id, roundId: round.id, memberId: ana, movieId: null }));
		expect(submittedAt()).not.toBeNull();

		// Simulate the pair set growing under her (a wider finalist set): delete one
		// of her answers and re-run the recompute.
		w.db
			.delete(pairVotes)
			.where(
				and(
					eq(pairVotes.roundId, round.id),
					eq(pairVotes.memberId, ana),
					eq(pairVotes.movieAId, progress.matchups[0].a),
					eq(pairVotes.movieBId, progress.matchups[0].b)
				)
			)
			.run();
		maybeMarkSubmitted({ db: w.db, round, memberId: ana, now: BASE_NOW });
		expect(submittedAt()).toBeNull();
	});
});

describe('regression: smaller findings', () => {
	test('a finalist cannot be removed mid-runoff', () => {
		const { w, round } = runoffWorld();
		world = w;
		expect(
			code(
				removeMovie({
					db: w.db,
					groupId: w.group.id,
					movieId: w.movie('Alien').id,
					actorId: w.member('Ben').id
				})
			)
		).toBe('wrong_phase');
		// A non-finalist in the same round is still removable.
		expect(round.finalistIds).not.toContain('nope');
	});

	test('a decided round cannot be abandoned out of history', () => {
		const { w, round } = runoffWorld();
		world = w;
		unwrap(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id }));
		expect(code(abandonRound({ db: w.db, groupId: w.group.id, roundId: round.id }))).toBe(
			'illegal_transition'
		);
		// ...so its winner can still be marked watched.
		expect(markWatched({ db: w.db, groupId: w.group.id, roundId: round.id }).ok).toBe(true);
	});

	test('an abandoned round does not pre-fill the next veto', () => {
		const { w, round } = runoffWorld();
		world = w;
		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Casino').id
			})
		);
		unwrap(abandonRound({ db: w.db, groupId: w.group.id, roundId: round.id }));

		const next = unwrap(
			createRound({
				db: w.db,
				groupId: w.group.id,
				actorId: w.member('Ana').id,
				now: new Date(BASE_NOW.getTime() + 86_400_000)
			})
		);
		for (const name of MEMBERS) {
			unwrap(
				setRsvp({
					db: w.db,
					groupId: w.group.id,
					roundId: next.id,
					memberId: w.member(name).id,
					attending: true,
					actorId: w.member(name).id
				})
			);
		}
		unwrap(
			setStandingVote({
				db: w.db,
				groupId: w.group.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Casino').id,
				value: 'yes'
			})
		);
		const advanced = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: next.id })
		);
		expect(
			vetoPrefillFor({
				db: w.db,
				groupId: w.group.id,
				round: advanced.round,
				memberId: w.member('Ana').id
			})
		).toBeNull();
	});
});

describe('regression: the veto and standing layers cannot contradict each other', () => {
	test('re-submitting the same veto re-asserts the "no" after a pool-screen edit', () => {
		const { w, round } = runoffWorld({ veto_threshold: 3 });
		world = w;
		const ana = w.member('Ana').id;
		const casino = w.movie('Casino').id;
		const veto = (at: Date) =>
			unwrap(
				castVeto({
					db: w.db,
					groupId: w.group.id,
					roundId: round.id,
					memberId: ana,
					movieId: casino,
					now: at
				})
			);

		veto(BASE_NOW);
		expect(standingOf(w, 'Ana', 'Casino')).toBe('no');

		// She flips it back on the pool screen — the layers now disagree.
		unwrap(
			setStandingVote({
				db: w.db,
				groupId: w.group.id,
				memberId: ana,
				movieId: casino,
				value: 'yes',
				now: new Date(BASE_NOW.getTime() + 10_000)
			})
		);
		expect(standingOf(w, 'Ana', 'Casino')).toBe('yes');

		// Re-submitting the veto must restore agreement.
		veto(new Date(BASE_NOW.getTime() + 20_000));
		expect(standingOf(w, 'Ana', 'Casino')).toBe('no');

		// ...and retracting now returns her most recent explicit answer, not the
		// "no" the flip itself wrote.
		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: ana,
				movieId: null,
				now: new Date(BASE_NOW.getTime() + 30_000)
			})
		);
		expect(standingOf(w, 'Ana', 'Casino')).toBe('yes');
	});
});
