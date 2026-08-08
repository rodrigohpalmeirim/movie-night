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
import { fairness, movies, rounds, standingVotes, type MovieDetails } from './db/index.js';
import { unwrap } from './result.js';
import { removeMovie, setStandingVote } from './services/movies.js';
import {
	abandonRound,
	advanceRound,
	castPairVote,
	castVeto,
	createRound,
	getRound,
	markWatched,
	memberRunoffProgress,
	restartRound,
	setRsvp
} from './services/rounds.js';
import {
	buildHistoryView,
	buildLobbyView,
	buildPoolView,
	buildRoundView,
	buildSettingsView,
	unsubmittedAttendees
} from './services/views.js';
import { AGGREGATE_KEYS, BASE_NOW, collectKeys, createTestWorld, type TestWorld } from './testing.js';
import { load as loadRoundPage } from '../../routes/g/[token]/+page.server.js';

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

/** The round load's own event type, so the fake below is checked against it. */
type RoundPageEvent = Parameters<typeof loadRoundPage>[0];

/**
 * The home tab as the screen actually receives it. The real load is called
 * against a real database with the slice of `RequestEvent` it touches — what
 * `hooks.server.ts` puts in locals, plus the token in the path — so which screen
 * a state lands on (reveal or lobby) is answered by the code that decides it.
 */
function roundPage(w: TestWorld, name: string) {
	const url = new URL(`http://localhost/g/${w.group.inviteToken}`);
	const event = {
		locals: { db: w.db, group: w.group, config: w.config, member: w.member(name) },
		route: { id: '/g/[token]' },
		params: { token: w.group.inviteToken },
		request: new Request(url),
		url
	} as unknown as RoundPageEvent;
	return loadRoundPage(event) as {
		round: ReturnType<typeof buildRoundView>;
		lobby: ReturnType<typeof buildLobbyView> | null;
	};
}

/** The whole standing layer, in a stable order, values and stars included. */
function standingRows(w: TestWorld) {
	return w.db
		.select()
		.from(standingVotes)
		.orderBy(standingVotes.memberId, standingVotes.movieId)
		.all();
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
		// Ana's veto disqualified Casino (threshold 1), so her ballot is the single
		// surviving pair, which she has cast — she is finished. Ben may see *whether*
		// she finished, never *what* she chose.
		expect(anaView.me.pairsDone).toBe(1);
		expect(anaView.me.pairsTotal).toBe(1);
		expect(benView.participants.find((p) => p.displayName === 'Ana')?.submitted).toBe(true);
	});

	test('my own answers travel with their winner, and stay inside my own block', () => {
		// The review screen pre-selects the answer already on each pair, so the
		// winner (including the `null` that means "no preference") has to reach the
		// client. It may only ever reach the client who cast it: `winnerId` is in
		// AGGREGATE_KEYS, so `withoutMine` proves it appears nowhere else in the
		// payload — not even in the caster's own view outside `me`.
		const { w, round } = scenario();
		world = w;
		const runoff = toRunoff(w, round.id);
		const ana = w.member('Ana').id;
		const order = memberRunoffProgress({ db: w.db, round: runoff, memberId: ana }).order;
		const cast = (pair: { a: string; b: string }, winner: string | null) =>
			unwrap(
				castPairVote({
					db: w.db,
					groupId: w.group.id,
					roundId: runoff.id,
					memberId: ana,
					a: pair.a,
					b: pair.b,
					winner
				})
			);
		cast(order[0], order[0].a);
		cast(order[1], null);
		const stored = getRound(w.db, w.group.id, runoff.id);

		const anaView = view(w, 'Ana', stored);
		const mine = anaView.me.myPairVotes;
		expect(mine.length).toBe(2);
		for (const vote of mine) expect(Object.keys(vote).sort()).toEqual(['a', 'b', 'winnerId']);
		const byPair = new Map(mine.map((vote) => [`${vote.a}|${vote.b}`, vote.winnerId]));
		expect(byPair.get(`${order[0].a}|${order[0].b}`)).toBe(order[0].a);
		// A recorded "no preference" is an answer, and must be distinguishable from
		// an unanswered pair — hence `has` alongside a null value.
		expect(byPair.has(`${order[1].a}|${order[1].b}`)).toBe(true);
		expect(byPair.get(`${order[1].a}|${order[1].b}`)).toBeNull();

		// Re-casting is an upsert, so an edited answer replaces the old one rather
		// than arriving twice.
		cast(order[0], order[0].b);
		const edited = view(w, 'Ana', getRound(w.db, w.group.id, runoff.id)).me.myPairVotes;
		expect(edited.length).toBe(2);
		expect(edited.find((v) => v.a === order[0].a && v.b === order[0].b)?.winnerId).toBe(order[0].b);

		// Nobody else sees any of it, and no other branch of the payload carries it.
		const benView = view(w, 'Ben', stored);
		expect(benView.me.myPairVotes).toEqual([]);
		expect(collectKeys(withoutMine(benView)).has('winnerId')).toBe(false);
		expect(collectKeys(withoutMine(anaView)).has('winnerId')).toBe(false);
		assertNoAggregates(withoutMine(anaView), "the caster's own RUNOFF view");
		assertNoAggregates(withoutMine(benView), "another member's RUNOFF view");
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

	test('survives the watched stamp — the receipt outlives the screen that showed it', () => {
		// The home tab hands itself back to the lobby once a night is filed (see
		// "a watched night hands the home tab back to the lobby"), so this payload
		// is no longer what the round screen prints. It stays whole regardless: the
		// same reveal is what History serves for that night, tally and all.
		const { w, decided } = decidedScenario();
		world = w;
		unwrap(markWatched({ db: w.db, groupId: w.group.id, roundId: decided.id }));
		const payload = view(w, 'Ana', getRound(w.db, w.group.id, decided.id));
		expect(payload.state).toBe('watched');
		expect(payload.reveal?.watchedAt).not.toBeNull();

		const entry = buildHistoryView({ db: w.db, group: w.group })[0];
		expect(entry.state).toBe('watched');
		expect(entry.winner?.id).toBe(payload.reveal?.winner?.id);
		expect(entry.reveal.tallies).toEqual(payload.reveal!.tallies);
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
		// Nobody has RSVPed yet, so the electorate is empty.
		expect(payload.transitions.canAdvance).toBe(false);
		expect(payload.transitions.advanceBlockedReason).toContain('at least one person');
	});

	test('one attendee is a big enough electorate to close swiping', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: POOL });
		const round = unwrap(
			createRound({ db: world.db, groupId: world.group.id, actorId: world.member('Ana').id })
		);
		unwrap(
			setRsvp({
				db: world.db,
				groupId: world.group.id,
				roundId: round.id,
				memberId: world.member('Ana').id,
				attending: true,
				actorId: world.member('Ana').id
			})
		);
		const payload = view(world, 'Ana');
		expect(payload.transitions.canAdvance).toBe(true);
		expect(payload.transitions.advanceBlockedReason).toBeNull();
	});

	test('no flag offers a move the service would refuse', () => {
		// The flags name the buttons the round screen draws, so each one has to
		// agree with the guard behind it — a promised transition that fails on tap
		// is worse than no button.
		const { w, round } = scenario();
		world = w;
		const runoff = toRunoff(w, round.id);
		expect(view(w, 'Ana', runoff).transitions.canAbandon).toBe(true);

		const decided = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: runoff.id })
		).round;
		const flags = view(w, 'Ana', decided).transitions;
		// The two ways a picked night ends, both offered and both taken.
		expect(flags.canMarkWatched).toBe(true);
		expect(flags.canAbandon).toBe(true);
		// And the third way, which this night does not get: a re-deal is for the reveal
		// that picked nothing, so the flag is false and `restartRound` refuses it too.
		expect(flags.canRestart).toBe(false);
		expect(
			restartRound({
				db: w.db,
				groupId: w.group.id,
				roundId: decided.id,
				actorId: w.member('Ana').id
			}).ok
		).toBe(false);
		// The one flag deliberately quieter than the service behind it: `createRound`
		// would accept a decided round, but the only button that deals a night lives
		// on the lobby and a picked night does not show it. A flag may refuse what the
		// service allows; it may never promise what the service refuses.
		expect(flags.canCreateRound).toBe(false);
		const jumped = unwrap(createRound({ db: w.db, groupId: w.group.id, actorId: w.member('Ana').id }));
		unwrap(abandonRound({ db: w.db, groupId: w.group.id, roundId: jumped.id }));
		expect(abandonRound({ db: w.db, groupId: w.group.id, roundId: decided.id }).ok).toBe(true);
	});

	test('the no-pick reveal offers its one move, and the service takes it', () => {
		const { w, round } = scenario();
		world = w;
		// Nobody wants anything, so nothing clears the approval floor: OPEN → DECIDED
		// with no winner, the one state a re-deal is legal in.
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
		expect(decided.winnerId).toBeNull();

		const flags = view(w, 'Ana', decided).transitions;
		// The only button this screen draws — and no lobby underneath it yet.
		expect(flags.canRestart).toBe(true);
		expect(flags.canMarkWatched).toBe(false);
		expect(flags.canCreateRound).toBe(false);
		expect(
			restartRound({
				db: w.db,
				groupId: w.group.id,
				roundId: decided.id,
				actorId: w.member('Ana').id
			}).ok
		).toBe(true);
	});
});

describe('lobby view', () => {
	/**
	 * The payload for having no round. app-spec: "Suggestions are open at all
	 * times — the pool is persistent and independent of rounds", so the screen
	 * that has no night to describe still has a table to count.
	 */
	test('counts the standing table and my own stack when no round has ever existed', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: POOL });
		const w = world;
		expect(
			buildRoundView({ db: w.db, group: w.group, config: w.config, me: w.member('Ana') })
		).toBeNull();
		unwrap(
			setStandingVote({
				db: w.db,
				groupId: w.group.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Alien').id,
				value: 'yes',
				now: BASE_NOW
			})
		);
		// The table is the group's; the stack is the viewer's.
		expect(buildLobbyView({ db: w.db, group: w.group, me: w.member('Ana') })).toEqual({
			poolSize: 3,
			unswipedCount: 2
		});
		expect(buildLobbyView({ db: w.db, group: w.group, me: w.member('Ben') })).toEqual({
			poolSize: 3,
			unswipedCount: 3
		});
	});

	test('only films in the pool are on the table — watched and removed ones are not', () => {
		world = createTestWorld({
			memberNames: MEMBERS,
			movies: [
				{ title: 'Alien' },
				{ title: 'Brazil' },
				{ title: 'Casino', status: 'watched', watchedAt: BASE_NOW }
			]
		});
		const w = world;
		unwrap(
			removeMovie({
				db: w.db,
				groupId: w.group.id,
				movieId: w.movie('Brazil').id,
				actorId: w.member('Ana').id
			})
		);
		expect(buildLobbyView({ db: w.db, group: w.group, me: w.member('Ana') })).toEqual({
			poolSize: 1,
			unswipedCount: 1
		});
	});

	test('a cancelled night leaves the table exactly as it was', () => {
		const { w, round } = scenario();
		world = w;
		const before = buildLobbyView({ db: w.db, group: w.group, me: w.member('Ana') });
		unwrap(abandonRound({ db: w.db, groupId: w.group.id, roundId: round.id }));
		// "Standing swipes are kept": everyone swiped the whole pool in `scenario`,
		// so nobody has a stack, and abandoning takes nothing off the table.
		expect(before).toEqual({ poolSize: 3, unswipedCount: 0 });
		expect(buildLobbyView({ db: w.db, group: w.group, me: w.member('Ana') })).toEqual(before);
	});

	/**
	 * Which screen the home tab is, decided by the real load rather than by
	 * reading the markup: a watched night is filed in History, so the round screen
	 * goes back to being the lobby exactly as a cancelled one does.
	 */
	test('a watched night hands the home tab back to the lobby', () => {
		const { w, round } = scenario();
		world = w;
		const decided = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: toRunoff(w, round.id).id })
		).round;
		// Until it is filed, the reveal owns the screen and there is no lobby to serve.
		expect(roundPage(w, 'Ana').lobby).toBeNull();

		unwrap(markWatched({ db: w.db, groupId: w.group.id, roundId: decided.id }));
		const page = roundPage(w, 'Ana');
		expect(page.round?.state).toBe('watched');
		// The winner is retired, so the table is one film shorter than it was.
		expect(page.lobby).toEqual({ poolSize: 2, unswipedCount: 0 });
	});

	/**
	 * The other way a night ends, asserted end to end because "leaves no mark" is a
	 * claim about four different things at once: the home tab, History, the table,
	 * and the answers and counters underneath them.
	 */
	test('a night that fell through leaves no mark on anything', () => {
		const { w, round } = scenario();
		world = w;
		// A star on the film that is about to win: the strongest answer in the pool,
		// and the one a night filed wrongly would be likeliest to destroy.
		unwrap(
			setStandingVote({
				db: w.db,
				groupId: w.group.id,
				memberId: w.member('Ana').id,
				movieId: w.movie('Alien').id,
				starred: true,
				now: BASE_NOW
			})
		);
		const standingBefore = standingRows(w);
		const decided = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: toRunoff(w, round.id).id })
		).round;
		expect(decided.state).toBe('decided');
		expect(decided.winnerId).not.toBeNull();

		// "We didn't watch it."
		unwrap(abandonRound({ db: w.db, groupId: w.group.id, roundId: decided.id }));

		// The home tab is the lobby again — and unlike the watched night above, which
		// leaves the table one film shorter, this one takes nothing off it.
		const page = roundPage(w, 'Ana');
		expect(page.round?.state).toBe('abandoned');
		expect(page.lobby).toEqual({ poolSize: 3, unswipedCount: 0 });
		// Nothing happened, so there is nothing to file: History records the nights
		// that were watched, and the one decided round it used to carry is gone.
		expect(buildHistoryView({ db: w.db, group: w.group })).toEqual([]);
		// The winner was never retired...
		expect(w.db.select().from(movies).where(eq(movies.id, decided.winnerId!)).get()?.status).toBe(
			'pool'
		);
		// ...nobody's turn was spent (every counter still on its opening zero)...
		expect(
			w.db
				.select()
				.from(fairness)
				.all()
				.map((row) => [row.winsCount, row.lastWinAt, row.lastWinRoundId])
		).toEqual(MEMBERS.map(() => [0, null, null]));
		// ...and every standing vote and star is exactly where it was.
		expect(standingRows(w)).toEqual(standingBefore);
	});

	test("the lobby's own button deals the next night straight off a watched one", () => {
		const { w, round } = scenario();
		world = w;
		const decided = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: toRunoff(w, round.id).id })
		).round;
		unwrap(markWatched({ db: w.db, groupId: w.group.id, roundId: decided.id }));
		// Same situation as a cancelled night: nothing is active, so the form posts
		// through and the new round is the current one.
		const next = unwrap(
			createRound({ db: w.db, groupId: w.group.id, actorId: w.member('Ben').id })
		);
		expect(next.state).toBe('open');
		expect(roundPage(w, 'Ana').round?.id).toBe(next.id);
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

	test('the cached TMDB extras travel with the card, and a film without them serialises cleanly', () => {
		// Public facts about a film, not an aggregate: they may ride any payload at
		// any phase. What must NOT happen is a film the backfill has not reached
		// serialising as a hole — the screens read `details === null` as "no
		// sections", so the key has to be there and be null.
		const details: MovieDetails = {
			tagline: 'In space no one can hear you scream.',
			overview: 'A commercial towing vehicle answers a distress call.',
			genres: ['Horror', 'Science Fiction'],
			certification: 'M/16',
			directors: ['Ridley Scott'],
			cast: [{ name: 'Sigourney Weaver', character: 'Ripley' }],
			trailerKey: 'LjLamj-b0I8'
		};
		world = createTestWorld({
			memberNames: MEMBERS,
			movies: [{ title: 'Alien', details }, { title: 'Brazil' }]
		});
		const pool = buildPoolView({ db: world.db, group: world.group, me: world.member('Ana') });
		const byTitle = new Map(pool.movies.map((movie) => [movie.title, movie]));
		expect(byTitle.get('Alien')?.details).toEqual(details);
		expect(byTitle.get('Brazil')?.details).toBeNull();
		expect(Object.keys(byTitle.get('Brazil')!)).toContain('details');
		// A round trip through JSON is what actually reaches the browser.
		expect(JSON.parse(JSON.stringify(byTitle.get('Alien'))).details.cast[0].name).toBe('Sigourney Weaver');
		// And none of it smuggles in an aggregate name.
		assertNoAggregates(pool, 'the pool view with details');
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
	test('exposes the invite token, the five knobs and the member list', () => {
		const { w } = scenario();
		world = w;
		const settings = buildSettingsView({ db: w.db, group: w.group, me: w.member('Ana') });
		expect(settings.inviteToken).toBe(w.group.inviteToken);
		expect(Object.keys(settings.config).sort()).toEqual([
			'approval_floor',
			'coverage_floor',
			'n_finalists',
			'rewatch_cooldown',
			'veto_threshold',
			'vetoes_enabled'
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

describe('pair set covers surviving finalists (accepted disclosure)', () => {
	// The group owner chose fewer taps over full secrecy: a voter's ballot shrinks
	// when someone else's veto disqualifies a film, which discloses WHICH film was
	// vetoed (and, with VETO_THRESHOLD > 1, when the threshold was reached). This
	// test pins that trade-off so a change in either direction is deliberate.
	test('a veto removes the disqualified film from everyone’s remaining pairs', () => {
		const { w, round } = scenario();
		world = w;
		const runoff = toRunoff(w, round.id);
		expect(view(w, 'Ana', runoff).me.pairsTotal).toBe(3); // C(3,2)

		// Dee disqualifies Casino; Ana is no longer asked about it.
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
		expect(after.me.pairsTotal).toBe(1); // C(2,2) survivors only
		const asked = new Set(after.me.pairOrder.flatMap((pair) => [pair.a, pair.b]));
		expect(asked.has(w.movie('Casino').id)).toBe(false);
		// Per-member veto ballots still never appear anywhere (that fix stands);
		// only the aggregate effect on the survivor set is visible.
		expect(JSON.stringify(after)).not.toContain('"byMember"');
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
