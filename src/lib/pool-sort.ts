/**
 * The pool list's sort orders. Plain data in, a sorted copy out — shared by the
 * pool screen (which sorts on the server render and in the browser alike) and
 * its tests, which is why it imports nothing but the pure tally module.
 *
 * Every order ends in the same deterministic fallback — newest added first,
 * then id — so two films that tie on the chosen key always come out in the
 * same order, and the default sort is that fallback on its own.
 */

import { STANDING_CHAIN, buildRankRow, compareOnChain, type RankRow } from './tally/tiebreak.js';

export const POOL_SORTS = ['added', 'title', 'year', 'runtime', 'mine', 'group'] as const;
export type PoolSort = (typeof POOL_SORTS)[number];
export const DEFAULT_POOL_SORT: PoolSort = 'added';

/** What the sort control prints, in the order it prints them. */
export const POOL_SORT_LABELS: Record<PoolSort, string> = {
	added: 'Newest added',
	title: 'Title A–Z',
	year: 'Newest release',
	runtime: 'Shortest first',
	mine: 'My vote',
	group: 'Group ranking'
};

export function parsePoolSort(value: string | null | undefined): PoolSort | null {
	return (POOL_SORTS as readonly string[]).includes(value ?? '') ? (value as PoolSort) : null;
}

/** The fields a pool row must carry to be sorted every way. */
export interface SortableMovie {
	id: string;
	title: string;
	year: number | null;
	runtimeMin: number | null;
	addedAt: string;
	status: 'pool' | 'watched' | 'removed';
	myVote: 'yes' | 'no' | null;
	myStarred: boolean;
	/**
	 * The group's standing counts: `yes` includes the starred ones. `null` for a
	 * film the viewer has not answered — the server withholds them (voting-spec:
	 * counts only after your own answer), and the group ranking must not need them.
	 */
	voteCounts: { yes: number; starred: number; no: number; unseen: number } | null;
}

/** Newest added first, then id: every order's last resort. */
function byAdded(a: SortableMovie, b: SortableMovie): number {
	if (a.addedAt !== b.addedAt) return a.addedAt < b.addedAt ? 1 : -1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Ascending on a nullable number, unknowns last. */
function nullsLast(a: number | null, b: number | null): number {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return a - b;
}

/** My own standing vote, loudest first: starred, yes, not yet seen, no. */
function myVoteRank(movie: SortableMovie): number {
	if (movie.myVote === 'yes') return movie.myStarred ? 0 : 1;
	return movie.myVote === null ? 2 : 3;
}

/** A film the viewer has answered, carrying the counts the server sends only then. */
type Answered = SortableMovie & { voteCounts: NonNullable<SortableMovie['voteCounts']> };

function answered(movie: SortableMovie): movie is Answered {
	return movie.myVote !== null && movie.voteCounts !== null;
}

/**
 * The Phase 1 rank row for a film, against the whole current group instead of a
 * round's attendees. `approval` is Phase 1's own definition — yes-votes over the
 * members who saw the card, 0 when nobody has — and the round-only rungs
 * (rotation fairness, seeded random) are not in `STANDING_CHAIN`, so the
 * placeholders their fields get here are never read.
 */
function standingRow(movie: Answered): RankRow {
	const { yes, starred, no } = movie.voteCounts;
	return buildRankRow(
		{ id: movie.id, runtimeMin: movie.runtimeMin, suggestedBy: '' },
		{ yesVotes: yes, starVotes: starred, approval: yes + no > 0 ? yes / (yes + no) : 0 },
		{ attendees: new Set(), fairness: new Map(), seed: 0 }
	);
}

/**
 * A sorted copy of `movies`.
 *
 * "Group ranking" is Phase 1's finalist order (voting-spec, Selecting
 * finalists) with no round around it: films still in the pool first — a
 * watched film is not in the race, just as Phase 1 drops it — then most
 * yes-votes, most stars, highest approval and shortest runtime, exactly the
 * boundary chain's rungs in its order, minus the two that need a round. No
 * coverage or approval floor gates anything: this is a ranking to browse, not
 * a finalist cut.
 *
 * Only films the viewer has ANSWERED are ranked. The ones they have not sink
 * below them in the neutral default order (newest added, then id), and nothing
 * about the group's votes reaches that order — it could not, since the server
 * sends no counts for them — so the sort hints nothing a film's page would not
 * show. The four bands, top to bottom: answered pool films, unanswered pool
 * films, answered watched films, unanswered watched films.
 */
export function sortPool<T extends SortableMovie>(movies: readonly T[], sort: PoolSort): T[] {
	let compare: (a: T, b: T) => number;
	switch (sort) {
		case 'title':
			compare = (a, b) =>
				a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
			break;
		case 'year':
			// Newest release first; a film with no known year sinks.
			compare = (a, b) => nullsLast(a.year === null ? null : -a.year, b.year === null ? null : -b.year);
			break;
		case 'runtime':
			compare = (a, b) => nullsLast(a.runtimeMin, b.runtimeMin);
			break;
		case 'mine':
			compare = (a, b) => myVoteRank(a) - myVoteRank(b);
			break;
		case 'group': {
			const rows = new Map<string, RankRow>();
			for (const movie of movies) {
				if (answered(movie)) rows.set(movie.id, standingRow(movie));
			}
			const band = (movie: T) => (movie.status !== 'pool' ? 2 : 0) + (rows.has(movie.id) ? 0 : 1);
			compare = (a, b) => {
				const byBand = band(a) - band(b);
				if (byBand !== 0) return byBand;
				const rowA = rows.get(a.id);
				const rowB = rows.get(b.id);
				// Same band, so both ranked or neither: unranked falls to newest added.
				return rowA && rowB ? compareOnChain(STANDING_CHAIN, rowA, rowB) : 0;
			};
			break;
		}
		default:
			compare = () => 0;
	}
	return movies.slice().sort((a, b) => compare(a, b) || byAdded(a, b));
}
