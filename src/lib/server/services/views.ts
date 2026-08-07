/**
 * Read models. **This file is where the hidden-tallies rule is enforced.**
 *
 * voting-spec: "Results stay hidden until the round closes. No live tallies, no
 * vote counts on cards, no 'trending' section ... treat it as a hard requirement,
 * not a preference. A voter always sees their own standing votes; only aggregates
 * are hidden."
 *
 * app-spec: "Aggregates are **never** serialized to the client before the round is
 * `decided` — hidden tallies are enforced at the API layer, not by UI omission."
 *
 * The mechanism is structural rather than conditional: every aggregate lives
 * inside `RoundView.reveal`, and `reveal` is populated by exactly one `if` in
 * `buildRoundView`. Nothing else in this file can emit a count. Participation
 * status (who is in, who has finished) is deliberately *not* an aggregate — it
 * says nothing about how anyone voted — and app-spec requires showing it
 * ("4 in, 3 no answer", "2 attendees haven't voted — reveal anyway?").
 */

import { and, desc, eq, inArray, isNotNull, isNull, not } from 'drizzle-orm';
import {
	members,
	movies,
	rounds,
	standingVotes,
	withConfigDefaults,
	type Db,
	type Group,
	type GroupConfig,
	type Member,
	type Movie,
	type MovieDetails,
	type Round,
	type RoundState,
	type StandingVoteValue,
	type TiebreakRule
} from '../db/index.js';
import { memberSeed, seededShuffle, type HeadToHead, type Matchup, type MovieId } from '../../tally/index.js';
import {
	evaluateRunoff,
	getCurrentRound,
	loadAttendeeIds,
	loadAttendance,
	memberRunoffProgress,
	roundVetoesEnabled,
	vetoPrefillFor,
	MIN_ELECTORATE,
	NO_ELECTORATE_MESSAGE
} from './rounds.js';

/* ------------------------------------------------------------------ */
/* Shared shapes                                                       */
/* ------------------------------------------------------------------ */

export interface MemberRef {
	id: string;
	displayName: string;
}

export interface MovieCard {
	id: string;
	tmdbId: number;
	title: string;
	year: number | null;
	runtimeMin: number | null;
	posterPath: string | null;
	suggestedBy: MemberRef | null;
	addedAt: string;
	status: Movie['status'];
	watchedAt: string | null;
	/**
	 * The cached TMDB extras, or null while the backfill has yet to reach this
	 * film. These are public facts about a movie — the same words TMDB shows
	 * anyone — and touch no tally, so they carry no phase gate: what the card
	 * back prints, the pool row and the reveal may print too.
	 */
	details: MovieDetails | null;
}

function memberRef(member: Member | undefined): MemberRef | null {
	return member ? { id: member.id, displayName: member.displayName } : null;
}

function movieCard(movie: Movie, byId: Map<string, Member>): MovieCard {
	return {
		id: movie.id,
		tmdbId: movie.tmdbId,
		title: movie.title,
		year: movie.year,
		runtimeMin: movie.runtimeMin,
		posterPath: movie.posterPath,
		suggestedBy: memberRef(byId.get(movie.suggestedBy)),
		addedAt: movie.addedAt.toISOString(),
		status: movie.status,
		watchedAt: movie.watchedAt?.toISOString() ?? null,
		details: movie.details ?? null
	};
}

/**
 * Every member of the group, REMOVED ONES INCLUDED, by id.
 *
 * Deliberately unfiltered: this index exists to turn an id into a name, and the
 * ids that need naming outlive membership — `movies.suggested_by` on a film still
 * in the pool, `attendance.updated_by` on a proxy RSVP, a past round's
 * `created_by`. voting-spec: "Their suggestions stay in the pool and stay credited
 * to them ... Past rounds are untouched: they keep naming whoever was there."
 *
 * Anything that answers "who is in this group *now*" must use `currentMembers`
 * instead — the roster, the participant list, the RSVP surface, the picker.
 */
function memberIndex(db: Db, groupId: string): Map<string, Member> {
	return new Map(
		db
			.select()
			.from(members)
			.where(eq(members.groupId, groupId))
			.all()
			.map((member) => [member.id, member])
	);
}

/** The group's present: members without a `removed_at` stamp, join order first. */
function currentMembers(db: Db, groupId: string): Member[] {
	return db
		.select()
		.from(members)
		.where(and(eq(members.groupId, groupId), isNull(members.removedAt)))
		.orderBy(members.createdAt, members.id)
		.all();
}

/* ------------------------------------------------------------------ */
/* Round view                                                          */
/* ------------------------------------------------------------------ */

/** Participation, not a tally: no vote content whatsoever. */
export interface ParticipantView {
	memberId: string;
	displayName: string;
	/** null = no attendance row = hasn't answered. Default is out. */
	attending: boolean | null;
	/** Who set the RSVP; differs from `memberId` for a proxy RSVP. */
	markedBy: MemberRef | null;
	/** Has finished the runoff (veto decision recorded + all pairs cast). */
	submitted: boolean;
}

export interface MyRoundView {
	memberId: string;
	attending: boolean | null;
	/** My own veto — always visible to me, never to anyone else. */
	vetoSubmitted: boolean;
	myVetoMovieId: string | null;
	/** Last round's target, if it is a finalist again. */
	vetoPrefillMovieId: string | null;
	pairsDone: number;
	pairsTotal: number;
	nextPair: Matchup | null;
	/** My own pair order and my own answers. */
	pairOrder: Matchup[];
	myPairVotes: Array<{ a: string; b: string; winnerId: string | null }>;
	/** Pool movies I have never swiped — my top-up stack. */
	unswipedMovieIds: string[];
}

/**
 * One flag per button the round screen can draw, and each one mirrors the guard
 * in the service behind it — so a flag never claims a move the service would
 * refuse, and never claims a button no screen renders.
 */
export interface TransitionView {
	/**
	 * "Start a movie night" — the lobby's, and the app's ONLY round-creating button.
	 * True exactly where the lobby is the home tab and there is a round to describe
	 * (cancelled, or watched); with no round at all there is no view to carry a flag.
	 *
	 * Deliberately false on `decided`, even though `createRound` would accept it: a
	 * night that has picked a film is not over, and dealing the next one over the top
	 * of it is what left films spoken-for forever. Its two exits are below — the
	 * lobby, and this button with it, come back once one of them is taken.
	 */
	canCreateRound: boolean;
	canAdvance: boolean;
	advanceLabel: string | null;
	advanceBlockedReason: string | null;
	/**
	 * "Abandon this round" in the open and runoff headers' overflow menu, and "We
	 * didn't watch it" at the bottom of the decided screen — the same transition,
	 * asked twice in the two places a night can fall through.
	 */
	canAbandon: boolean;
	/** "We watched it" — the decided screen's other bottom action. */
	canMarkWatched: boolean;
}

export interface RevealView {
	outcome: 'winner' | 'no_clear_favourite';
	winner: MovieCard | null;
	tiebreakRuleUsed: TiebreakRule | null;
	/** The seeded-random proof, per voting-spec's auditability requirement. */
	randomSeed: number;
	decidedAt: string | null;
	watchedAt: string | null;
	finalists: MovieCard[];
	tallies: Array<{
		movieId: MovieId;
		attendeeVotes: number;
		yesVotes: number;
		noVotes: number;
		/** Starred yes-votes among attendees — the Phase 1 tie-breaker, now public. */
		starVotes: number;
		coverage: number;
		approval: number;
	}>;
	matrix: HeadToHead[];
	copeland: Record<MovieId, number>;
	condorcetWinnerId: MovieId | null;
	/**
	 * Whether this round had a veto step at all. Outside the `veto` block on
	 * purpose: that block is the veto *tally*, and this is the house rule the night
	 * was played under — the scorepad prints no veto section when it is false.
	 */
	vetoesEnabled: boolean;
	veto: {
		counts: Record<MovieId, number>;
		disqualifiedIds: MovieId[];
		survivingIds: MovieId[];
		vetoesIgnored: boolean;
	};
}

export interface RoundView {
	id: string;
	state: RoundState;
	createdAt: string;
	closesAt: string | null;
	createdBy: MemberRef | null;
	runoffAt: string | null;
	/**
	 * Whether THIS round has a veto step, from its own frozen knobs — the round
	 * screen's step flow goes straight to the pairs when it is false. A config fact
	 * about the night, not an aggregate: it says nothing about how anyone voted.
	 */
	vetoesEnabled: boolean;
	/** Populated from RUNOFF onward; the finalist set itself is not a tally. */
	finalists: MovieCard[] | null;
	participants: ParticipantView[];
	participation: { attending: number; out: number; noAnswer: number; submitted: number };
	/** app-spec: "2 of 5 attendees have unswiped movies". */
	readiness: { attendeeCount: number; attendeesWithGaps: number };
	me: MyRoundView;
	transitions: TransitionView;
	/**
	 * THE gate. Non-null only for `decided` / `watched`. Every aggregate in the
	 * whole payload lives in here.
	 */
	reveal: RevealView | null;
}

export interface GroupContextView {
	groupId: string;
	name: string;
	config: GroupConfig;
	me: MemberRef;
	members: MemberRef[];
}

export function buildGroupContextView(db: Db, group: Group, me: Member): GroupContextView {
	return {
		groupId: group.id,
		name: group.name,
		config: withConfigDefaults(group.config),
		me: { id: me.id, displayName: me.displayName },
		// Current members only: this list drives the roster, the RSVP controls and the
		// dev member switcher, all of which are questions about the present.
		members: currentMembers(db, group.id).map((member) => ({
			id: member.id,
			displayName: member.displayName
		}))
	};
}

/** Pool movies this member has no standing vote on (yes *or* no). */
export function unswipedMovieIds(db: Db, groupId: string, memberId: string): string[] {
	return db
		.select({ id: movies.id })
		.from(movies)
		.leftJoin(
			standingVotes,
			and(eq(standingVotes.movieId, movies.id), eq(standingVotes.memberId, memberId))
		)
		.where(and(eq(movies.groupId, groupId), eq(movies.status, 'pool'), isNull(standingVotes.value)))
		.all()
		.map((row) => row.id);
}

function countAttendeesWithGaps(db: Db, groupId: string, attendeeIds: string[]): number {
	let withGaps = 0;
	for (const memberId of attendeeIds) {
		if (unswipedMovieIds(db, groupId, memberId).length > 0) withGaps++;
	}
	return withGaps;
}

export function buildRoundView(input: {
	db: Db;
	group: Group;
	config: GroupConfig;
	me: Member;
	round?: Round | undefined;
}): RoundView | null {
	const { db, group, me } = input;
	const round = input.round ?? getCurrentRound(db, group.id);
	if (!round) return null;

	const byId = memberIndex(db, group.id);
	const roster = currentMembers(db, group.id);
	// Participation is a question about the present, so every count below is over
	// CURRENT members. A removed member's attendance row is left in the table (it is
	// a record of what happened) but is filtered out here and, crucially, in
	// `loadAttendeeIds` — so the round screen's "4 in" can never include somebody no
	// tally counts.
	const current = new Set(roster.map((member) => member.id));
	const attendanceRows = loadAttendance(db, round.id).filter((row) => current.has(row.memberId));
	const rsvpByMember = new Map(attendanceRows.map((row) => [row.memberId, row]));
	const attendeeIds = attendanceRows.filter((row) => row.attending).map((row) => row.memberId);

	const participants: ParticipantView[] = roster.map((member) => {
		const rsvp = rsvpByMember.get(member.id);
		return {
			memberId: member.id,
			displayName: member.displayName,
			attending: rsvp ? rsvp.attending : null,
			// `byId`, not the roster: a proxy RSVP set by someone who has since left is
			// still "marked by Dee".
			markedBy: rsvp ? memberRef(byId.get(rsvp.updatedBy)) : null,
			submitted: rsvp?.runoffSubmittedAt != null
		};
	});

	const finalistIds = round.finalistIds ?? null;
	const finalistMovies =
		finalistIds && finalistIds.length > 0
			? db.select().from(movies).where(inArray(movies.id, finalistIds)).all()
			: [];
	const finalistById = new Map(finalistMovies.map((movie) => [movie.id, movie]));
	const revealed = round.state === 'decided' || round.state === 'watched';
	const orderedFinalistIds =
		finalistIds === null
			? null
			: revealed
				? finalistIds
				: // PRE-REVEAL: `finalist_ids` is stored in Phase-1 rank order (attendee
					// yes-votes descending), so serving it verbatim is an *ordinal*
					// disclosure of the swipe tally — precisely the anchoring channel
					// voting-spec calls a hard requirement. Each voter therefore gets its
					// own deterministic shuffle, stable across reloads and devices.
					seededShuffle(finalistIds, memberSeed(round.randomSeed, me.id));
	const finalists =
		orderedFinalistIds === null
			? null
			: orderedFinalistIds.flatMap((id) => {
					const movie = finalistById.get(id);
					return movie ? [movieCard(movie, byId)] : [];
				});

	const myRsvp = rsvpByMember.get(me.id);
	const iAmAttending = myRsvp?.attending === true;

	// Ballot data — pair order, my veto, the pre-fill — belongs to attendees only.
	// A member who is not coming has nothing to cast, so handing them the ballot
	// is both pointless and an extra surface.
	const progress =
		iAmAttending && (round.state === 'runoff' || round.state === 'decided' || round.state === 'watched')
			? memberRunoffProgress({ db, round, memberId: me.id })
			: null;
	const meView: MyRoundView = {
		memberId: me.id,
		attending: myRsvp ? myRsvp.attending : null,
		vetoSubmitted: progress?.vetoSubmitted ?? false,
		myVetoMovieId: progress?.myVetoMovieId ?? null,
		vetoPrefillMovieId:
			iAmAttending && round.state === 'runoff'
				? vetoPrefillFor({ db, groupId: group.id, round, memberId: me.id })
				: null,
		pairsDone: progress?.done ?? 0,
		pairsTotal: progress?.total ?? 0,
		nextPair: progress?.nextPair ?? null,
		pairOrder: progress?.order ?? [],
		myPairVotes: progress?.myPairVotes ?? [],
		unswipedMovieIds: unswipedMovieIds(db, group.id, me.id)
	};

	// Both transitions need the same thing and nothing more: somebody attending.
	// Mirrors `planAdvance`'s guard, message included, so the button and the
	// service can never disagree about why a tap would be refused.
	const haveElectorate = attendeeIds.length >= MIN_ELECTORATE;

	const transitions: TransitionView = {
		canCreateRound: round.state === 'watched' || round.state === 'abandoned',
		canAdvance: (round.state === 'open' || round.state === 'runoff') && haveElectorate,
		advanceLabel:
			round.state === 'open'
				? 'Pick finalists'
				: round.state === 'runoff'
					? 'Reveal the winner'
					: null,
		advanceBlockedReason:
			round.state === 'open' && !haveElectorate
				? NO_ELECTORATE_MESSAGE.open
				: round.state === 'runoff' && !haveElectorate
					? NO_ELECTORATE_MESSAGE.runoff
					: null,
		// Mirrors `abandonRound`'s guard exactly, `decided` included: a picked night
		// that never happened is cancelled like any other. Only WATCHED is final, so
		// that is the one state where nothing offers this.
		canAbandon: round.state === 'open' || round.state === 'runoff' || round.state === 'decided',
		canMarkWatched: round.state === 'decided' && round.winnerId !== null
	};

	return {
		id: round.id,
		state: round.state,
		createdAt: round.createdAt.toISOString(),
		closesAt: round.closesAt?.toISOString() ?? null,
		createdBy: memberRef(byId.get(round.createdBy)),
		runoffAt: round.runoffAt?.toISOString() ?? null,
		vetoesEnabled: roundVetoesEnabled(round),
		finalists,
		participants,
		participation: {
			attending: attendeeIds.length,
			out: attendanceRows.filter((row) => !row.attending).length,
			noAnswer: roster.length - attendanceRows.length,
			submitted: attendanceRows.filter((row) => row.runoffSubmittedAt != null).length
		},
		readiness: {
			attendeeCount: attendeeIds.length,
			attendeesWithGaps: round.state === 'open' ? countAttendeesWithGaps(db, group.id, attendeeIds) : 0
		},
		me: meView,
		transitions,
		// ── the one and only place an aggregate enters a payload ──
		reveal: revealed ? buildRevealView({ db, group, round, byId }) : null
	};
}

/**
 * The full reveal: "the now-public tallies — head-to-head grid, approval numbers,
 * vetoes, and which tiebreak rule (if any) decided it, including the
 * seeded-random proof."
 *
 * Recomputed from the round's frozen snapshot rather than read from stored
 * counters, so the reveal always agrees with the persisted `winner_id` and
 * `tiebreak_rule_used` (RSVPs are closed from `decided` onward, so nothing can
 * drift afterwards).
 */
export function buildRevealView(input: {
	db: Db;
	group: Group;
	round: Round;
	byId?: Map<string, Member>;
}): RevealView {
	const { db, round } = input;
	const byId = input.byId ?? memberIndex(db, input.group.id);
	const evaluated = evaluateRunoff({ db, groupId: input.group.id, round });

	const finalistIds = round.finalistIds ?? [];
	const finalistMovies =
		finalistIds.length > 0 ? db.select().from(movies).where(inArray(movies.id, finalistIds)).all() : [];
	const finalistById = new Map(finalistMovies.map((movie) => [movie.id, movie]));
	const winner = round.winnerId ? db.select().from(movies).where(eq(movies.id, round.winnerId)).get() : undefined;

	const base = {
		vetoesEnabled: roundVetoesEnabled(round),
		outcome: (round.winnerId === null ? 'no_clear_favourite' : 'winner') as 'winner' | 'no_clear_favourite',
		winner: winner ? movieCard(winner, byId) : null,
		tiebreakRuleUsed: round.tiebreakRuleUsed,
		randomSeed: round.randomSeed,
		decidedAt: round.decidedAt?.toISOString() ?? null,
		watchedAt: round.watchedAt?.toISOString() ?? null,
		finalists: finalistIds.flatMap((id) => {
			const movie = finalistById.get(id);
			return movie ? [movieCard(movie, byId)] : [];
		})
	};

	if (!evaluated.ok) {
		// A round that never reached RUNOFF (no snapshot): nothing to tally.
		return {
			...base,
			tallies: [],
			matrix: [],
			copeland: {},
			condorcetWinnerId: null,
			veto: { counts: {}, disqualifiedIds: [], survivingIds: [], vetoesIgnored: false }
		};
	}

	const runoff = evaluated.value;
	const finalistSet = new Set(finalistIds);
	return {
		...base,
		tallies: runoff.tallies
			.filter((tally) => finalistSet.has(tally.movieId))
			.map((tally) => ({
				movieId: tally.movieId,
				attendeeVotes: tally.attendeeVotes,
				yesVotes: tally.yesVotes,
				noVotes: tally.noVotes,
				// An aggregate like any other, so it lives here and nowhere else — the
				// reveal is the first moment anyone may learn how many stars a film got.
				starVotes: tally.starVotes,
				coverage: tally.coverage,
				approval: tally.approval
			})),
		matrix: runoff.matrix,
		copeland: runoff.copeland,
		condorcetWinnerId: runoff.condorcetWinnerId,
		// COUNTS ONLY. Neither spec authorises publishing who vetoed what — pair
		// votes are aggregated, and a veto is a more sensitive statement than a
		// preference. Per-member attribution stays server-side (the write path needs
		// it to undo a flip); it is never serialised.
		veto: {
			counts: runoff.veto.counts,
			disqualifiedIds: runoff.veto.disqualifiedIds,
			survivingIds: runoff.veto.survivingIds,
			vetoesIgnored: runoff.veto.vetoesIgnored
		}
	};
}

/* ------------------------------------------------------------------ */
/* Lobby view                                                          */
/* ------------------------------------------------------------------ */

/**
 * What the round screen has left to say when there is no round to describe.
 *
 * Suggestions and swipes are STANDING — the pool outlives every night and
 * neither act waits on one — so the screen that admits there is no round is
 * exactly the screen that has to prove the table is already dealt. Two numbers
 * do that: how much is on it, and how much of it is still waiting for me.
 *
 * Deliberately not folded into `RoundView`: that shape describes a round, and
 * this is the payload for having none. Nothing here is an aggregate — a pool
 * size is public inventory, and the stack is the viewer's own.
 */
export interface LobbyView {
	/** Films in the pool right now — "14 films on the table". */
	poolSize: number;
	/** How many of those I have never swiped: my own stack, same as the Pool tab's. */
	unswipedCount: number;
}

/**
 * One pass over the pool answers both: the same left join `unswipedMovieIds`
 * makes, counted instead of collected, so the lobby costs a single query at any
 * pool size.
 */
export function buildLobbyView(input: { db: Db; group: Group; me: Member }): LobbyView {
	const rows = input.db
		.select({ myVote: standingVotes.value })
		.from(movies)
		.leftJoin(
			standingVotes,
			and(eq(standingVotes.movieId, movies.id), eq(standingVotes.memberId, input.me.id))
		)
		.where(and(eq(movies.groupId, input.group.id), eq(movies.status, 'pool')))
		.all();
	return {
		poolSize: rows.length,
		unswipedCount: rows.filter((row) => row.myVote === null).length
	};
}

/* ------------------------------------------------------------------ */
/* Pool view                                                           */
/* ------------------------------------------------------------------ */

export interface PoolMovieView extends MovieCard {
	/** The viewer's OWN standing vote. `null` = not yet seen — a third state. */
	myVote: StandingVoteValue | null;
	/**
	 * Whether the viewer's own yes is a STARRED yes. Their own answer, not an
	 * aggregate, so it is visible at every phase — the same reasoning as `myVote`
	 * ("A voter always sees their own standing votes"). Always false when `myVote`
	 * is not `yes`.
	 */
	myStarred: boolean;
}

export interface PoolView {
	movies: PoolMovieView[];
	/** Size of my swipe stack ("3 to swipe"). */
	unswipedCount: number;
}

/**
 * app-spec: "GET pool → movies + my standing votes only." No aggregate counts
 * appear here at any phase — the pool screen never shows them, even after a
 * reveal, because standing votes outlive rounds.
 */
export function buildPoolView(input: { db: Db; group: Group; me: Member }): PoolView {
	const { db, group, me } = input;
	const byId = memberIndex(db, group.id);
	const rows = db
		.select({ movie: movies, myVote: standingVotes.value, myStarred: standingVotes.starred })
		.from(movies)
		.leftJoin(
			standingVotes,
			and(eq(standingVotes.movieId, movies.id), eq(standingVotes.memberId, me.id))
		)
		.where(and(eq(movies.groupId, group.id), not(eq(movies.status, 'removed'))))
		.orderBy(desc(movies.addedAt))
		.all();

	const list = rows.map((row) => ({
		...movieCard(row.movie, byId),
		myVote: row.myVote ?? null,
		myStarred: row.myStarred === true
	}));
	return {
		movies: list,
		unswipedCount: list.filter((movie) => movie.status === 'pool' && movie.myVote === null).length
	};
}

/* ------------------------------------------------------------------ */
/* History view                                                        */
/* ------------------------------------------------------------------ */

export interface HistoryEntry {
	roundId: string;
	state: RoundState;
	decidedAt: string | null;
	watchedAt: string | null;
	winner: MovieCard | null;
	/** Already-public tallies: every entry here is `decided` or later. */
	reveal: RevealView;
}

/**
 * app-spec: "Past nights, newest first: winner poster, date, suggested-by;
 * expandable to the round's full revealed tally."
 *
 * Only `decided` and `watched` rounds appear: an abandoned night has no result to
 * show, and an active one is still secret.
 */
export function buildHistoryView(input: { db: Db; group: Group; limit?: number }): HistoryEntry[] {
	const { db, group } = input;
	const byId = memberIndex(db, group.id);
	return db
		.select()
		.from(rounds)
		.where(and(eq(rounds.groupId, group.id), inArray(rounds.state, ['decided', 'watched'])))
		.orderBy(desc(rounds.decidedAt), desc(rounds.createdAt))
		.limit(input.limit ?? 50)
		.all()
		.map((round) => {
			const reveal = buildRevealView({ db, group, round, byId });
			return {
				roundId: round.id,
				state: round.state,
				decidedAt: round.decidedAt?.toISOString() ?? null,
				watchedAt: round.watchedAt?.toISOString() ?? null,
				winner: reveal.winner,
				reveal
			};
		});
}

/* ------------------------------------------------------------------ */
/* Settings view                                                       */
/* ------------------------------------------------------------------ */

export interface SettingsView {
	groupId: string;
	name: string;
	/** The invite link is group data; anyone holding the token already has it. */
	inviteToken: string;
	config: GroupConfig;
	/** Current members — the roster, each removable by anyone. */
	members: Array<MemberRef & { joinedAt: string }>;
	/**
	 * Members who have left, each restorable by anyone. Surfaced here rather than
	 * hidden, because this is the only route back: a removed member keeps their
	 * display name, so re-adding it is refused, and restoring counts every vote and
	 * star they ever cast again.
	 */
	removedMembers: Array<MemberRef & { joinedAt: string; removedAt: string }>;
	me: MemberRef;
}

export function buildSettingsView(input: { db: Db; group: Group; me: Member }): SettingsView {
	const { db, group, me } = input;
	return {
		groupId: group.id,
		name: group.name,
		inviteToken: group.inviteToken,
		config: withConfigDefaults(group.config),
		members: currentMembers(db, group.id).map((member) => ({
			id: member.id,
			displayName: member.displayName,
			joinedAt: member.createdAt.toISOString()
		})),
		removedMembers: db
			.select()
			.from(members)
			.where(and(eq(members.groupId, group.id), isNotNull(members.removedAt)))
			.orderBy(members.createdAt, members.id)
			.all()
			.map((member) => ({
				id: member.id,
				displayName: member.displayName,
				joinedAt: member.createdAt.toISOString(),
				removedAt: member.removedAt!.toISOString()
			})),
		me: { id: me.id, displayName: me.displayName }
	};
}

/** Attendees who have not finished the runoff — powers the reveal warning. */
export function unsubmittedAttendees(db: Db, round: Round): string[] {
	const attendeeIds = new Set(loadAttendeeIds(db, round.id));
	return loadAttendance(db, round.id)
		.filter((row) => attendeeIds.has(row.memberId) && row.runoffSubmittedAt == null)
		.map((row) => row.memberId);
}
