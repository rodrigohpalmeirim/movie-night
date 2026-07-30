/**
 * The hidden-tallies invariant, enforced at the serialisation layer.
 *
 * voting-spec: "Results stay hidden until the round closes ... treat it as a hard
 * requirement, not a preference. A voter always sees their own standing votes;
 * only aggregates are hidden."
 * app-spec: "Aggregates are **never** serialized to the client before the round is
 * `decided` — hidden tallies are enforced at the API layer, not by UI omission."
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { rounds } from './db/index.js';
import { unwrap } from './result.js';
import { removeMovie, setStandingVote } from './services/movies.js';
import {
	advanceRound,
	castPairVote,
	castVeto,
	createRound,
	getRound,
	markWatched,
	memberRunoffProgress,
	setRsvp
} from './services/rounds.js';
import {
	buildHistoryView,
	buildPoolView,
	buildRoundView,
	buildSettingsView,
	unsubmittedAttendees
} from './services/views.js';
import { AGGREGATE_KEYS, BASE_NOW, collectKeys, createTestWorld, type TestWorld } from './testing.js';

let world: TestWorld | undefined;
afterEach(() => {
	world?.cleanup();
	world = undefined;
});

const MEMBERS = ['Ana', 'Ben', 'Cal', 'Dee'];
const POOL = [
	{ title: 'Alien', runtimeMin: 117, suggestedBy: 'Ana' },
	{ title: 'Brazil', runtimeMin: 132, suggestedBy: 'Ben' },
	{ title: 'Casino', runtimeMin: 178, suggestedBy: 'Cal' }
];
const YES_COUNT: Record<string, number> = { Alien: 4, Brazil: 3, Casino: 2 };

function scenario() {
	const w = createTestWorld({ memberNames: MEMBERS, movies: POOL });
	const round = unwrap(
		createRound({ db: w.db, groupId: w.group.id, actorId: w.member('Ana').id, now: BASE_NOW, seed: 4242 })
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

function toRunoff(w: TestWorld, roundId: string) {
	return unwrap(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId })).round;
}

function view(w: TestWorld, name: string, round?: ReturnType<typeof getRound>) {
	return buildRoundView({
		db: w.db,
		group: w.group,
		config: w.config,
		me: w.member(name),
		round: round ?? getRound(w.db, w.group.id, w.db.select().from(rounds).get()!.id)
	})!;
}

/** Strips the viewer's own block, which is allowed to contain their own answers. */
function withoutMine(roundView: object): object {
	const { me, ...rest } = roundView as Record<string, unknown>;
	void me;
	return rest;
}

function assertNoAggregates(payload: object, label: string) {
	const keys = collectKeys(payload);
	const leaked = AGGREGATE_KEYS.filter((key) => keys.has(key));
	expect(leaked, `${label} must not serialise aggregates`).toEqual([]);
}

/* ------------------------------------------------------------------ */

describe('no aggregate is serialised before the round is decided', () => {
	test('an OPEN round leaks nothing', () => {
		const { w } = scenario();
		world = w;
		const payload = view(w, 'Ana');
		expect(payload.state).toBe('open');
		expect(payload.reveal).toBeNull();
		assertNoAggregates(withoutMine(payload), 'the OPEN round view');
	});

	test('a RUNOFF round leaks nothing, even with every vote cast', () => {
		const { w, round } = scenario();
		world = w;
		const runoff = toRunoff(w, round.id);

		for (const name of MEMBERS) {
			const progress = memberRunoffProgress({ db: w.db, round: runoff, memberId: w.member(name).id });
			for (const pair of progress.matchups) {
				unwrap(
					castPairVote({
						db: w.db,
						groupId: w.group.id,
						roundId: runoff.id,
						memberId: w.member(name).id,
						a: pair.a,
						b: pair.b,
						winner: pair.a
					})
				);
			}
			unwrap(
				castVeto({
					db: w.db,
					groupId: w.group.id,
					roundId: runoff.id,
					memberId: w.member(name).id,
					movieId: name === 'Dee' ? w.movie('Casino').id : null
				})
			);
		}

		const payload = view(w, 'Ben', getRound(w.db, w.group.id, runoff.id));
		expect(payload.state).toBe('runoff');
		expect(payload.reveal).toBeNull();
		assertNoAggregates(withoutMine(payload), 'the RUNOFF round view');
	});

	test('the scan is not vacuous: the same check FAILS on a decided round', () => {
		// Guards the guard. If `AGGREGATE_KEYS` ever stopped matching the real field
		// names, the pre-decided assertions above would pass for the wrong reason.
		const { w, round } = scenario();
		world = w;
		const runoff = toRunoff(w, round.id);
		const decided = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: runoff.id })
		).round;
		const keys = collectKeys(withoutMine(view(w, 'Ana', decided)));
		const found = AGGREGATE_KEYS.filter((key) => keys.has(key));
		expect(found).toContain('tallies');
		expect(found).toContain('approval');
		expect(found).toContain('copeland');
		expect(found).toContain('randomSeed');
		expect(found.length).toBeGreaterThan(10);
	});

	test('the pool view never leaks aggregates, at any phase', () => {
		const { w, round } = scenario();
		world = w;
		const pool = buildPoolView({ db: w.db, group: w.group, me: w.member('Ana') });
		assertNoAggregates(pool, 'the pool view');
		toRunoff(w, round.id);
		assertNoAggregates(buildPoolView({ db: w.db, group: w.group, me: w.member('Ana') }), 'the pool view in runoff');
	});

	test('participants carry participation status and nothing else', () => {
		const { w, round } = scenario();
		world = w;
		const runoff = toRunoff(w, round.id);
		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: runoff.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Casino').id
			})
		);
		const payload = view(w, 'Ben', getRound(w.db, w.group.id, runoff.id));
		for (const participant of payload.participants) {
			expect(Object.keys(participant).sort()).toEqual([
				'attending',
				'displayName',
				'markedBy',
				'memberId',
				'submitted'
			]);
		}
	});

	test('a member sees their own veto and pairs; another member sees neither', () => {
		const { w, round } = scenario();
		world = w;
		const runoff = toRunoff(w, round.id);
		const casino = w.movie('Casino').id;
		unwrap(
			castVeto({ db: w.db, groupId: w.group.id, roundId: runoff.id, memberId: w.member('Ana').id, movieId: casino })
		);
		unwrap(
			castPairVote({
				db: w.db,
				groupId: w.group.id,
				roundId: runoff.id,
				memberId: w.member('Ana').id,
				a: w.movie('Alien').id,
				b: w.movie('Brazil').id,
				winner: w.movie('Alien').id
			})
		);
		const stored = getRound(w.db, w.group.id, runoff.id);

		const anaView = view(w, 'Ana', stored);
		expect(anaView.me.myVetoMovieId).toBe(casino);
		expect(anaView.me.vetoSubmitted).toBe(true);
		expect(anaView.me.myPairVotes.length).toBe(1);

		const benView = view(w, 'Ben', stored);
		expect(benView.me.myVetoMovieId).toBeNull();
		expect(benView.me.vetoSubmitted).toBe(false);
		expect(benView.me.myPairVotes).toEqual([]);
		// Ana has cast one of her three pairs, so she is not finished. Ben may see
		// *whether* she finished, never *what* she chose.
		expect(anaView.me.pairsDone).toBe(1);
		expect(anaView.me.pairsTotal).toBe(3);
		expect(benView.participants.find((p) => p.displayName === 'Ana')?.submitted).toBe(false);
	});

	test('progress is per-voter only', () => {
		const { w, round } = scenario();
		world = w;
		const runoff = toRunoff(w, round.id);
		const progress = memberRunoffProgress({ db: w.db, round: runoff, memberId: w.member('Ana').id });
		unwrap(
			castPairVote({
				db: w.db,
				groupId: w.group.id,
				roundId: runoff.id,
				memberId: w.member('Ana').id,
				a: progress.matchups[0].a,
				b: progress.matchups[0].b,
				winner: null
			})
		);
		const stored = getRound(w.db, w.group.id, runoff.id);
		expect(view(w, 'Ana', stored).me.pairsDone).toBe(1);
		expect(view(w, 'Ben', stored).me.pairsDone).toBe(0);
		expect(view(w, 'Ana', stored).me.pairsTotal).toBe(3);
	});
});

describe('the reveal', () => {
	function decidedScenario() {
		const { w, round } = scenario();
		const runoff = toRunoff(w, round.id);
		const alien = w.movie('Alien').id;
		// Everyone prefers Alien; Dee vetoes Casino.
		for (const name of MEMBERS) {
			for (const other of ['Brazil', 'Casino']) {
				unwrap(
					castPairVote({
						db: w.db,
						groupId: w.group.id,
						roundId: runoff.id,
						memberId: w.member(name).id,
						a: alien,
						b: w.movie(other).id,
						winner: alien
					})
				);
			}
		}
		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: runoff.id,
				memberId: w.member('Dee').id,
				movieId: w.movie('Casino').id
			})
		);
		const decided = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: runoff.id })
		).round;
		return { w, decided };
	}

	test('opens up once the round is decided', () => {
		const { w, decided } = decidedScenario();
		world = w;
		const payload = view(w, 'Ben', decided);
		expect(payload.state).toBe('decided');
		expect(payload.reveal).not.toBeNull();

		const reveal = payload.reveal!;
		expect(reveal.outcome).toBe('winner');
		expect(reveal.winner?.id).toBe(w.movie('Alien').id);
		expect(reveal.tallies.length).toBe(3);
		expect(reveal.tallies.find((t) => t.movieId === w.movie('Alien').id)?.approval).toBeCloseTo(1, 10);
		// Casino was vetoed out, so the round robin is Alien vs Brazil only.
		expect(reveal.matrix.length).toBe(1);
		expect(reveal.veto.disqualifiedIds).toEqual([w.movie('Casino').id]);
		expect(reveal.veto.counts[w.movie('Casino').id]).toBe(1);
		expect(reveal.copeland[w.movie('Alien').id]).toBe(1);
		expect(reveal.condorcetWinnerId).toBe(w.movie('Alien').id);
	});

	test('includes the seeded-random proof and the tiebreak rule used', () => {
		const { w, decided } = decidedScenario();
		world = w;
		const reveal = view(w, 'Ana', decided).reveal!;
		expect(reveal.randomSeed).toBe(4242);
		// A clean Condorcet winner means no tiebreak rule was consulted.
		expect(reveal.tiebreakRuleUsed).toBeNull();
		expect(reveal.decidedAt).not.toBeNull();
	});

	test('the recomputed reveal agrees with the persisted winner', () => {
		const { w, decided } = decidedScenario();
		world = w;
		const reveal = view(w, 'Ana', decided).reveal!;
		expect(reveal.winner?.id ?? null).toBe(decided.winnerId);
		expect(reveal.tiebreakRuleUsed).toEqual(decided.tiebreakRuleUsed);
	});

	test('stays open after the movie is marked watched', () => {
		const { w, decided } = decidedScenario();
		world = w;
		unwrap(markWatched({ db: w.db, groupId: w.group.id, roundId: decided.id }));
		const payload = view(w, 'Ana', getRound(w.db, w.group.id, decided.id));
		expect(payload.state).toBe('watched');
		expect(payload.reveal?.watchedAt).not.toBeNull();
	});

	test('a no-clear-favourite round reveals the outcome and no winner', () => {
		const { w, round } = scenario();
		world = w;
		for (const movie of POOL) {
			for (const name of MEMBERS) {
				unwrap(
					setStandingVote({
						db: w.db,
						groupId: w.group.id,
						memberId: w.member(name).id,
						movieId: w.movie(movie.title).id,
						value: 'no'
					})
				);
			}
		}
		const decided = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id })
		).round;
		const reveal = view(w, 'Ana', decided).reveal!;
		expect(reveal.outcome).toBe('no_clear_favourite');
		expect(reveal.winner).toBeNull();
		expect(reveal.finalists).toEqual([]);
	});

	test('an outright winner reveals its approval numbers', () => {
		const { w, round } = scenario();
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
		const decided = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id })
		).round;
		const reveal = view(w, 'Ana', decided).reveal!;
		expect(reveal.winner?.id).toBe(w.movie('Alien').id);
		expect(reveal.tallies.length).toBe(1);
		expect(reveal.tallies[0].yesVotes).toBe(4);
		expect(reveal.matrix).toEqual([]);
	});
});

describe('participation warnings', () => {
	test('unsubmitted attendees are listed but never block the reveal', () => {
		const { w, round } = scenario();
		world = w;
		const runoff = toRunoff(w, round.id);
		expect(unsubmittedAttendees(w.db, runoff).length).toBe(4);

		const ana = w.member('Ana').id;
		const progress = memberRunoffProgress({ db: w.db, round: runoff, memberId: ana });
		for (const pair of progress.matchups) {
			unwrap(
				castPairVote({
					db: w.db,
					groupId: w.group.id,
					roundId: runoff.id,
					memberId: ana,
					a: pair.a,
					b: pair.b,
					winner: null
				})
			);
		}
		unwrap(castVeto({ db: w.db, groupId: w.group.id, roundId: runoff.id, memberId: ana, movieId: null }));
		expect(unsubmittedAttendees(w.db, getRound(w.db, w.group.id, runoff.id)!)).not.toContain(ana);

		// The reveal still goes through with three people yet to vote.
		expect(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: runoff.id }).ok).toBe(true);
	});

	test('the round view reports the RSVP breakdown', () => {
		const { w, round } = scenario();
		world = w;
		unwrap(
			setRsvp({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member('Dee').id,
				attending: false,
				actorId: w.member('Ana').id
			})
		);
		const payload = view(w, 'Ana');
		expect(payload.participation).toEqual({ attending: 3, out: 1, noAnswer: 0, submitted: 0 });
		expect(payload.participants.find((p) => p.displayName === 'Dee')?.markedBy?.displayName).toBe('Ana');
	});

	test('readiness reports how many attendees still have unswiped movies', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: POOL });
		const round = unwrap(
			createRound({ db: world.db, groupId: world.group.id, actorId: world.member('Ana').id })
		);
		for (const name of MEMBERS) {
			unwrap(
				setRsvp({
					db: world.db,
					groupId: world.group.id,
					roundId: round.id,
					memberId: world.member(name).id,
					attending: true,
					actorId: world.member(name).id
				})
			);
		}
		const before = view(world, 'Ana');
		expect(before.readiness).toEqual({ attendeeCount: 4, attendeesWithGaps: 4 });

		for (const movie of POOL) {
			unwrap(
				setStandingVote({
					db: world.db,
					groupId: world.group.id,
					memberId: world.member('Ana').id,
					movieId: world.movie(movie.title).id,
					value: 'yes'
				})
			);
		}
		expect(view(world, 'Ana').readiness.attendeesWithGaps).toBe(3);
	});

	test('the advance button explains why it is blocked', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: POOL });
		unwrap(createRound({ db: world.db, groupId: world.group.id, actorId: world.member('Ana').id }));
		const payload = view(world, 'Ana');
		expect(payload.transitions.canAdvance).toBe(false);
		expect(payload.transitions.advanceBlockedReason).toContain('3 are needed');
	});
});

describe('pool view', () => {
	test('shows my own standing vote as a third state', () => {
		const { w } = scenario();
		world = w;
		const pool = buildPoolView({ db: w.db, group: w.group, me: w.member('Dee') });
		const byTitle = new Map(pool.movies.map((movie) => [movie.title, movie]));
		expect(byTitle.get('Alien')?.myVote).toBe('yes');
		expect(byTitle.get('Casino')?.myVote).toBe('no');
	});

	test('an unswiped movie reads as null, not "no", and feeds the top-up count', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: POOL });
		const pool = buildPoolView({ db: world.db, group: world.group, me: world.member('Ana') });
		expect(pool.movies.every((movie) => movie.myVote === null)).toBe(true);
		expect(pool.unswipedCount).toBe(3);
	});

	test('removed movies disappear from the pool but keep their standing votes', () => {
		const { w } = scenario();
		world = w;
		const casino = w.movie('Casino').id;
		unwrap(
			removeMovie({ db: w.db, groupId: w.group.id, movieId: casino, actorId: w.member('Ben').id })
		);
		const pool = buildPoolView({ db: w.db, group: w.group, me: w.member('Ana') });
		expect(pool.movies.map((movie) => movie.title)).not.toContain('Casino');
		// The votes are still there for a later restore.
		expect(
			w.db.$client
				.query<{ n: number }, [string]>('select count(*) as n from standing_votes where movie_id = ?')
				.get(casino)?.n
		).toBe(4);
	});

	test('a watched movie stays visible with its watched stamp', () => {
		const { w, round } = scenario();
		world = w;
		const runoff = toRunoff(w, round.id);
		const decided = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: runoff.id })
		).round;
		unwrap(markWatched({ db: w.db, groupId: w.group.id, roundId: decided.id }));
		const pool = buildPoolView({ db: w.db, group: w.group, me: w.member('Ana') });
		const watched = pool.movies.find((movie) => movie.status === 'watched');
		expect(watched?.watchedAt).not.toBeNull();
	});
});

describe('history view', () => {
	test('lists only decided and watched rounds, newest first', () => {
		const { w, round } = scenario();
		world = w;
		expect(buildHistoryView({ db: w.db, group: w.group })).toEqual([]);

		const runoff = toRunoff(w, round.id);
		const decided = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: runoff.id })
		).round;
		unwrap(markWatched({ db: w.db, groupId: w.group.id, roundId: decided.id }));

		const entries = buildHistoryView({ db: w.db, group: w.group });
		expect(entries.length).toBe(1);
		expect(entries[0].roundId).toBe(decided.id);
		expect(entries[0].winner?.suggestedBy?.displayName).toBe('Ana');
		expect(entries[0].reveal.tallies.length).toBe(3);
	});

	test('an abandoned round never appears in history', () => {
		const { w, round } = scenario();
		world = w;
		w.db.update(rounds).set({ state: 'abandoned' }).where(eq(rounds.id, round.id)).run();
		expect(buildHistoryView({ db: w.db, group: w.group })).toEqual([]);
	});
});

describe('settings view', () => {
	test('exposes the invite token, the six knobs and the member list', () => {
		const { w } = scenario();
		world = w;
		const settings = buildSettingsView({ db: w.db, group: w.group, me: w.member('Ana') });
		expect(settings.inviteToken).toBe(w.group.inviteToken);
		expect(Object.keys(settings.config).sort()).toEqual([
			'approval_floor',
			'coverage_floor',
			'min_attendee_votes',
			'n_finalists',
			'rewatch_cooldown',
			'veto_threshold'
		]);
		expect(settings.members.map((m) => m.displayName)).toEqual(MEMBERS);
	});
});

/* ------------------------------------------------------------------ */
/* Regressions from the adversarial review                            */
/* ------------------------------------------------------------------ */

describe('regression: individual veto ballots are never published', () => {
	test('the reveal carries veto counts but no member→movie attribution', () => {
		const { w, round } = scenario();
		world = w;
		const runoff = toRunoff(w, round.id);
		const casino = w.movie('Casino').id;
		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: runoff.id,
				memberId: w.member('Dee').id,
				movieId: casino
			})
		);
		const decided = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: runoff.id })
		).round;

		const reveal = view(w, 'Ana', decided).reveal!;
		expect(reveal.veto.counts[casino]).toBe(1);
		// Aggregate only: no key anywhere in the reveal maps a member to a veto.
		expect(Object.keys(reveal.veto).sort()).toEqual([
			'counts',
			'disqualifiedIds',
			'survivingIds',
			'vetoesIgnored'
		]);
		const serialised = JSON.stringify(reveal);
		expect(serialised).not.toContain(w.member('Dee').id);
		// ...and the same holds for every history entry, forever.
		const history = buildHistoryView({ db: w.db, group: w.group });
		expect(JSON.stringify(history)).not.toContain(w.member('Dee').id);
	});
});

describe('regression: finalist order is not a served ranking', () => {
	test('pre-reveal finalists are shuffled per viewer, not in Phase-1 rank order', () => {
		const { w, round } = scenario();
		world = w;
		const runoff = toRunoff(w, round.id);
		// Stored order is the Phase-1 ranking: Alien (4 yes) then Brazil (3) then
		// Casino (2). Serving that verbatim would disclose the swipe tally ordinally.
		expect(runoff.finalistIds).toEqual([
			w.movie('Alien').id,
			w.movie('Brazil').id,
			w.movie('Casino').id
		]);

		const orders = MEMBERS.map((name) =>
			view(w, name, runoff)
				.finalists!.map((movie) => movie.title)
				.join()
		);
		// Every viewer sees the same SET...
		for (const order of orders) {
			expect(order.split(',').sort()).toEqual(['Alien', 'Brazil', 'Casino']);
		}
		// ...at least one of them in an order that is not the true ranking...
		expect(orders.some((order) => order !== 'Alien,Brazil,Casino')).toBe(true);
		// ...and each viewer's own order is stable across reloads.
		expect(view(w, 'Ana', runoff).finalists!.map((m) => m.title).join()).toBe(orders[0]);
	});

	test('the reveal may show the true rank order', () => {
		const { w, round } = scenario();
		world = w;
		const runoff = toRunoff(w, round.id);
		const decided = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: runoff.id })
		).round;
		expect(view(w, 'Ana', decided).finalists!.map((m) => m.title)).toEqual([
			'Alien',
			'Brazil',
			'Casino'
		]);
	});
});

describe('regression: the pair set does not leak other members’ vetoes', () => {
	test('every voter is asked the full round robin over the frozen finalist set', () => {
		const { w, round } = scenario();
		world = w;
		const runoff = toRunoff(w, round.id);
		const before = view(w, 'Ana', runoff).me.pairsTotal;
		expect(before).toBe(3); // C(3,2)

		// Dee disqualifies Casino. Ana must not be able to detect that from the size
		// or the contents of her own ballot.
		unwrap(
			castVeto({
				db: w.db,
				groupId: w.group.id,
				roundId: runoff.id,
				memberId: w.member('Dee').id,
				movieId: w.movie('Casino').id
			})
		);
		const after = view(w, 'Ana', getRound(w.db, w.group.id, runoff.id));
		expect(after.me.pairsTotal).toBe(before);
		const asked = new Set(after.me.pairOrder.flatMap((pair) => [pair.a, pair.b]));
		expect(asked.has(w.movie('Casino').id)).toBe(true);
		// The published finalist set and the ballot cover exactly the same films, so
		// the set difference names nothing.
		expect(asked.size).toBe(after.finalists!.length);
	});

	test('a non-attendee receives no ballot data at all', () => {
		const { w, round } = scenario();
		world = w;
		const runoff = toRunoff(w, round.id);
		unwrap(
			setRsvp({
				db: w.db,
				groupId: w.group.id,
				roundId: runoff.id,
				memberId: w.member('Dee').id,
				attending: false,
				actorId: w.member('Dee').id
			})
		);
		const dee = view(w, 'Dee', getRound(w.db, w.group.id, runoff.id));
		expect(dee.me.pairsTotal).toBe(0);
		expect(dee.me.pairOrder).toEqual([]);
		expect(dee.me.vetoPrefillMovieId).toBeNull();
		expect(dee.me.myPairVotes).toEqual([]);
		// An attendee still gets theirs.
		expect(view(w, 'Ana', getRound(w.db, w.group.id, runoff.id)).me.pairsTotal).toBe(3);
	});
});

describe('regression: the reveal has an attendee floor', () => {
	test('the transition surfaces a blocked reason when everyone is RSVPed out', () => {
		const { w, round } = scenario();
		world = w;
		const runoff = toRunoff(w, round.id);
		for (const name of MEMBERS) {
			unwrap(
				setRsvp({
					db: w.db,
					groupId: w.group.id,
					roundId: runoff.id,
					memberId: w.member(name).id,
					attending: false,
					actorId: w.member(name).id
				})
			);
		}
		const payload = view(w, 'Ana', getRound(w.db, w.group.id, runoff.id));
		expect(payload.transitions.canAdvance).toBe(false);
		expect(payload.transitions.advanceBlockedReason).toContain('decide a winner');
	});
});
