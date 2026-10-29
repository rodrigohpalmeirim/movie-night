/**
 * Read models. **This file is where the disclosure rules are enforced.**
 *
 * Two layers, two rules (voting-spec, cross-cutting rules):
 *
 * - STANDING votes: the group's aggregate counts are public — but only as
 *   numbers. No payload maps a standing vote to anyone except the viewer's own,
 *   which travels as `myVote` / `myStarred`. Counts are built in exactly one
 *   place, `loadVoteCounts`, and leave this file as `VoteCounts` (four integers,
 *   nothing else). So a first answer is the voter's own, the swipe deck never
 *   receives them (it reads `buildPoolView`, which carries no counts, while the
 *   pool list reads `buildPoolBrowseView`), and a film's detail screen receives
 *   them only once the viewer has answered it (its load gates that).
 *
 * - ROUND results (the round's frozen tallies, vetoes, pairwise picks, the
 *   tiebreak) are published by the reveal. Every such aggregate lives inside
 *   `RoundView.reveal`, and `reveal` is populated by exactly one `if` in
 *   `buildRoundView`. Participation status (who is in, who has finished) is
 *   deliberately *not* an aggregate — it says nothing about how anyone voted —
 *   and app-spec requires showing it ("4 in, 3 no answer", "2 attendees haven't
 *   voted — reveal anyway?").
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
import {
	computeTallies,
	DEFAULT_TALLY_CONFIG,
	memberSeed,
	seededShuffle,
	type HeadToHead,
	type Matchup,
	type MovieId
} from '../../tally/index.js';
import type { TagRef } from '../../tags.js';
import {
	countPoolFilmsTagged,
	groupTagSummaries,
	loadMovieTags,
	roundTheme,
	type TagSummary
} from './tags.js';
import {
	evaluateRunoff,
	getCurrentRound,
	loadAttendeeIds,
	loadAttendance,
	loadStandingVotes,
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
	/**
	 * The group's tags on this film ("Halloween", "Sci-fi"), by label. Public facts
	 * like `details` — anyone may add or remove one — so they ride with the movie
	 * everywhere and carry no phase gate. Removed and watched films keep theirs.
	 */
	tags: TagRef[];
}

function memberRef(member: Member | undefined): MemberRef | null {
	return member ? { id: member.id, displayName: member.displayName } : null;
}

/** `loadMovieTags`' answer, read by every view that prints a card. */
type TagIndex = Map<string, TagRef[]>;

function movieCard(movie: Movie, byId: Map<string, Member>, tags: TagIndex): MovieCard {
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
		details: movie.details ?? null,
		tags: tags.get(movie.id) ?? []
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
/* Standing-vote counts                                                */
/* ------------------------------------------------------------------ */

/**
 * Where the group's CURRENT members stand on one film — numbers and nothing
 * else. voting-spec: aggregate standing-vote counts are public (outside the
 * swipe screen, and on a film's page once you have answered it); who cast
 * which vote never is. Keep this shape to plain integers: a member id
 * or name added here would publish exactly what the rule protects.
 *
 * Every current member is in exactly one of `yes`, `no` or `unseen`, so
 * `yes + no + unseen` is the size of the group. `starred` is not a fourth
 * bucket: a star is an upgraded yes, so starred voters are counted in `yes`
 * too, and `starred <= yes` always holds.
 */
export interface VoteCounts {
	/** Current members whose standing vote is yes, starred yeses included. */
	yes: number;
	/** Of those yeses, how many are starred. */
	starred: number;
	no: number;
	/** Current members with no standing vote on it: "not yet seen", never a no. */
	unseen: number;
}

/**
 * Counts, computed on read, for the given films (default: every film in the
 * group). The tally module does the counting — the same `computeTallies` Phase 1
 * runs, with the group's current members standing in for the attendee set — so
 * a removed member's kept votes and stars stop counting here exactly as they do
 * in a round, and a star on a "no" can never be counted.
 */
export function loadVoteCounts(
	db: Db,
	groupId: string,
	movieIds?: readonly string[]
): Map<string, VoteCounts> {
	const memberIds = currentMembers(db, groupId).map((member) => member.id);
	const ids =
		movieIds ??
		db
			.select({ id: movies.id })
			.from(movies)
			.where(eq(movies.groupId, groupId))
			.all()
			.map((row) => row.id);
	// Only the counts are read back, so the movie fields the ranking needs
	// (runtime, suggester, status) and the config's floors are irrelevant here.
	const tallies = computeTallies(
		ids.map((id) => ({ id, runtimeMin: null, suggestedBy: '' })),
		memberIds,
		loadStandingVotes(db, groupId),
		DEFAULT_TALLY_CONFIG
	);
	return new Map(
		tallies.map((tally) => [
			tally.movieId,
			{
				yes: tally.yesVotes,
				starred: tally.starVotes,
				no: tally.noVotes,
				unseen: memberIds.length - tally.attendeeVotes
			}
		])
	);
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
	/**
	 * "Deal the night again" — the no-winner reveal's one move, and the app's one
	 * round-creating button outside the lobby, which app-spec names as the deliberate
	 * carve-out it is. It closes this night *and* opens the next, so the rule it bends
	 * ("a night is closed before the next is dealt") still holds inside it.
	 *
	 * Mirrors `restartRound`'s guard exactly, both halves: DECIDED, and nothing
	 * picked. A night with a winner has its own two endings and is never restartable.
	 */
	canRestart: boolean;
	canAdvance: boolean;
	advanceLabel: string | null;
	advanceBlockedReason: string | null;
	/**
	 * "Abandon this round" in the open and runoff headers' overflow menu, and "We
	 * didn't watch it" at the bottom of the reveal that picked a film — the same
	 * transition, asked in the two places a night can fall through. The no-winner
	 * reveal does not ask it: filing that night away is the first half of
	 * `canRestart`, which is the only button it shows.
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

/**
 * The night's theme, when it has one. A config fact about the round, like
 * `vetoesEnabled` — it says nothing about how anyone voted.
 */
export interface RoundThemeView extends TagRef {
	/**
	 * "6 Halloween films on the table": pool films carrying the theme right now.
	 * Inventory, exactly like the lobby's pool size — counted only while OPEN,
	 * which is when the table can still change; null afterwards, because from
	 * RUNOFF on the night is its frozen finalists and nothing else.
	 */
	filmsOnTable: number | null;
	/**
	 * Fewer themed films than a full hand of finalists. "Pick finalists" warns in
	 * its confirm step and never blocks: a short hand still plays, and a hand of
	 * none already has an honest ending ("no clear favourite").
	 */
	thin: boolean;
}

export interface RoundView {
	id: string;
	state: RoundState;
	/** Null for an ordinary night. Fixed at creation; see `RoundThemeView`. */
	theme: RoundThemeView | null;
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
	const tags = loadMovieTags(db, group.id);
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
					return movie ? [movieCard(movie, byId, tags)] : [];
				});

	const theme = roundTheme(round);
	const themedOnTable = theme && round.state === 'open' ? countPoolFilmsTagged(db, group.id, theme.key) : null;

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
		// Both halves of `restartRound`'s guard, in the same order it asks them.
		canRestart: round.state === 'decided' && round.winnerId === null,
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
		theme: theme
			? {
					...theme,
					filmsOnTable: themedOnTable,
					thin: themedOnTable !== null && themedOnTable < input.config.n_finalists
				}
			: null,
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
		reveal: revealed ? buildRevealView({ db, group, round, byId, tags }) : null
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
	tags?: TagIndex;
}): RevealView {
	const { db, round } = input;
	const byId = input.byId ?? memberIndex(db, input.group.id);
	const tags = input.tags ?? loadMovieTags(db, input.group.id);
	const evaluated = evaluateRunoff({ db, groupId: input.group.id, round });

	const finalistIds = round.finalistIds ?? [];
	const finalistMovies =
		finalistIds.length > 0 ? db.select().from(movies).where(inArray(movies.id, finalistIds)).all() : [];
	const finalistById = new Map(finalistMovies.map((movie) => [movie.id, movie]));
	const winner = round.winnerId ? db.select().from(movies).where(eq(movies.id, round.winnerId)).get() : undefined;

	const base = {
		vetoesEnabled: roundVetoesEnabled(round),
		outcome: (round.winnerId === null ? 'no_clear_favourite' : 'winner') as 'winner' | 'no_clear_favourite',
		winner: winner ? movieCard(winner, byId, tags) : null,
		tiebreakRuleUsed: round.tiebreakRuleUsed,
		randomSeed: round.randomSeed,
		decidedAt: round.decidedAt?.toISOString() ?? null,
		watchedAt: round.watchedAt?.toISOString() ?? null,
		finalists: finalistIds.flatMap((id) => {
			const movie = finalistById.get(id);
			return movie ? [movieCard(movie, byId, tags)] : [];
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
	/**
	 * What "Themed night?" offers: the two presets, always, then every tag the
	 * group uses — each with the number of pool films carrying it, so the picker
	 * can say how big a themed night's table would be. Inventory, not a tally.
	 */
	themes: TagSummary[];
}

/**
 * One pass over the pool answers both counts: the same left join
 * `unswipedMovieIds` makes, counted instead of collected, so the lobby's numbers
 * cost a single query at any pool size (and the theme picker one more).
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
		unswipedCount: rows.filter((row) => row.myVote === null).length,
		themes: groupTagSummaries(input.db, input.group.id)
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
 * The pool with my own standing votes and NO counts. This is the read the swipe
 * deck deals from, and the deck is the one surface that never carries counts
 * (voting-spec: a first impression is the voter's own). The pool list reads
 * `buildPoolBrowseView`, which adds them.
 */
export function buildPoolView(input: { db: Db; group: Group; me: Member }): PoolView {
	const { db, group, me } = input;
	const byId = memberIndex(db, group.id);
	const tags = loadMovieTags(db, group.id);
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
		...movieCard(row.movie, byId, tags),
		myVote: row.myVote ?? null,
		myStarred: row.myStarred === true
	}));
	return {
		movies: list,
		unswipedCount: list.filter((movie) => movie.status === 'pool' && movie.myVote === null).length
	};
}

export interface BrowsePoolMovieView extends PoolMovieView {
	/**
	 * The group's standing counts — numbers only, see `VoteCounts` — and only on
	 * a film the viewer has answered (yes, starred or no); `null` otherwise. The
	 * same rule a film's own page enforces: counts follow your own answer, so the
	 * pool list cannot be a way round it.
	 */
	voteCounts: VoteCounts | null;
}

export interface BrowsePoolView extends PoolView {
	movies: BrowsePoolMovieView[];
}

/**
 * app-spec: "GET pool → movies + my standing votes + the group's vote counts on
 * the films I have answered." The pool list sorts by them ("Group ranking"); it
 * does not print them.
 */
export function buildPoolBrowseView(input: { db: Db; group: Group; me: Member }): BrowsePoolView {
	const pool = buildPoolView(input);
	const counts = loadVoteCounts(
		input.db,
		input.group.id,
		pool.movies.filter((movie) => movie.myVote !== null).map((movie) => movie.id)
	);
	return {
		...pool,
		movies: pool.movies.map((movie) => ({ ...movie, voteCounts: counts.get(movie.id) ?? null }))
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
	/** The night's theme, as it was printed when the round was created. */
	theme: TagRef | null;
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
	const tags = loadMovieTags(db, group.id);
	return db
		.select()
		.from(rounds)
		.where(and(eq(rounds.groupId, group.id), inArray(rounds.state, ['decided', 'watched'])))
		.orderBy(desc(rounds.decidedAt), desc(rounds.createdAt))
		.limit(input.limit ?? 50)
		.all()
		.map((round) => {
			const reveal = buildRevealView({ db, group, round, byId, tags });
			return {
				roundId: round.id,
				state: round.state,
				decidedAt: round.decidedAt?.toISOString() ?? null,
				watchedAt: round.watchedAt?.toISOString() ?? null,
				winner: reveal.winner,
				theme: roundTheme(round),
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
