/**
 * Tags on films, and the themes rounds are played under.
 *
 * app-spec (Movies → Tags): free-form, group-scoped, trust-based — any member can
 * put a tag on a film or take one off, from the film's own screen. Tags are public
 * facts like a film's genres, so they carry no phase gate and are serialized with
 * the movie wherever it appears.
 *
 * The one place a tag reaches a tally is a THEMED round: it deals only films that
 * carry its theme (voting-spec, Eligibility). That filter is applied where the
 * round's candidate set is built (`planAdvance`), once, at OPEN → RUNOFF — the
 * moment the finalists are frozen — so the pure tally never hears about tags, and
 * tagging or untagging a film during a live runoff moves nothing.
 *
 * Normalisation and the presets live in `$lib/tags.ts`, shared with the screens.
 */

import { and, asc, eq, inArray } from 'drizzle-orm';
import { movieTags, movies, rounds, type Db } from '../db/index.js';
import { notifyGroup } from '../events.js';
import { fail, ok, type Result } from '../result.js';
import { cleanTagLabel, MAX_TAG_LENGTH, PRESET_TAGS, presetTag, tagKey, type TagRef } from '../../tags.js';

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/**
 * Every tag in the group, by movie — one query, whatever the pool's size, so a
 * view can hand each card its tags without a query per card. Removed and watched
 * films are included: they keep their tags (a film that comes back comes back
 * tagged), and History prints watched films.
 */
export function loadMovieTags(db: Db, groupId: string): Map<string, TagRef[]> {
	const rows = db
		.select({ movieId: movieTags.movieId, key: movieTags.tag, label: movieTags.label })
		.from(movieTags)
		.innerJoin(movies, eq(movies.id, movieTags.movieId))
		.where(eq(movies.groupId, groupId))
		.orderBy(asc(movieTags.label), asc(movieTags.tag))
		.all();
	const byMovie = new Map<string, TagRef[]>();
	for (const row of rows) {
		const list = byMovie.get(row.movieId) ?? [];
		list.push({ key: row.key, label: row.label });
		byMovie.set(row.movieId, list);
	}
	return byMovie;
}

/** One entry in a tag or theme picker. */
export interface TagSummary extends TagRef {
	/** Films in the POOL carrying it right now — public inventory, not a tally. */
	poolCount: number;
	preset: boolean;
}

/**
 * What the pickers offer: the two presets, always — even before any film carries
 * them — then every other tag the group has used, most-used first. Counts are
 * pool films only: the number a picker prints is "how many films would this night
 * have to choose from", and a watched or removed film is not on the table.
 */
export function groupTagSummaries(db: Db, groupId: string): TagSummary[] {
	const rows = db
		.select({ key: movieTags.tag, label: movieTags.label, status: movies.status })
		.from(movieTags)
		.innerJoin(movies, eq(movies.id, movieTags.movieId))
		.where(eq(movies.groupId, groupId))
		.all();

	const byKey = new Map<string, TagSummary>(
		PRESET_TAGS.map((preset) => [preset.key, { ...preset, poolCount: 0, preset: true }])
	);
	for (const row of rows) {
		const entry = byKey.get(row.key) ?? { key: row.key, label: row.label, poolCount: 0, preset: false };
		if (row.status === 'pool') entry.poolCount++;
		byKey.set(row.key, entry);
	}
	const presets = PRESET_TAGS.map((preset) => byKey.get(preset.key)!);
	const others = [...byKey.values()]
		.filter((entry) => !entry.preset)
		.sort((a, b) => b.poolCount - a.poolCount || a.label.localeCompare(b.label));
	return [...presets, ...others];
}

/** Ids of the group's films carrying `key`, in any status. */
export function moviesTaggedWith(db: Db, groupId: string, key: string): Set<string> {
	return new Set(
		db
			.select({ movieId: movieTags.movieId })
			.from(movieTags)
			.innerJoin(movies, eq(movies.id, movieTags.movieId))
			.where(and(eq(movies.groupId, groupId), eq(movieTags.tag, key)))
			.all()
			.map((row) => row.movieId)
	);
}

/**
 * How the group already spells a key, if it has used it. Presets spell
 * themselves; otherwise the oldest row wins, so the first person to type a tag
 * names it for everyone and "sci-fi" typed later still prints as "Sci-Fi".
 */
function knownLabel(db: Db, groupId: string, key: string): string | undefined {
	const preset = presetTag(key);
	if (preset) return preset.label;
	return db
		.select({ label: movieTags.label })
		.from(movieTags)
		.innerJoin(movies, eq(movies.id, movieTags.movieId))
		.where(and(eq(movies.groupId, groupId), eq(movieTags.tag, key)))
		.orderBy(asc(movieTags.createdAt))
		.limit(1)
		.get()?.label;
}

/**
 * Raw input → the tag it names, spelled the way the group spells it. `null` is a
 * blank (or overlong) input, which callers turn into their own message.
 */
export function resolveTag(db: Db, groupId: string, raw: unknown): TagRef | null {
	const cleaned = cleanTagLabel(raw);
	if (cleaned === null) return null;
	const key = tagKey(cleaned);
	return { key, label: knownLabel(db, groupId, key) ?? cleaned };
}

const TAG_LENGTH_MESSAGE = `A tag is 1-${MAX_TAG_LENGTH} characters`;

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

function findMovie(db: Db, groupId: string, movieId: string) {
	return db
		.select({ id: movies.id })
		.from(movies)
		.where(and(eq(movies.id, movieId), eq(movies.groupId, groupId)))
		.get();
}

/**
 * Puts a tag on a film. Idempotent: tagging a film with a tag it already carries,
 * however it is spelled this time, is a successful no-op that returns the tag as
 * the group spells it.
 *
 * Any status: a watched or removed film keeps its tags, so it may gain one too —
 * nothing about a tag is a vote, and the film may well come back.
 */
export function addMovieTag(input: {
	db: Db;
	groupId: string;
	movieId: string;
	label: unknown;
	actorId: string;
	now?: Date;
	/** Set by the auto-tag on suggestion, which pings once for the whole act. */
	silent?: boolean;
}): Result<TagRef> {
	const tag = resolveTag(input.db, input.groupId, input.label);
	if (tag === null) return fail('invalid_input', TAG_LENGTH_MESSAGE);
	if (!findMovie(input.db, input.groupId, input.movieId)) {
		return fail('unknown_movie', 'That movie is not in this group');
	}

	const inserted = input.db
		.insert(movieTags)
		.values({
			movieId: input.movieId,
			tag: tag.key,
			label: tag.label,
			createdBy: input.actorId,
			createdAt: input.now ?? new Date()
		})
		.onConflictDoNothing()
		.returning()
		.get();
	if (inserted && !input.silent) notifyGroup(input.groupId);
	return ok(tag);
}

/**
 * Takes a tag off a film. Accepts the key or any spelling of it, and is
 * idempotent: removing a tag the film does not carry is a no-op, so two members
 * tapping the same chip resolve to one removal and one shrug.
 */
export function removeMovieTag(input: {
	db: Db;
	groupId: string;
	movieId: string;
	tag: unknown;
}): Result<{ removed: boolean }> {
	const cleaned = cleanTagLabel(input.tag);
	if (cleaned === null) return fail('invalid_input', TAG_LENGTH_MESSAGE);
	if (!findMovie(input.db, input.groupId, input.movieId)) {
		return fail('unknown_movie', 'That movie is not in this group');
	}
	const deleted = input.db
		.delete(movieTags)
		.where(and(eq(movieTags.movieId, input.movieId), eq(movieTags.tag, tagKey(cleaned))))
		.returning()
		.all();
	if (deleted.length > 0) notifyGroup(input.groupId);
	return ok({ removed: deleted.length > 0 });
}

/* ------------------------------------------------------------------ */
/* Themes                                                              */
/* ------------------------------------------------------------------ */

/**
 * A round's theme from what the lobby posted: blank (or "none") is an ordinary
 * night; anything else is a tag — a preset, one the group already uses, or a new
 * one, which is fine: a theme no film carries yet is a night whose films get
 * suggested during it (they are tagged on the way in).
 */
export function resolveTheme(db: Db, groupId: string, raw: unknown): Result<TagRef | null> {
	if (raw === undefined || raw === null) return ok(null);
	if (typeof raw !== 'string') return fail('invalid_input', 'A theme is a tag name');
	if (raw.trim() === '' || raw.trim().toLowerCase() === 'none') return ok(null);
	const tag = resolveTag(db, groupId, raw);
	if (tag === null) return fail('invalid_input', `A theme is 1-${MAX_TAG_LENGTH} characters`);
	return ok(tag);
}

/** The round's theme as a tag, or null for an ordinary night. */
export function roundTheme(round: { theme: string | null; themeLabel: string | null }): TagRef | null {
	return round.theme !== null ? { key: round.theme, label: round.themeLabel ?? round.theme } : null;
}

/**
 * The theme of the group's OPEN round, if it has one — the window in which a
 * theme shapes the table: new suggestions are tagged with it, and the swipe deck
 * deals its films first. From RUNOFF on the finalists are frozen, so a tag added
 * then could change nothing, and the shaping stops.
 */
export function openRoundTheme(db: Db, groupId: string): TagRef | null {
	const round = db
		.select({ theme: rounds.theme, themeLabel: rounds.themeLabel })
		.from(rounds)
		.where(and(eq(rounds.groupId, groupId), eq(rounds.state, 'open')))
		.get();
	return round ? roundTheme(round) : null;
}

/**
 * "6 Halloween films on the table": pool films carrying the key. Inventory, like
 * the lobby's pool size — it says nothing about how anyone voted.
 */
export function countPoolFilmsTagged(db: Db, groupId: string, key: string): number {
	const ids = [...moviesTaggedWith(db, groupId, key)];
	if (ids.length === 0) return 0;
	return db
		.select({ id: movies.id })
		.from(movies)
		.where(and(inArray(movies.id, ids), eq(movies.status, 'pool')))
		.all().length;
}
