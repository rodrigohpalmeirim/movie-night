/**
 * The TMDB extras: extraction from a real payload, and the lazy backfill.
 *
 * The extraction fixture is a trimmed capture of an actual
 * `GET /movie/603?append_to_response=videos,credits,release_dates` response, so
 * these tests fail if TMDB's shape and this parser ever disagree — which is the
 * only failure mode a hand-written literal would hide.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { movies, type MovieDetails } from './db/index.js';
import { unwrap } from './result.js';
import { backfillDetails, clearDetailsInFlight, DETAILS_RETRY_MS, detailsWanted } from './services/details.js';
import { suggestMovie } from './services/movies.js';
import {
	emptyDetails,
	extractDetails,
	pickCertification,
	pickTrailerKey,
	TmdbClient
} from './tmdb.js';
import { BASE_NOW, createTestWorld, fakeTmdb, type TestWorld } from './testing.js';
import FIXTURE from './fixtures/tmdb-movie-603.json' with { type: 'json' };

let world: TestWorld | undefined;
afterEach(() => {
	world?.cleanup();
	clearDetailsInFlight();
	world = undefined;
});

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

describe('extracting details from a captured TMDB response', () => {
	test('pulls the printed facts out of the real payload', () => {
		const details = extractDetails(FIXTURE, 'PT');
		expect(details.tagline).toBe('Believe the unbelievable.');
		expect(details.overview?.startsWith('Set in the 22nd century')).toBe(true);
		expect(details.genres).toEqual(['Action', 'Science Fiction']);
		expect(details.directors).toEqual(['Lana Wachowski', 'Lilly Wachowski']);
	});

	test('takes the top five cast members, in billing order, with their roles', () => {
		const details = extractDetails(FIXTURE, 'PT');
		expect(details.cast.length).toBe(5);
		expect(details.cast[0]).toEqual({ name: 'Keanu Reeves', character: 'Neo' });
		expect(details.cast.map((person) => person.name)).toEqual([
			'Keanu Reeves',
			'Laurence Fishburne',
			'Carrie-Anne Moss',
			'Hugo Weaving',
			'Gloria Foster'
		]);
	});

	test('billing order is enforced, not assumed from the array order', () => {
		const shuffled = {
			credits: {
				cast: [
					{ name: 'Sixth', character: 'F', order: 5 },
					{ name: 'First', character: 'A', order: 0 },
					{ name: 'Third', character: 'C', order: 2 },
					{ name: 'Second', character: 'B', order: 1 },
					{ name: 'Fifth', character: 'E', order: 4 },
					{ name: 'Fourth', character: 'D', order: 3 }
				]
			}
		};
		expect(extractDetails(shuffled, 'PT').cast.map((person) => person.name)).toEqual([
			'First',
			'Second',
			'Third',
			'Fourth',
			'Fifth'
		]);
	});

	test('the certification is the CERT_COUNTRY one', () => {
		expect(extractDetails(FIXTURE, 'PT').certification).toBe('M/12');
		expect(extractDetails(FIXTURE, 'DE').certification).toBe('16');
	});

	test('an uncertified country falls back to US, then to whatever exists', () => {
		// TMDB has no NZ block in this payload, so the US rating stands in.
		expect(extractDetails(FIXTURE, 'NZ').certification).toBe('R');

		const noUs = {
			release_dates: {
				results: [
					{ iso_3166_1: 'JP', release_dates: [{ certification: 'G' }] },
					{ iso_3166_1: 'FR', release_dates: [{ certification: 'Tous publics' }] }
				]
			}
		};
		expect(extractDetails(noUs, 'PT').certification).toBe('G');
	});

	test('an empty certification string is not a rating', () => {
		const blanks = {
			release_dates: {
				results: [
					{ iso_3166_1: 'PT', release_dates: [{ certification: '' }, { certification: '  ' }] },
					{ iso_3166_1: 'US', release_dates: [{ certification: '' }, { certification: 'PG-13' }] }
				]
			}
		};
		expect(extractDetails(blanks, 'PT').certification).toBe('PG-13');
		expect(pickCertification([], 'PT')).toBeNull();
	});

	test('the trailer is an official YouTube Trailer, by preference', () => {
		// The fixture's videos start with three featurettes; the first Trailer in
		// TMDB's own order is the one that wins.
		expect(extractDetails(FIXTURE, 'PT').trailerKey).toBe('FVI84Dfx2-I');
	});

	test('trailer preference: official Trailer > any Trailer > official Teaser', () => {
		const video = (over: Record<string, unknown>) => ({
			site: 'YouTube',
			type: 'Trailer',
			official: false,
			key: 'k',
			...over
		});
		expect(
			pickTrailerKey([
				video({ type: 'Teaser', official: true, key: 'teaser-official' }),
				video({ official: false, key: 'trailer-fan' }),
				video({ official: true, key: 'trailer-official' })
			])
		).toBe('trailer-official');
		expect(
			pickTrailerKey([
				video({ type: 'Teaser', official: true, key: 'teaser-official' }),
				video({ official: false, key: 'trailer-fan' })
			])
		).toBe('trailer-fan');
		expect(
			pickTrailerKey([
				video({ type: 'Teaser', official: false, key: 'teaser-fan' }),
				video({ type: 'Teaser', official: true, key: 'teaser-official' })
			])
		).toBe('teaser-official');
		// An unofficial teaser, a clip and a featurette are not trailers.
		expect(
			pickTrailerKey([
				video({ type: 'Teaser', official: false, key: 'teaser-fan' }),
				video({ type: 'Clip', official: true, key: 'clip' }),
				video({ type: 'Featurette', official: true, key: 'featurette' })
			])
		).toBeNull();
	});

	test('only YouTube keys are taken, because the button builds a YouTube URL', () => {
		expect(
			pickTrailerKey([
				{ site: 'Vimeo', type: 'Trailer', official: true, key: 'vimeo-id' },
				{ site: 'YouTube', type: 'Trailer', official: true, key: 'youtube-id' }
			])
		).toBe('youtube-id');
		expect(pickTrailerKey([{ site: 'Vimeo', type: 'Trailer', official: true, key: 'vimeo-id' }])).toBeNull();
	});

	test('a payload missing absolutely everything yields empty details, never a throw', () => {
		const empty = emptyDetails();
		expect(extractDetails({ id: 1, title: 'Obscurity' }, 'PT')).toEqual(empty);
		expect(extractDetails({}, 'PT')).toEqual(empty);
		expect(extractDetails(null, 'PT')).toEqual(empty);
		expect(extractDetails('nonsense', 'PT')).toEqual(empty);
		// Present-but-wrong-shaped blocks are just as tolerated as absent ones.
		expect(
			extractDetails(
				{ tagline: '   ', overview: '', genres: 'Action', credits: 7, videos: { results: 'no' }, release_dates: null },
				'PT'
			)
		).toEqual(empty);
	});
});

/* ------------------------------------------------------------------ */
/* Caching at suggest time                                             */
/* ------------------------------------------------------------------ */

const CATALOGUE = {
	603: { title: 'The Matrix', runtime: 136, year: 1999, extras: FIXTURE as Record<string, unknown> },
	77: { title: 'Memento', runtime: null }
};

describe('suggesting caches the details in the same call', () => {
	test('the extras land on the row at save time', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const created = unwrap(
			await suggestMovie({
				db: world.db,
				groupId: world.group.id,
				config: world.config,
				actorId: world.member('Ana').id,
				tmdbId: 603,
				tmdb: fakeTmdb(CATALOGUE),
				now: BASE_NOW
			})
		);
		expect(created.movie.details?.tagline).toBe('Believe the unbelievable.');
		expect(created.movie.details?.trailerKey).toBe('FVI84Dfx2-I');
		expect(created.movie.detailsFetchedAt?.getTime()).toBe(BASE_NOW.getTime());
		// One call for the runtime AND the extras: append_to_response, not a second
		// round trip.
		let calls = 0;
		const counted = fakeTmdb(CATALOGUE, { onDetail: () => calls++ });
		await counted.detail(603);
		expect(calls).toBe(1);
	});

	test('a film TMDB knows nothing about is still suggested, with empty details', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const created = unwrap(
			await suggestMovie({
				db: world.db,
				groupId: world.group.id,
				config: world.config,
				actorId: world.member('Ana').id,
				tmdbId: 77,
				tmdb: fakeTmdb(CATALOGUE)
			})
		);
		expect(created.movie.title).toBe('Memento');
		expect(created.movie.details).toEqual(emptyDetails());
	});
});

/* ------------------------------------------------------------------ */
/* Lazy backfill                                                       */
/* ------------------------------------------------------------------ */

function tmdbFor(world: TestWorld, seen: number[], options: { fail?: boolean } = {}): TmdbClient {
	const titles = new Map(world.movies.map((movie) => [movie.tmdbId, movie.title]));
	return new TmdbClient({
		apiKey: 'test-key',
		certCountry: 'PT',
		fetchImpl: async (input) => {
			const tmdbId = Number(String(input).match(/\/movie\/(\d+)/)?.[1]);
			seen.push(tmdbId);
			if (options.fail) return new Response('nope', { status: 503 });
			return Response.json({
				...FIXTURE,
				id: tmdbId,
				title: titles.get(tmdbId) ?? 'Unknown',
				tagline: `Tagline for ${titles.get(tmdbId)}`
			});
		}
	});
}

function rowOf(world: TestWorld, title: string) {
	return world.db.select().from(movies).where(eq(movies.id, world.movie(title).id)).get()!;
}

const POOL = [{ title: 'Alien' }, { title: 'Brazil' }, { title: 'Casino' }, { title: 'Dune' }];

describe('the lazy backfill', () => {
	test('fetches a missing film once, then never again', async () => {
		world = createTestWorld({ memberNames: ['Ana'], movies: [{ title: 'Alien' }] });
		const seen: number[] = [];
		const tmdb = tmdbFor(world, seen);
		const ids = [world.movie('Alien').id];

		const first = await backfillDetails({ db: world.db, tmdb, movieIds: ids, now: BASE_NOW });
		expect(first.get(ids[0])?.tagline).toBe('Tagline for Alien');
		expect(seen.length).toBe(1);
		expect(rowOf(world, 'Alien').details?.genres).toEqual(['Action', 'Science Fiction']);

		// A later read is served from the row: cached means cached, and a fact about
		// a finished film does not go stale.
		const later = new Date(BASE_NOW.getTime() + 365 * 24 * 60 * 60 * 1000);
		const second = await backfillDetails({ db: world.db, tmdb, movieIds: ids, now: later });
		expect(second.size).toBe(0);
		expect(seen.length).toBe(1);
	});

	test('one page load spends at most its budget, and takes the cards in order', async () => {
		world = createTestWorld({ memberNames: ['Ana'], movies: POOL });
		const seen: number[] = [];
		const tmdb = tmdbFor(world, seen);
		const ids = POOL.map((movie) => world!.movie(movie.title).id);

		const filled = await backfillDetails({ db: world.db, tmdb, movieIds: ids, now: BASE_NOW, budget: 2 });
		expect(filled.size).toBe(2);
		expect(seen).toEqual([world.movie('Alien').tmdbId, world.movie('Brazil').tmdbId]);
		expect(rowOf(world, 'Casino').details).toBeNull();
		expect(rowOf(world, 'Casino').detailsFetchedAt).toBeNull();

		// The next visit picks up where this one stopped.
		await backfillDetails({ db: world.db, tmdb, movieIds: ids, now: BASE_NOW, budget: 2 });
		expect(seen.length).toBe(4);
		expect(rowOf(world, 'Dune').details).not.toBeNull();
	});

	test('a failure stamps the attempt, leaves the film usable, and waits out the retry window', async () => {
		world = createTestWorld({ memberNames: ['Ana'], movies: [{ title: 'Alien' }] });
		const seen: number[] = [];
		const broken = tmdbFor(world, seen, { fail: true });
		const ids = [world.movie('Alien').id];

		expect((await backfillDetails({ db: world.db, tmdb: broken, movieIds: ids, now: BASE_NOW })).size).toBe(0);
		const afterFailure = rowOf(world, 'Alien');
		// Still a perfectly usable movie — title, runtime, poster, votes untouched.
		expect(afterFailure.title).toBe('Alien');
		expect(afterFailure.details).toBeNull();
		expect(afterFailure.detailsFetchedAt?.getTime()).toBe(BASE_NOW.getTime());

		// Inside the window, TMDB is left alone however many times the page reloads.
		const soon = new Date(BASE_NOW.getTime() + DETAILS_RETRY_MS - 1000);
		await backfillDetails({ db: world.db, tmdb: broken, movieIds: ids, now: soon });
		await backfillDetails({ db: world.db, tmdb: broken, movieIds: ids, now: soon });
		expect(seen.length).toBe(1);

		// Once it elapses, the film gets another chance — and TMDB is back.
		const later = new Date(BASE_NOW.getTime() + DETAILS_RETRY_MS + 1000);
		const working = tmdbFor(world, seen);
		const filled = await backfillDetails({ db: world.db, tmdb: working, movieIds: ids, now: later });
		expect(filled.get(ids[0])?.tagline).toBe('Tagline for Alien');
		expect(seen.length).toBe(2);
	});

	test('an unconfigured TMDB is a no-op, not an attempt', async () => {
		world = createTestWorld({ memberNames: ['Ana'], movies: [{ title: 'Alien' }] });
		const filled = await backfillDetails({
			db: world.db,
			tmdb: new TmdbClient({ apiKey: '' }),
			movieIds: [world.movie('Alien').id],
			now: BASE_NOW
		});
		expect(filled.size).toBe(0);
		// No stamp: nothing was tried, so nothing has to wait out a retry window
		// once a key is configured.
		expect(rowOf(world, 'Alien').detailsFetchedAt).toBeNull();
	});

	test('an empty read, or one whose films are all cached, touches nothing', async () => {
		const details: MovieDetails = { ...emptyDetails(), tagline: 'Already known' };
		world = createTestWorld({ memberNames: ['Ana'], movies: [{ title: 'Alien', details }] });
		const seen: number[] = [];
		const tmdb = tmdbFor(world, seen);
		expect((await backfillDetails({ db: world.db, tmdb, movieIds: [], now: BASE_NOW })).size).toBe(0);
		expect((await backfillDetails({ db: world.db, tmdb, movieIds: [world.movie('Alien').id], now: BASE_NOW })).size).toBe(0);
		expect(seen).toEqual([]);
	});

	test('detailsWanted is the whole rule, and it is only ever about a null blob', () => {
		const stamped = { id: 'm', tmdbId: 1, details: null, detailsFetchedAt: BASE_NOW };
		expect(detailsWanted({ ...stamped, detailsFetchedAt: null }, BASE_NOW)).toBe(true);
		expect(detailsWanted(stamped, BASE_NOW)).toBe(false);
		expect(detailsWanted(stamped, new Date(BASE_NOW.getTime() + DETAILS_RETRY_MS))).toBe(true);
		expect(
			detailsWanted({ ...stamped, details: emptyDetails() }, new Date(BASE_NOW.getTime() + 1e12))
		).toBe(false);
	});
});
