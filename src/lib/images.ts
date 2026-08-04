/**
 * TMDB image URLs.
 *
 * app-spec: "posters served from `image.tmdb.org`". That is the one third-party
 * origin the app talks to — fonts, scripts and styles stay self-hosted, and
 * `Referrer-Policy: same-origin` (set in `hooks.server.ts`) stops the invite
 * token leaking in the `Referer` header of every poster request.
 */

const BASE = 'https://image.tmdb.org/t/p';

export type PosterSize = 'w92' | 'w185' | 'w342' | 'w500' | 'w780';

export function posterUrl(path: string | null | undefined, size: PosterSize = 'w342'): string | null {
	if (!path) return null;
	return `${BASE}/${size}${path}`;
}

/** "1979 · 1h 57m" — the two facts a poster does not already show. */
export function movieMeta(year: number | null, runtimeMin: number | null): string {
	const parts: string[] = [];
	if (year !== null) parts.push(String(year));
	if (runtimeMin !== null) parts.push(formatRuntime(runtimeMin));
	return parts.join(' · ');
}

export function formatRuntime(runtimeMin: number | null): string {
	if (runtimeMin === null) return 'runtime unknown';
	const hours = Math.floor(runtimeMin / 60);
	const minutes = runtimeMin % 60;
	return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * The trailer link. A plain YouTube watch URL, opened in a new tab: app-spec
 * allows exactly one third-party origin (`image.tmdb.org`), so a trailer is a
 * link off the app and never an embedded player.
 */
export function trailerUrl(key: string | null | undefined): string | null {
	if (!key) return null;
	return `https://www.youtube.com/watch?v=${encodeURIComponent(key)}`;
}

/** "Action · Science Fiction · M/12" — whichever of the two the film has. */
export function genreLine(
	genres: string[] | null | undefined,
	certification: string | null | undefined
): string {
	return [...(genres ?? []), ...(certification ? [certification] : [])].join(' · ');
}

export function formatDate(iso: string | null): string {
	if (!iso) return '';
	return new Date(iso).toLocaleDateString(undefined, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
}

/** "30 Jul 26" — short enough to fit on the second line of a stamp. */
export function formatStampDate(iso: string | null): string {
	if (!iso) return '';
	return new Date(iso).toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'short',
		year: '2-digit'
	});
}

export function formatPercent(value: number): string {
	return `${Math.round(value * 100)}%`;
}

/** Human label for the tiebreak rule stored on a round. */
export const TIEBREAK_LABELS: Record<string, string> = {
	stars: 'most stars',
	copeland: 'most pairwise wins (Copeland)',
	approval: 'higher approval',
	rotation_fairness: 'rotation fairness — longest without a winning suggestion',
	shortest_runtime: 'shortest runtime',
	seeded_random: 'seeded random draw'
};
