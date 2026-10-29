/**
 * Standing-vote counts: public as numbers, never as people.
 *
 * voting-spec, cross-cutting rules: "Standing-vote counts are public; voters are
 * not." The group's aggregate standing counts may be shown at any time, counted
 * over its CURRENT members — but no payload may map a standing vote to anyone
 * except the viewer. So that a first answer is the voter's own, the swipe screen
 * carries no counts at all, and a film's page carries none until the viewer has
 * answered that film.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { movies as moviesTable, type MovieDetails } from './db/index.js';
import { sortPool } from '../pool-sort.js';
import { unwrap } from './result.js';
import { removeMember, restoreMember } from './services/groups.js';
import { setStandingVote } from './services/movies.js';
import { buildPoolBrowseView, buildPoolView, loadVoteCounts, type VoteCounts } from './services/views.js';
import { AGGREGATE_KEYS, BASE_NOW, collectKeys, createTestWorld, type TestWorld } from './testing.js';
import { load as loadPoolPage } from '../../routes/g/[token]/pool/+page.server.js';
import { load as loadSwipePage } from '../../routes/g/[token]/swipe/+page.server.js';
import {
	actions as moviePageActions,
	load as loadMoviePage
} from '../../routes/g/[token]/movies/[id]/+page.server.js';

let world: TestWorld | undefined;
afterEach(() => {
	world?.cleanup();
	world = undefined;
});

const MEMBERS = ['Ana', 'Ben', 'Cal', 'Dee', 'Eve'];

/** Seeded with details, so no route load below ever reaches for TMDB. */
const DETAILS: MovieDetails = {
	tagline: null,
	overview: null,
	genres: [],
	certification: null,
	directors: [],
	cast: [],
	trailerKey: null
};

/**
 * Alien: Ana and Ben star it, Cal says yes, Dee says no, Eve has not seen it.
 * Brazil: nobody has swiped it.
 */
function scenario() {
	const w = createTestWorld({
		memberNames: MEMBERS,
		movies: [
			{ title: 'Alien', details: DETAILS },
			{ title: 'Brazil', details: DETAILS }
		]
	});
	const vote = (name: string, value: 'yes' | 'no', starred = false) =>
		unwrap(
			setStandingVote({
				db: w.db,
				groupId: w.group.id,
				memberId: w.member(name).id,
				movieId: w.movie('Alien').id,
				value,
				starred,
				now: BASE_NOW
			})
		);
	vote('Ana', 'yes', true);
	vote('Ben', 'yes', true);
	vote('Cal', 'yes');
	vote('Dee', 'no');
	return w;
}

function counts(w: TestWorld, title: string): VoteCounts {
	return loadVoteCounts(w.db, w.group.id).get(w.movie(title).id)!;
}

/** The slice of `RequestEvent` the three loads touch, with a real cookie jar. */
function event(
	w: TestWorld,
	name: string,
	path: string,
	params: Record<string, string> = {},
	jar = new Map<string, string>(),
	form?: Record<string, string>
) {
	const url = new URL(`http://localhost/g/${w.group.inviteToken}${path}`);
	const body = form ? new FormData() : undefined;
	for (const [key, value] of Object.entries(form ?? {})) body!.set(key, value);
	const routeId = params.id ? '/g/[token]/movies/[id]' : `/g/[token]/${url.pathname.split('/')[3]}`;
	return {
		locals: { db: w.db, group: w.group, config: w.config, member: w.member(name) },
		route: { id: routeId },
		params: { token: w.group.inviteToken, ...params },
		request: form ? new Request(url, { method: 'POST', body }) : new Request(url),
		url,
		cookies: {
			get: (key: string) => jar.get(key),
			set: (key: string, value: string) => void jar.set(key, value)
		}
	} as never;
}

/** Every string anywhere in a payload, for "is this person named or id'd in it". */
function strings(value: unknown, into: string[] = []): string[] {
	if (typeof value === 'string') into.push(value);
	else if (Array.isArray(value)) for (const item of value) strings(item, into);
	else if (value !== null && typeof value === 'object') for (const child of Object.values(value)) strings(child, into);
	return into;
}

describe('the counts', () => {
	test('count the current members: yes includes the stars, and the three buckets add up to the group', () => {
		world = scenario();
		expect(counts(world, 'Alien')).toEqual({ yes: 3, starred: 2, no: 1, unseen: 1 });
		expect(counts(world, 'Brazil')).toEqual({ yes: 0, starred: 0, no: 0, unseen: 5 });
	});

	test('a removed member stops counting — their vote, their star, and their "not yet seen" — and comes back on restore', () => {
		world = scenario();
		const w = world;
		unwrap(removeMember({ db: w.db, groupId: w.group.id, memberId: w.member('Ben').id, now: BASE_NOW }));
		unwrap(removeMember({ db: w.db, groupId: w.group.id, memberId: w.member('Eve').id, now: BASE_NOW }));
		expect(counts(w, 'Alien')).toEqual({ yes: 2, starred: 1, no: 1, unseen: 0 });
		expect(counts(w, 'Brazil')).toEqual({ yes: 0, starred: 0, no: 0, unseen: 3 });

		unwrap(restoreMember({ db: w.db, groupId: w.group.id, memberId: w.member('Ben').id }));
		expect(counts(w, 'Alien')).toEqual({ yes: 3, starred: 2, no: 1, unseen: 0 });
	});
});

describe('counts are numbers, never people', () => {
	test('the pool list carries counts on the films I answered, and each is four integers and nothing else', () => {
		world = scenario();
		const pool = buildPoolBrowseView({ db: world.db, group: world.group, me: world.member('Cal') });
		const alien = pool.movies.find((movie) => movie.title === 'Alien')!;
		expect(alien.voteCounts).toEqual({ yes: 3, starred: 2, no: 1, unseen: 1 });
		expect(Object.keys(alien.voteCounts!).sort()).toEqual(['no', 'starred', 'unseen', 'yes']);
		for (const value of Object.values(alien.voteCounts!)) expect(Number.isInteger(value)).toBe(true);
	});

	test('the pool list carries no counts for a film I have not answered', () => {
		world = scenario();
		const w = world;
		// Eve has answered nothing; Cal has answered Alien but not Brazil.
		const eve = buildPoolBrowseView({ db: w.db, group: w.group, me: w.member('Eve') });
		const cal = buildPoolBrowseView({ db: w.db, group: w.group, me: w.member('Cal') });
		const unanswered = [
			...eve.movies,
			cal.movies.find((movie) => movie.title === 'Brazil')!
		];
		for (const movie of unanswered) {
			expect(movie.myVote).toBeNull();
			expect(movie.voteCounts).toBeNull();
			const keys = collectKeys(movie);
			for (const key of ['yes', 'no', 'starred', 'unseen']) expect(keys.has(key)).toBe(false);
		}
	});

	test('nothing in the pool list maps a vote to a member: the only person on a card is its suggester', () => {
		world = scenario();
		const w = world;
		const pool = buildPoolBrowseView({ db: w.db, group: w.group, me: w.member('Cal') });
		// The suggester credit is public and predates this rule; strip it, and no
		// member is identifiable anywhere in what is left.
		const rest = pool.movies.map(({ suggestedBy, ...movie }) => (void suggestedBy, movie));
		const text = strings(rest);
		for (const name of MEMBERS) {
			expect(text).not.toContain(w.member(name).id);
			expect(text).not.toContain(name);
		}
		// The viewer's own answer is still theirs to see.
		expect(pool.movies.find((movie) => movie.title === 'Alien')?.myVote).toBe('yes');
	});

	test("the film's own page shows the counts and no voter but the viewer", async () => {
		world = scenario();
		const w = world;
		const alien = w.movie('Alien').id;
		const data = (await loadMoviePage(event(w, 'Cal', `/movies/${alien}`, { id: alien }))) as {
			voteCounts: VoteCounts;
			myVote: string | null;
			movie: { suggestedBy: string | null };
		};
		expect(data.voteCounts).toEqual({ yes: 3, starred: 2, no: 1, unseen: 1 });
		expect(data.myVote).toBe('yes');
		expect(data.movie.suggestedBy).toBe('Ana');
		const text = strings(data);
		for (const name of MEMBERS) expect(text).not.toContain(w.member(name).id);
		for (const name of ['Ben', 'Dee', 'Eve']) expect(text).not.toContain(name);
	});
});

describe("a film's page withholds the counts until the viewer has answered it", () => {
	type MoviePage = { voteCounts: VoteCounts | null; myVote: string | null };
	const page = async (w: TestWorld, name: string, movieId: string) =>
		(await loadMoviePage(event(w, name, `/movies/${movieId}`, { id: movieId }))) as MoviePage;
	/** The screen's own vote form, through its own action. */
	const answer = (w: TestWorld, name: string, movieId: string, form: Record<string, string>) =>
		moviePageActions.vote(event(w, name, `/movies/${movieId}`, { id: movieId }, undefined, form));

	test('absent before the vote, present after it — a starred yes', async () => {
		world = scenario();
		const w = world;
		const alien = w.movie('Alien').id;

		const before = await page(w, 'Eve', alien);
		expect(before.myVote).toBeNull();
		expect(before.voteCounts).toBeNull();
		// Not merely unprinted: no count, under any name, is anywhere in the payload.
		const keys = collectKeys(before);
		for (const key of ['yes', 'no', 'starred', 'unseen']) expect(keys.has(key)).toBe(false);

		await answer(w, 'Eve', alien, { value: 'yes', starred: 'true' });
		// What `update()` does after the form posts: the same load, run again.
		const after = await page(w, 'Eve', alien);
		expect(after.myVote).toBe('yes');
		expect(after.voteCounts).toEqual({ yes: 4, starred: 3, no: 1, unseen: 0 });
	});

	test('a viewer who answers "no" sees them too', async () => {
		world = scenario();
		const w = world;
		const brazil = w.movie('Brazil').id;
		expect((await page(w, 'Ana', brazil)).voteCounts).toBeNull();

		await answer(w, 'Ana', brazil, { value: 'no' });
		const after = await page(w, 'Ana', brazil);
		expect(after.myVote).toBe('no');
		expect(after.voteCounts).toEqual({ yes: 0, starred: 0, no: 1, unseen: 4 });
	});

	test("one viewer's answer opens the counts for them only", async () => {
		world = scenario();
		const w = world;
		const alien = w.movie('Alien').id;
		expect((await page(w, 'Cal', alien)).voteCounts).not.toBeNull();
		expect((await page(w, 'Eve', alien)).voteCounts).toBeNull();
	});
});

describe('the swipe screen never carries counts', () => {
	test('the deck read has no counts', () => {
		world = scenario();
		const pool = buildPoolView({ db: world.db, group: world.group, me: world.member('Eve') });
		const keys = collectKeys(pool);
		expect(keys.has('voteCounts')).toBe(false);
		expect(AGGREGATE_KEYS.filter((key) => keys.has(key))).toEqual([]);
	});

	test('nor does the swipe page payload', async () => {
		world = scenario();
		const data = (await loadSwipePage(event(world, 'Eve', '/swipe'))) as { stack: unknown[] };
		expect(data.stack.length).toBe(2);
		const keys = collectKeys(data);
		expect(keys.has('voteCounts')).toBe(false);
		expect(keys.has('unseen')).toBe(false);
		expect(AGGREGATE_KEYS.filter((key) => keys.has(key))).toEqual([]);
	});
});

describe('the pool sort', () => {
	test('group ranking puts the films I have not answered last, newest added first, whatever their votes', () => {
		world = createTestWorld({
			memberNames: MEMBERS,
			movies: ['Old favourite', 'Weak', 'Mid', 'New dud'].map((title) => ({ title }))
		});
		const w = world;
		const day = (n: number) => new Date(BASE_NOW.getTime() + n * 86_400_000);
		const added: Record<string, number> = { 'Old favourite': 1, Weak: 2, Mid: 3, 'New dud': 4 };
		for (const [title, n] of Object.entries(added)) {
			w.db.update(moviesTable).set({ addedAt: day(n) }).where(eq(moviesTable.id, w.movie(title).id)).run();
		}
		const vote = (name: string, title: string, value: 'yes' | 'no', starred = false) =>
			unwrap(
				setStandingVote({
					db: w.db,
					groupId: w.group.id,
					memberId: w.member(name).id,
					movieId: w.movie(title).id,
					value,
					starred
				})
			);
		// The group loves "Old favourite" and hates "New dud"; Eve has answered
		// only "Weak" (no) and "Mid" (yes).
		for (const name of ['Ana', 'Ben', 'Cal', 'Dee']) {
			vote(name, 'Old favourite', 'yes', true);
			vote(name, 'New dud', 'no');
		}
		vote('Ana', 'Mid', 'yes');
		vote('Eve', 'Weak', 'no');
		vote('Eve', 'Mid', 'yes');

		const pool = buildPoolBrowseView({ db: w.db, group: w.group, me: w.member('Eve') });
		expect(sortPool(pool.movies, 'group').map((movie) => movie.title)).toEqual([
			'Mid', // answered: 2 yes
			'Weak', // answered: 0 yes
			'New dud', // unanswered, newest added — the group's four noes do not sink it
			'Old favourite' // unanswered, oldest — four stars do not lift it
		]);
	});

	test('comes from the URL, is remembered for a visit without one, and ignores nonsense', async () => {
		world = scenario();
		const w = world;
		const jar = new Map<string, string>();
		const sortOf = async (path: string) =>
			((await loadPoolPage(event(w, 'Cal', path, {}, jar))) as { sort: string }).sort;

		expect(await sortOf('/pool')).toBe('added');
		expect(await sortOf('/pool?sort=group')).toBe('group');
		// The tab bar and "Back to the pool" carry no sort: the last one holds.
		expect(await sortOf('/pool')).toBe('group');
		expect(await sortOf('/pool?sort=bogus')).toBe('group');
		expect(await sortOf('/pool?sort=title&tag=halloween')).toBe('title');
		expect(await sortOf('/pool')).toBe('title');
	});
});
