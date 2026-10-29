/**
 * Tags on films and themed nights: normalisation, the trust-based edits, the
 * eligibility filter at OPEN → RUNOFF, the carry-over on "Deal the night again",
 * the auto-tag on suggestion, and what the read models serialize.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { movieTags, rounds } from './db/index.js';
import { unwrap, type Result } from './result.js';
import { removeMovie, setStandingVote, suggestMovie } from './services/movies.js';
import {
	advanceRound,
	createRound,
	getRound,
	markWatched,
	restartRound,
	setRsvp
} from './services/rounds.js';
import {
	addMovieTag,
	groupTagSummaries,
	loadMovieTags,
	openRoundTheme,
	removeMovieTag
} from './services/tags.js';
import {
	buildHistoryView,
	buildLobbyView,
	buildPoolView,
	buildRoundView
} from './services/views.js';
import { BASE_NOW, createTestWorld, fakeTmdb, type TestWorld } from './testing.js';

let world: TestWorld | undefined;
afterEach(() => {
	world?.cleanup();
	world = undefined;
});

const MEMBERS = ['Ana', 'Ben', 'Cal', 'Dee'];

function code(result: Result<unknown>): string {
	if (result.ok) throw new Error('expected a failure');
	return result.code;
}

function tag(w: TestWorld, title: string, label: string, by = 'Ana') {
	return unwrap(
		addMovieTag({
			db: w.db,
			groupId: w.group.id,
			movieId: w.movie(title).id,
			label,
			actorId: w.member(by).id,
			now: BASE_NOW
		})
	);
}

function tagsOf(w: TestWorld, title: string): string[] {
	return (loadMovieTags(w.db, w.group.id).get(w.movie(title).id) ?? []).map((t) => t.label);
}

/** Everyone in, and every film swiped by `yes[title]` of the four members. */
function rsvpAndSwipe(w: TestWorld, roundId: string, yes: Record<string, number>) {
	for (const name of MEMBERS) {
		unwrap(
			setRsvp({
				db: w.db,
				groupId: w.group.id,
				roundId,
				memberId: w.member(name).id,
				attending: true,
				actorId: w.member(name).id,
				now: BASE_NOW
			})
		);
	}
	for (const [title, count] of Object.entries(yes)) {
		MEMBERS.forEach((name, index) => {
			unwrap(
				setStandingVote({
					db: w.db,
					groupId: w.group.id,
					memberId: w.member(name).id,
					movieId: w.movie(title).id,
					value: index < count ? 'yes' : 'no',
					now: BASE_NOW
				})
			);
		});
	}
}

function openRound(w: TestWorld, theme?: string) {
	return unwrap(
		createRound({
			db: w.db,
			groupId: w.group.id,
			actorId: w.member('Ana').id,
			theme,
			now: BASE_NOW,
			seed: 99
		})
	);
}

/* ------------------------------------------------------------------ */

describe('tags on films', () => {
	test('are normalised: trimmed, single-spaced, case-folded, one tag per film', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: [{ title: 'Alien' }] });
		const w = world;
		expect(tag(w, 'Alien', '  Comfort   watch ')).toEqual({ key: 'comfort watch', label: 'Comfort watch' });
		// A second spelling of the same tag is the same tag: a no-op, printed the
		// group's way.
		expect(tag(w, 'Alien', 'COMFORT WATCH', 'Ben')).toEqual({ key: 'comfort watch', label: 'Comfort watch' });
		expect(tagsOf(w, 'Alien')).toEqual(['Comfort watch']);
		// Non-ASCII passes through the fold untouched, exactly as SQLite's lower()
		// leaves it — so the database's "key is folded" CHECK accepts the key.
		expect(tag(w, 'Alien', 'NOËL').key).toBe('noËl');
	});

	test('a key the group already uses keeps its first spelling everywhere', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: [{ title: 'Alien' }, { title: 'Brazil' }] });
		const w = world;
		tag(w, 'Alien', 'Sci-Fi');
		expect(tag(w, 'Brazil', 'sci-fi', 'Ben').label).toBe('Sci-Fi');
		// Presets spell themselves, whoever types them first and however.
		expect(tag(w, 'Brazil', 'hALLOWEEN').label).toBe('Halloween');
		expect(tagsOf(w, 'Brazil')).toEqual(['Halloween', 'Sci-Fi']);
	});

	test('refuses a blank or overlong tag, and a film from another group', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: [{ title: 'Alien' }] });
		const w = world;
		const add = (label: unknown, movieId = w.movie('Alien').id) =>
			addMovieTag({ db: w.db, groupId: w.group.id, movieId, label, actorId: w.member('Ana').id });
		expect(code(add('   '))).toBe('invalid_input');
		expect(code(add('x'.repeat(33)))).toBe('invalid_input');
		expect(code(add(42))).toBe('invalid_input');
		expect(code(add('Halloween', 'not-a-movie'))).toBe('unknown_movie');
		const other = createTestWorld({ memberNames: ['Zed'], movies: [{ title: 'Elsewhere' }] });
		try {
			expect(code(add('Halloween', other.movie('Elsewhere').id))).toBe('unknown_movie');
		} finally {
			other.cleanup();
		}
	});

	test('any member removes one, by any spelling, idempotently', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: [{ title: 'Alien' }] });
		const w = world;
		tag(w, 'Alien', 'Halloween');
		const remove = () =>
			unwrap(removeMovieTag({ db: w.db, groupId: w.group.id, movieId: w.movie('Alien').id, tag: ' halloween ' }));
		expect(remove()).toEqual({ removed: true });
		expect(remove()).toEqual({ removed: false });
		expect(tagsOf(w, 'Alien')).toEqual([]);
	});

	test('ride with the movie, and removed and watched films keep theirs', () => {
		world = createTestWorld({
			memberNames: MEMBERS,
			movies: [{ title: 'Alien' }, { title: 'Brazil' }, { title: 'Casino', status: 'watched', watchedAt: BASE_NOW }]
		});
		const w = world;
		tag(w, 'Alien', 'Halloween');
		tag(w, 'Brazil', 'Halloween');
		tag(w, 'Casino', 'Halloween');
		unwrap(removeMovie({ db: w.db, groupId: w.group.id, movieId: w.movie('Brazil').id, actorId: w.member('Ana').id }));

		const pool = buildPoolView({ db: w.db, group: w.group, me: w.member('Ana') });
		const byTitle = new Map(pool.movies.map((movie) => [movie.title, movie]));
		expect(byTitle.get('Alien')?.tags).toEqual([{ key: 'halloween', label: 'Halloween' }]);
		expect(byTitle.get('Casino')?.tags).toEqual([{ key: 'halloween', label: 'Halloween' }]);
		// Removed: off the pool screen, but the tag row is still there for a restore.
		expect(tagsOf(w, 'Brazil')).toEqual(['Halloween']);
		// A film with none serializes an empty list, never a hole.
		expect(Object.keys(byTitle.get('Alien')!)).toContain('tags');
	});

	test('the picker offers both presets always, then the group’s own, counting pool films only', () => {
		world = createTestWorld({
			memberNames: MEMBERS,
			movies: [{ title: 'Alien' }, { title: 'Brazil' }, { title: 'Casino', status: 'watched', watchedAt: BASE_NOW }]
		});
		const w = world;
		expect(groupTagSummaries(w.db, w.group.id).map((t) => [t.label, t.poolCount])).toEqual([
			['Halloween', 0],
			['Christmas', 0]
		]);
		tag(w, 'Alien', 'Sci-fi');
		tag(w, 'Brazil', 'Sci-fi');
		tag(w, 'Casino', 'Sci-fi');
		tag(w, 'Alien', 'Halloween');
		expect(groupTagSummaries(w.db, w.group.id).map((t) => [t.label, t.poolCount, t.preset])).toEqual([
			['Halloween', 1, true],
			['Christmas', 0, true],
			['Sci-fi', 2, false]
		]);
		expect(buildLobbyView({ db: w.db, group: w.group, me: w.member('Ana') }).themes.map((t) => t.key)).toEqual([
			'halloween',
			'christmas',
			'sci-fi'
		]);
	});
});

describe('themed rounds', () => {
	test('a theme is fixed at creation: none, a preset, or any tag', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: [{ title: 'Alien' }] });
		const w = world;
		const plain = openRound(w, '');
		expect([plain.theme, plain.themeLabel]).toEqual([null, null]);
		w.db.update(rounds).set({ state: 'abandoned' }).where(eq(rounds.id, plain.id)).run();

		const halloween = openRound(w, ' halloween');
		expect([halloween.theme, halloween.themeLabel]).toEqual(['halloween', 'Halloween']);
		w.db.update(rounds).set({ state: 'abandoned' }).where(eq(rounds.id, halloween.id)).run();

		// A tag nobody has used yet is a fine theme: its films get tagged as they
		// are suggested tonight.
		const custom = openRound(w, 'Ana’s  Birthday');
		expect([custom.theme, custom.themeLabel]).toEqual(['ana’s birthday', 'Ana’s Birthday']);
		w.db.update(rounds).set({ state: 'abandoned' }).where(eq(rounds.id, custom.id)).run();

		expect(
			code(createRound({ db: w.db, groupId: w.group.id, actorId: w.member('Ana').id, theme: 'x'.repeat(40) }))
		).toBe('invalid_input');
	});

	test('a themed night’s finalists are only films carrying its theme', () => {
		world = createTestWorld({
			memberNames: MEMBERS,
			movies: [{ title: 'Alien' }, { title: 'Brazil' }, { title: 'Casino' }, { title: 'Dune' }]
		});
		const w = world;
		// The most-loved film on the table is untagged; Dune carries a DIFFERENT tag.
		tag(w, 'Brazil', 'Halloween');
		tag(w, 'Casino', 'halloween');
		tag(w, 'Dune', 'Christmas');
		const round = openRound(w, 'Halloween');
		rsvpAndSwipe(w, round.id, { Alien: 4, Brazil: 3, Casino: 2, Dune: 4 });

		const advanced = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id, now: BASE_NOW })
		);
		expect(advanced.plan.kind).toBe('open_to_runoff');
		const titles = (ids: string[]) => ids.map((id) => w.movies.find((m) => m.id === id)!.title).sort();
		expect(titles(advanced.round.finalistIds!)).toEqual(['Brazil', 'Casino']);
		// Nothing else about the tally moved: the two themed films rank by yes-votes.
		if (advanced.plan.kind === 'open_to_runoff') {
			expect(titles(advanced.plan.phase1.tallies.map((t) => t.movieId))).toEqual(['Brazil', 'Casino']);
		}
		// The frozen snapshot covers exactly those finalists.
		expect(new Set(advanced.round.standingSnapshot!.map((v) => v.movie_id))).toEqual(
			new Set(advanced.round.finalistIds!)
		);
	});

	test('an ordinary night deals every film, tagged or not', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: [{ title: 'Alien' }, { title: 'Brazil' }] });
		const w = world;
		tag(w, 'Brazil', 'Halloween');
		const round = openRound(w);
		rsvpAndSwipe(w, round.id, { Alien: 4, Brazil: 3 });
		const advanced = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id, now: BASE_NOW })
		);
		expect(advanced.round.finalistIds!.length).toBe(2);
	});

	test('one themed film is an outright win; none is “no clear favourite” — never a block', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: [{ title: 'Alien' }, { title: 'Brazil' }] });
		const w = world;
		tag(w, 'Brazil', 'Halloween');
		const one = openRound(w, 'Halloween');
		rsvpAndSwipe(w, one.id, { Alien: 4, Brazil: 3 });
		const outright = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: one.id, now: BASE_NOW })
		);
		expect(outright.round.state).toBe('decided');
		expect(outright.round.winnerId).toBe(w.movie('Brazil').id);
		w.db.update(rounds).set({ state: 'abandoned' }).where(eq(rounds.id, one.id)).run();

		const none = openRound(w, 'Christmas');
		rsvpAndSwipe(w, none.id, {});
		const view = buildRoundView({ db: w.db, group: w.group, config: w.config, me: w.member('Ana') })!;
		// The warning the confirm step prints, and the button still there.
		expect(view.theme).toMatchObject({ key: 'christmas', label: 'Christmas', filmsOnTable: 0, thin: true });
		expect(view.transitions.canAdvance).toBe(true);
		const empty = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: none.id, now: BASE_NOW })
		);
		expect(empty.round.state).toBe('decided');
		expect(empty.round.winnerId).toBeNull();
	});

	test('tag edits after the freeze change nothing about a live runoff or its reveal', () => {
		world = createTestWorld({
			memberNames: MEMBERS,
			movies: [{ title: 'Alien' }, { title: 'Brazil' }, { title: 'Casino' }]
		});
		const w = world;
		tag(w, 'Alien', 'Halloween');
		tag(w, 'Brazil', 'Halloween');
		const round = openRound(w, 'Halloween');
		rsvpAndSwipe(w, round.id, { Alien: 4, Brazil: 3, Casino: 4 });
		const runoff = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id, now: BASE_NOW })
		).round;
		const frozen = [...runoff.finalistIds!];

		// Mid-runoff: one finalist loses the tag, an outsider gains it.
		unwrap(removeMovieTag({ db: w.db, groupId: w.group.id, movieId: w.movie('Brazil').id, tag: 'Halloween' }));
		tag(w, 'Casino', 'Halloween');

		const view = buildRoundView({ db: w.db, group: w.group, config: w.config, me: w.member('Ana') })!;
		expect(view.finalists!.map((m) => m.id).sort()).toEqual([...frozen].sort());
		const decided = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id, now: BASE_NOW })
		).round;
		expect(decided.finalistIds).toEqual(frozen);
		expect(frozen).toContain(decided.winnerId!);
	});

	test('the round view carries the theme, and counts themed films only while OPEN', () => {
		world = createTestWorld({
			memberNames: MEMBERS,
			movies: [{ title: 'Alien' }, { title: 'Brazil' }, { title: 'Casino' }, { title: 'Dune', status: 'watched', watchedAt: BASE_NOW }]
		});
		const w = world;
		tag(w, 'Alien', 'Halloween');
		tag(w, 'Brazil', 'Halloween');
		tag(w, 'Dune', 'Halloween'); // watched: not on the table
		const round = openRound(w, 'Halloween');
		rsvpAndSwipe(w, round.id, { Alien: 4, Brazil: 3, Casino: 4 });
		const open = buildRoundView({ db: w.db, group: w.group, config: w.config, me: w.member('Ben') })!;
		expect(open.theme).toEqual({ key: 'halloween', label: 'Halloween', filmsOnTable: 2, thin: true });

		const roomy = { ...w.config, n_finalists: 2 };
		expect(buildRoundView({ db: w.db, group: w.group, config: roomy, me: w.member('Ben') })!.theme?.thin).toBe(
			false
		);

		unwrap(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id, now: BASE_NOW }));
		const runoff = buildRoundView({ db: w.db, group: w.group, config: w.config, me: w.member('Ben') })!;
		expect(runoff.theme).toEqual({ key: 'halloween', label: 'Halloween', filmsOnTable: null, thin: false });
		expect(runoff.finalists!.every((m) => m.tags.some((t) => t.key === 'halloween'))).toBe(true);

		const unthemed = createTestWorld({ memberNames: ['Zed'], movies: [{ title: 'Elsewhere' }] });
		try {
			unwrap(createRound({ db: unthemed.db, groupId: unthemed.group.id, actorId: unthemed.member('Zed').id }));
			expect(
				buildRoundView({ db: unthemed.db, group: unthemed.group, config: unthemed.config, me: unthemed.member('Zed') })!
					.theme
			).toBeNull();
		} finally {
			unthemed.cleanup();
		}
	});

	test('“Deal the night again” carries the theme over with the RSVPs', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: [{ title: 'Alien' }] });
		const w = world;
		const round = openRound(w, 'Christmas');
		rsvpAndSwipe(w, round.id, { Alien: 4 });
		// Nothing carries the tag, so the night decides nothing...
		const decided = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id, now: BASE_NOW })
		).round;
		expect(decided.winnerId).toBeNull();
		// ...and the re-deal is still a Christmas night.
		const { next } = unwrap(
			restartRound({ db: w.db, groupId: w.group.id, roundId: decided.id, actorId: w.member('Ben').id })
		);
		expect([next.theme, next.themeLabel]).toEqual(['christmas', 'Christmas']);
		expect(getRound(w.db, w.group.id, next.id)?.state).toBe('open');
	});

	test('History prints a themed night’s theme, even once its films are untagged', () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: [{ title: 'Alien' }, { title: 'Brazil' }] });
		const w = world;
		tag(w, 'Alien', 'Spooky season');
		const round = openRound(w, 'spooky SEASON');
		rsvpAndSwipe(w, round.id, { Alien: 4, Brazil: 4 });
		const decided = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id, now: BASE_NOW })
		).round;
		unwrap(markWatched({ db: w.db, groupId: w.group.id, roundId: decided.id, now: BASE_NOW }));
		unwrap(removeMovieTag({ db: w.db, groupId: w.group.id, movieId: w.movie('Alien').id, tag: 'Spooky season' }));

		const [entry] = buildHistoryView({ db: w.db, group: w.group });
		expect(entry.theme).toEqual({ key: 'spooky season', label: 'Spooky season' });
		expect(entry.winner?.title).toBe('Alien');
	});
});

describe('suggesting during a themed night', () => {
	const tmdb = fakeTmdb({ 77: { title: 'Halloween', runtime: 91 }, 78: { title: 'Elf', runtime: 97 } });

	function suggest(w: TestWorld, tmdbId: number) {
		return suggestMovie({
			db: w.db,
			groupId: w.group.id,
			config: w.config,
			actorId: w.member('Cal').id,
			tmdbId,
			tmdb,
			now: BASE_NOW
		});
	}

	test('a film suggested while a themed round is OPEN is tagged with the theme', async () => {
		world = createTestWorld({ memberNames: MEMBERS });
		const w = world;
		openRound(w, 'Halloween');
		expect(openRoundTheme(w.db, w.group.id)).toEqual({ key: 'halloween', label: 'Halloween' });
		const outcome = unwrap(await suggest(w, 77));
		expect(outcome.kind).toBe('created');
		expect(outcome.themedAs).toEqual({ key: 'halloween', label: 'Halloween' });
		const rows = w.db.select().from(movieTags).where(eq(movieTags.movieId, outcome.movie.id)).all();
		expect(rows.map((row) => [row.tag, row.createdBy])).toEqual([['halloween', w.member('Cal').id]]);
	});

	test('…and so is one restored from removal, but not one that is merely already there', async () => {
		world = createTestWorld({ memberNames: MEMBERS });
		const w = world;
		const first = unwrap(await suggest(w, 78)).movie;
		unwrap(removeMovie({ db: w.db, groupId: w.group.id, movieId: first.id, actorId: w.member('Ana').id }));
		openRound(w, 'Christmas');
		const restored = unwrap(await suggest(w, 78));
		expect(restored.kind).toBe('restored');
		expect(restored.themedAs?.label).toBe('Christmas');

		const again = unwrap(await suggest(w, 77));
		unwrap(removeMovieTag({ db: w.db, groupId: w.group.id, movieId: again.movie.id, tag: 'christmas' }));
		const exists = unwrap(await suggest(w, 77));
		expect(exists.kind).toBe('exists');
		expect(exists.themedAs).toBeNull();
		expect(loadMovieTags(w.db, w.group.id).get(again.movie.id)).toBeUndefined();
	});

	test('nothing is tagged on an ordinary night, or once the themed night has left OPEN', async () => {
		world = createTestWorld({ memberNames: MEMBERS, movies: [{ title: 'Alien' }] });
		const w = world;
		const plain = openRound(w);
		expect(unwrap(await suggest(w, 77)).themedAs).toBeNull();
		w.db.update(rounds).set({ state: 'abandoned' }).where(eq(rounds.id, plain.id)).run();

		tag(w, 'Alien', 'Halloween');
		const themed = openRound(w, 'Halloween');
		rsvpAndSwipe(w, themed.id, { Alien: 4 });
		unwrap(advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: themed.id, now: BASE_NOW }));
		expect(openRoundTheme(w.db, w.group.id)).toBeNull();
		const late = unwrap(await suggest(w, 78));
		expect(late.themedAs).toBeNull();
		expect(loadMovieTags(w.db, w.group.id).get(late.movie.id)).toBeUndefined();
	});
});
