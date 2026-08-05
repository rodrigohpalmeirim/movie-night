/**
 * TMDB proxy. The API key stays server-side and is never serialised to a client.
 *
 * app-spec: "Member types a title; the server proxies TMDB `/search/movie` (API
 * key stays server-side)" and "runtime fetched from the movie detail endpoint at
 * save time — it feeds tiebreak rule 5". Search responses are cached briefly
 * server-side.
 *
 * `fetchImpl` is injectable so the integration tests never touch the network.
 */

import type { MovieDetails } from './db/schema.js';

const DEFAULT_BASE = 'https://api.themoviedb.org/3';

/**
 * Overridable so a self-hosted mirror — or an end-to-end smoke test — can point
 * the proxy somewhere else without touching code. Defaults to TMDB itself.
 */
function baseUrl(): string {
	return process.env.TMDB_BASE_URL?.replace(/\/$/, '') || DEFAULT_BASE;
}

export interface TmdbSearchResult {
	tmdbId: number;
	title: string;
	year: number | null;
	posterPath: string | null;
	overview: string;
}

export interface TmdbDetail {
	tmdbId: number;
	title: string;
	year: number | null;
	posterPath: string | null;
	/** null when TMDB has no runtime — ranks last on tiebreak rule 5. */
	runtimeMin: number | null;
	/** The extras from the same call: tagline, overview, genres, cast, trailer. */
	details: MovieDetails;
}

export class TmdbUnavailableError extends Error {
	constructor(message = 'TMDB is not configured') {
		super(message);
		this.name = 'TmdbUnavailableError';
	}
}

/**
 * TMDB has two credential formats and they are NOT interchangeable:
 *
 *   - **v3 API key** — 32 hex characters. Must be sent as the `api_key` query
 *     parameter. Sending it as `Authorization: Bearer` returns 401.
 *   - **v4 read access token** — a long JWT (three dot-separated base64url
 *     segments). Must be sent as `Authorization: Bearer`.
 *
 * Getting this wrong 401s every search and every suggestion, so the format is
 * detected rather than assumed.
 */
export type TmdbAuthStyle = 'v3-query' | 'v4-bearer';

export function detectAuthStyle(key: string): TmdbAuthStyle {
	// A v4 read token is a JWT: header.payload.signature.
	if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) return 'v4-bearer';
	if (/^[0-9a-fA-F]{32}$/.test(key)) return 'v3-query';
	// Unknown shape: prefer the v3 query parameter, because that is what the
	// TMDB dashboard hands out by default and what most .env files hold.
	return 'v3-query';
}

/**
 * Just the callable surface of `fetch` that this client uses. Narrower than
 * `typeof fetch` on purpose, so a test double is three lines rather than a full
 * platform-fetch stand-in (Bun's `fetch` also carries `preconnect`).
 */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface TmdbClientOptions {
	apiKey?: string | undefined;
	fetchImpl?: FetchLike;
	/** Search cache TTL. Short on purpose: results are not the source of truth. */
	cacheTtlMs?: number;
	/** Defaults to $TMDB_BASE_URL, then to TMDB itself. */
	baseUrl?: string;
	now?: () => number;
	/** Which country's age rating to prefer. Defaults to $CERT_COUNTRY, then PT. */
	certCountry?: string;
}

interface CacheEntry {
	expiresAt: number;
	value: TmdbSearchResult[];
}

function yearOf(releaseDate: unknown): number | null {
	if (typeof releaseDate !== 'string' || releaseDate.length < 4) return null;
	const year = Number.parseInt(releaseDate.slice(0, 4), 10);
	return Number.isFinite(year) ? year : null;
}

/* ------------------------------------------------------------------ */
/* Details: one call, five facts                                       */
/* ------------------------------------------------------------------ */

/**
 * `append_to_response` folds videos, credits and certifications into the single
 * `/movie/{id}` request, so a suggestion still costs TMDB exactly one call.
 */
export const DETAIL_APPEND = 'videos,credits,release_dates';

/** Portugal, because that is where this group watches films. */
export const DEFAULT_CERT_COUNTRY = 'PT';
/** Everything TMDB has is certified here, so it is the universal second choice. */
export const CERT_FALLBACK_COUNTRY = 'US';
/** The card back and the detail screen both print five names. */
export const MAX_CAST = 5;

/** $CERT_COUNTRY, upper-cased, defaulting to PT. */
export function certCountry(): string {
	const configured = process.env.CERT_COUNTRY?.trim();
	return (configured && configured.length > 0 ? configured : DEFAULT_CERT_COUNTRY).toUpperCase();
}

function text(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function list(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object') : [];
}

/**
 * Preference order, most wanted first: an official Trailer, then any Trailer,
 * then an official Teaser. Anything else (clips, featurettes, unofficial
 * teasers, non-YouTube sites) is not a trailer and is left alone — a "watch
 * trailer" button that opens a behind-the-scenes reel is worse than no button.
 * Within a rung, TMDB's own order wins.
 */
export function pickTrailerKey(videos: unknown): string | null {
	const youtube = list(videos).filter(
		(video) => video.site === 'YouTube' && typeof video.key === 'string' && video.key.length > 0
	);
	const rungs: Array<(video: Record<string, unknown>) => boolean> = [
		(video) => video.type === 'Trailer' && video.official === true,
		(video) => video.type === 'Trailer',
		(video) => video.type === 'Teaser' && video.official === true
	];
	for (const matches of rungs) {
		const found = youtube.find(matches);
		if (found) return found.key as string;
	}
	return null;
}

/**
 * The age rating for `country`, then for the US, then whatever TMDB happens to
 * have. TMDB carries empty-string certifications for re-releases and formats,
 * so a country counts as rated only if it has a non-empty one.
 */
export function pickCertification(releaseDates: unknown, country: string): string | null {
	const countries = list(releaseDates);
	const ratingFor = (code: string): string | null => {
		const entry = countries.find((row) => row.iso_3166_1 === code);
		if (!entry) return null;
		for (const release of list(entry.release_dates)) {
			const certification = text(release.certification);
			if (certification) return certification;
		}
		return null;
	};

	const preferred = ratingFor(country) ?? ratingFor(CERT_FALLBACK_COUNTRY);
	if (preferred) return preferred;
	for (const entry of countries) {
		const certification = ratingFor(String(entry.iso_3166_1 ?? ''));
		if (certification) return certification;
	}
	return null;
}

/**
 * Everything the extras need, pulled out of one `append_to_response` payload.
 *
 * Total tolerance is the contract: a payload with none of this — no videos, no
 * credits, no certifications, or a body that is not even an object — yields an
 * empty `MovieDetails`, never a throw. The screens render sections only when
 * they have content, so "TMDB knows nothing about this film" and "TMDB has not
 * been asked yet" look the same to the reader and different to the backfill
 * (which keys off the row being null, not off the blob being empty).
 */
export function extractDetails(raw: unknown, country: string = certCountry()): MovieDetails {
	const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const credits = (body.credits && typeof body.credits === 'object' ? body.credits : {}) as Record<string, unknown>;
	const videos = (body.videos && typeof body.videos === 'object' ? body.videos : {}) as Record<string, unknown>;
	const releaseDates = (body.release_dates && typeof body.release_dates === 'object' ? body.release_dates : {}) as Record<
		string,
		unknown
	>;

	const cast = list(credits.cast)
		.filter((person) => typeof person.name === 'string')
		// TMDB sorts by billing already; sorting again keeps that true if it stops.
		.sort((a, b) => (typeof a.order === 'number' ? a.order : 999) - (typeof b.order === 'number' ? b.order : 999))
		.slice(0, MAX_CAST)
		.map((person) => ({ name: person.name as string, character: text(person.character) ?? '' }));

	return {
		tagline: text(body.tagline),
		overview: text(body.overview),
		genres: list(body.genres).flatMap((genre) => {
			const name = text(genre.name);
			return name ? [name] : [];
		}),
		certification: pickCertification(releaseDates.results, country),
		directors: list(credits.crew)
			.filter((person) => person.job === 'Director')
			.flatMap((person) => {
				const name = text(person.name);
				return name ? [name] : [];
			}),
		cast,
		trailerKey: pickTrailerKey(videos.results)
	};
}

/** A details blob with nothing in it — what a totally unknown film yields. */
export function emptyDetails(): MovieDetails {
	return {
		tagline: null,
		overview: null,
		genres: [],
		certification: null,
		directors: [],
		cast: [],
		trailerKey: null
	};
}

export class TmdbClient {
	#apiKey: string | undefined;
	#fetch: FetchLike;
	#cacheTtlMs: number;
	#base: string;
	#now: () => number;
	#certCountry: string;
	#searchCache = new Map<string, CacheEntry>();

	constructor(options: TmdbClientOptions = {}) {
		this.#apiKey = options.apiKey ?? process.env.TMDB_API_KEY;
		this.#fetch = options.fetchImpl ?? fetch;
		this.#cacheTtlMs = options.cacheTtlMs ?? 60_000;
		this.#now = options.now ?? Date.now;
		this.#base = options.baseUrl ?? baseUrl();
		this.#certCountry = (options.certCountry ?? certCountry()).toUpperCase();
	}

	get configured(): boolean {
		return typeof this.#apiKey === 'string' && this.#apiKey.length > 0;
	}

	async search(query: string): Promise<TmdbSearchResult[]> {
		const trimmed = query.trim();
		if (trimmed.length === 0) return [];
		this.#requireKey();

		const key = trimmed.toLowerCase();
		const cached = this.#searchCache.get(key);
		const now = this.#now();
		if (cached && cached.expiresAt > now) return cached.value;

		const url = `${this.#base}/search/movie?query=${encodeURIComponent(trimmed)}&include_adult=false&page=1`;
		const body = (await this.#get(url)) as { results?: unknown[] };
		const results: TmdbSearchResult[] = (body.results ?? [])
			.map((raw) => raw as Record<string, unknown>)
			.filter((raw) => typeof raw.id === 'number' && typeof raw.title === 'string')
			.map((raw) => ({
				tmdbId: raw.id as number,
				title: raw.title as string,
				year: yearOf(raw.release_date),
				posterPath: typeof raw.poster_path === 'string' ? raw.poster_path : null,
				overview: typeof raw.overview === 'string' ? raw.overview : ''
			}));

		this.#searchCache.set(key, { expiresAt: now + this.#cacheTtlMs, value: results });
		if (this.#searchCache.size > 256) this.#sweep(now);
		return results;
	}

	/**
	 * Fetched at save time because the runtime feeds the shortest-runtime
	 * tiebreak — and, since `append_to_response` rides along for free, the same
	 * request brings back the tagline, overview, genres, certification, credits
	 * and trailer the detail screen and the card back print.
	 */
	async detail(tmdbId: number): Promise<TmdbDetail> {
		this.#requireKey();
		const raw = (await this.#get(
			`${this.#base}/movie/${tmdbId}?append_to_response=${DETAIL_APPEND}`
		)) as Record<string, unknown>;
		if (typeof raw.id !== 'number' || typeof raw.title !== 'string') {
			throw new TmdbUnavailableError('TMDB returned an unexpected movie payload');
		}
		const runtime = raw.runtime;
		return {
			tmdbId: raw.id,
			title: raw.title,
			year: yearOf(raw.release_date),
			posterPath: typeof raw.poster_path === 'string' ? raw.poster_path : null,
			runtimeMin: typeof runtime === 'number' && runtime > 0 ? runtime : null,
			// Extras must never be able to sink a suggestion, so extraction is
			// defensive AND belt-and-braced: a shape nobody predicted yields an empty
			// blob and the film is still saved.
			details: (() => {
				try {
					return extractDetails(raw, this.#certCountry);
				} catch {
					return emptyDetails();
				}
			})()
		};
	}

	#requireKey(): void {
		if (!this.configured) throw new TmdbUnavailableError('TMDB_API_KEY is not set');
	}

	/** Which credential style the configured key requires. */
	get authStyle(): TmdbAuthStyle {
		return detectAuthStyle(this.#apiKey ?? '');
	}

	async #get(url: string): Promise<unknown> {
		const headers: Record<string, string> = { Accept: 'application/json' };
		let target = url;
		if (this.authStyle === 'v4-bearer') {
			headers.Authorization = `Bearer ${this.#apiKey}`;
		} else {
			// v3 keys must travel as a query parameter; as a Bearer token TMDB 401s.
			const parsed = new URL(url);
			parsed.searchParams.set('api_key', this.#apiKey ?? '');
			target = parsed.toString();
		}

		let response: Response;
		try {
			response = await this.#fetch(target, { headers });
		} catch (cause) {
			throw new TmdbUnavailableError(`TMDB request failed: ${(cause as Error).message}`);
		}
		if (!response.ok) {
			throw new TmdbUnavailableError(`TMDB responded ${response.status}`);
		}
		return response.json();
	}

	#sweep(now: number): void {
		for (const [key, entry] of this.#searchCache) {
			if (entry.expiresAt <= now) this.#searchCache.delete(key);
		}
	}

	/** Test helper. */
	clearCache(): void {
		this.#searchCache.clear();
	}
}

let shared: TmdbClient | undefined;

/** Process-wide client, so the search cache is actually shared. */
export function getTmdb(): TmdbClient {
	shared ??= new TmdbClient();
	return shared;
}
