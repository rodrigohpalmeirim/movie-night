/**
 * TMDB proxy. The API key stays server-side and is never serialised to a client.
 *
 * app-spec: "Member types a title; the server proxies TMDB `/search/movie` (API
 * key stays server-side)" and "runtime fetched from the movie detail endpoint at
 * save time — it feeds tiebreak rule 4". Search responses are cached briefly
 * server-side.
 *
 * `fetchImpl` is injectable so the integration tests never touch the network.
 */

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
	/** null when TMDB has no runtime — ranks last on tiebreak rule 4. */
	runtimeMin: number | null;
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

export class TmdbClient {
	#apiKey: string | undefined;
	#fetch: FetchLike;
	#cacheTtlMs: number;
	#base: string;
	#now: () => number;
	#searchCache = new Map<string, CacheEntry>();

	constructor(options: TmdbClientOptions = {}) {
		this.#apiKey = options.apiKey ?? process.env.TMDB_API_KEY;
		this.#fetch = options.fetchImpl ?? fetch;
		this.#cacheTtlMs = options.cacheTtlMs ?? 60_000;
		this.#now = options.now ?? Date.now;
		this.#base = options.baseUrl ?? baseUrl();
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

	/** Fetched at save time because it feeds the shortest-runtime tiebreak. */
	async detail(tmdbId: number): Promise<TmdbDetail> {
		this.#requireKey();
		const raw = (await this.#get(`${this.#base}/movie/${tmdbId}`)) as Record<string, unknown>;
		if (typeof raw.id !== 'number' || typeof raw.title !== 'string') {
			throw new TmdbUnavailableError('TMDB returned an unexpected movie payload');
		}
		const runtime = raw.runtime;
		return {
			tmdbId: raw.id,
			title: raw.title,
			year: yearOf(raw.release_date),
			posterPath: typeof raw.poster_path === 'string' ? raw.poster_path : null,
			runtimeMin: typeof runtime === 'number' && runtime > 0 ? runtime : null
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
