/**
 * Lazy backfill of the cached TMDB extras.
 *
 * app-spec: details are fetched at suggest time, but the pool predates the
 * feature (and TMDB is allowed to be down when someone suggests), so any row
 * can be missing them. The rule is therefore: a server-side read that needs the
 * extras fetches the ones it is missing, caches them on the row, and serves
 * them — the reader pays once, nobody runs a batch job.
 *
 * Three brakes keep that from turning a page load into a TMDB stampede:
 *
 *   1. A BUDGET per read. At most `DETAILS_FETCH_BUDGET` films are fetched for
 *      one page load, in parallel; the rest keep their nulls and get picked up
 *      by the next read. A twelve-film pool warms itself over a few visits
 *      instead of firing twelve requests at once.
 *   2. A RETRY WINDOW. Every attempt stamps `details_fetched_at`, successful or
 *      not, and a row that failed is not retried until the window elapses. A
 *      film TMDB has deleted therefore costs one request per window, forever,
 *      rather than one per page load.
 *   3. AN IN-FLIGHT SET. Two tabs loading the same screen at the same instant
 *      would otherwise both fetch; the second skips what the first is already
 *      doing. Process-local, which is exactly the scope of the problem (one
 *      small Bun server, one SQLite file).
 *
 * Nothing here can fail a read: every error path leaves the movie exactly as
 * usable as it was, with null details and a stamped attempt.
 */

import { eq, inArray } from 'drizzle-orm';
import { movies, type Db, type Movie, type MovieDetails } from '../db/index.js';
import { TmdbUnavailableError, type TmdbClient } from '../tmdb.js';

/** Six hours: long enough that a broken film is cheap, short enough to self-heal. */
export const DETAILS_RETRY_MS = 6 * 60 * 60 * 1000;

/** How many films one page load may fetch. */
export const DETAILS_FETCH_BUDGET = 3;

/** Movie ids currently being fetched by this process. */
const inFlight = new Set<string>();

type DetailsRow = Pick<Movie, 'id' | 'tmdbId' | 'details' | 'detailsFetchedAt'>;

/**
 * Does this row want a (re)fetch? Only ever true for a row with NO details:
 * once TMDB has answered, the answer is kept — the extras are facts about a
 * finished film, not a feed.
 */
export function detailsWanted(row: DetailsRow, now: Date, retryMs: number = DETAILS_RETRY_MS): boolean {
	if (row.details) return false;
	if (!row.detailsFetchedAt) return true;
	return now.getTime() - row.detailsFetchedAt.getTime() >= retryMs;
}

export interface BackfillInput {
	db: Db;
	tmdb: TmdbClient;
	/** The movies this read is about to serve. Order is the priority order. */
	movieIds: string[];
	now?: Date;
	budget?: number;
	retryMs?: number;
}

/**
 * Fills in what is missing, within budget, and returns only what it managed to
 * fetch — keyed by movie id, for the caller to merge into its payload. A caller
 * that gets an empty map serves what the rows already had.
 */
export async function backfillDetails(input: BackfillInput): Promise<Map<string, MovieDetails>> {
	const filled = new Map<string, MovieDetails>();
	if (input.movieIds.length === 0 || !input.tmdb.configured) return filled;

	const now = input.now ?? new Date();
	const budget = input.budget ?? DETAILS_FETCH_BUDGET;
	const retryMs = input.retryMs ?? DETAILS_RETRY_MS;

	const rows = input.db
		.select({
			id: movies.id,
			tmdbId: movies.tmdbId,
			details: movies.details,
			detailsFetchedAt: movies.detailsFetchedAt
		})
		.from(movies)
		.where(inArray(movies.id, input.movieIds))
		.all();

	// Back into the caller's order, so the card on screen is fetched before the
	// one three cards down the stack.
	const byId = new Map(rows.map((row) => [row.id, row]));
	const candidates: DetailsRow[] = [];
	for (const id of input.movieIds) {
		const row = byId.get(id);
		if (!row || inFlight.has(id)) continue;
		if (detailsWanted(row, now, retryMs)) candidates.push(row);
		if (candidates.length >= budget) break;
	}
	if (candidates.length === 0) return filled;

	for (const row of candidates) inFlight.add(row.id);
	try {
		await Promise.all(
			candidates.map(async (row) => {
				let details: MovieDetails | null = null;
				try {
					details = (await input.tmdb.detail(row.tmdbId)).details;
				} catch (error) {
					// An unavailable TMDB is an expected state, not an incident: stamp the
					// attempt so the retry window applies, and serve the film without its
					// extras. Anything else is a real bug and must not be swallowed
					// silently — but it still may not break the page.
					if (!(error instanceof TmdbUnavailableError)) {
						console.error(`[details] unexpected failure for tmdb ${row.tmdbId}`, error);
					}
				}
				input.db
					.update(movies)
					.set(details ? { details, detailsFetchedAt: now } : { detailsFetchedAt: now })
					.where(eq(movies.id, row.id))
					.run();
				if (details) filled.set(row.id, details);
			})
		);
	} finally {
		for (const row of candidates) inFlight.delete(row.id);
	}
	return filled;
}

/**
 * Folds a backfill's results into an already-serialised payload, so the read
 * that paid for the fetch is also the read that serves it — nobody has to
 * reload to see a tagline.
 */
export function mergeDetails<T extends { id: string; details: MovieDetails | null }>(
	cards: T[],
	filled: Map<string, MovieDetails>
): T[] {
	if (filled.size === 0) return cards;
	return cards.map((card) => {
		const details = filled.get(card.id);
		return details ? { ...card, details } : card;
	});
}

/** Test helper: the in-flight set is process-wide, so tests must be able to clear it. */
export function clearDetailsInFlight(): void {
	inFlight.clear();
}
