import { describe, expect, test } from 'vitest';
import { parsePoolSort, sortPool, type SortableMovie } from './pool-sort.js';

let n = 0;
function film(title: string, extra: Partial<SortableMovie> = {}): SortableMovie {
	n++;
	return {
		id: `m${String(n).padStart(3, '0')}`,
		title,
		year: 2000,
		runtimeMin: 100,
		addedAt: `2026-01-${String(n).padStart(2, '0')}T00:00:00.000Z`,
		status: 'pool',
		myVote: null,
		myStarred: false,
		voteCounts: null,
		...extra
	};
}
/** A film the viewer has answered, carrying the group's counts as the server sends them. */
function answered(title: string, voteCounts: SortableMovie['voteCounts'], extra: Partial<SortableMovie> = {}) {
	return film(title, { myVote: 'yes', voteCounts, ...extra });
}
const titles = (movies: SortableMovie[]) => movies.map((movie) => movie.title);
const counts = (yes: number, starred: number, no: number, unseen = 0) => ({ yes, starred, no, unseen });

describe('parsePoolSort', () => {
	test('accepts the known orders and nothing else', () => {
		expect(parsePoolSort('group')).toBe('group');
		expect(parsePoolSort('votes')).toBeNull();
		expect(parsePoolSort(null)).toBeNull();
	});
});

describe('sortPool', () => {
	test('newest added first is the default, and the fallback for every tie', () => {
		const a = film('Alien');
		const b = film('Brazil');
		const c = film('Casino');
		expect(titles(sortPool([a, c, b], 'added'))).toEqual(['Casino', 'Brazil', 'Alien']);
		// All three tie on runtime, so the tie falls through to newest added.
		expect(titles(sortPool([a, c, b], 'runtime'))).toEqual(['Casino', 'Brazil', 'Alien']);
	});

	test('title, year and runtime; unknown year and runtime sink', () => {
		const movies = [
			film('casino', { year: 1995, runtimeMin: 178 }),
			film('Alien', { year: 1979, runtimeMin: null }),
			film('Brazil', { year: null, runtimeMin: 132 }),
			film('Dune', { year: 2021, runtimeMin: 155 })
		];
		expect(titles(sortPool(movies, 'title'))).toEqual(['Alien', 'Brazil', 'casino', 'Dune']);
		expect(titles(sortPool(movies, 'year'))).toEqual(['Dune', 'casino', 'Alien', 'Brazil']);
		expect(titles(sortPool(movies, 'runtime'))).toEqual(['Brazil', 'Dune', 'casino', 'Alien']);
	});

	test('my vote groups starred, yes, not yet seen, no', () => {
		const movies = [
			film('No', { myVote: 'no' }),
			film('Unseen'),
			film('Yes', { myVote: 'yes' }),
			film('Star', { myVote: 'yes', myStarred: true })
		];
		expect(titles(sortPool(movies, 'mine'))).toEqual(['Star', 'Yes', 'Unseen', 'No']);
	});

	test('group ranking follows the Phase 1 chain: yes, then stars, then approval, then runtime', () => {
		const movies = [
			answered('Most yes', counts(4, 0, 3)),
			answered('Fewer yes, all starred', counts(3, 3, 0)),
			answered('Tied yes, more stars', counts(2, 2, 2)),
			answered('Tied yes, fewer stars, better approval', counts(2, 1, 0)),
			answered('Tied yes and stars, worse approval', counts(2, 1, 2)),
			answered('Tied all, shorter', counts(2, 1, 2), { runtimeMin: 90 }),
			answered('Only my no', counts(0, 0, 1, 3), { myVote: 'no' })
		];
		expect(titles(sortPool(movies, 'group'))).toEqual([
			'Most yes',
			'Fewer yes, all starred',
			'Tied yes, more stars',
			'Tied yes, fewer stars, better approval',
			'Tied all, shorter',
			'Tied yes and stars, worse approval',
			'Only my no'
		]);
	});

	test('group ranking puts watched films after the pool, and ties fall back to newest added', () => {
		const movies = [
			answered('Watched favourite', counts(5, 5, 0), { status: 'watched' }),
			answered('Older', counts(1, 0, 0)),
			answered('Newer', counts(1, 0, 0))
		];
		expect(titles(sortPool(movies, 'group'))).toEqual(['Newer', 'Older', 'Watched favourite']);
	});

	test('films I have not answered sink below the answered ones, newest added first, whatever their votes', () => {
		// The server sends no counts for an unanswered film; even if one slipped
		// through, it must not move it — only the viewer's own answer ranks a film.
		const movies = [
			film('Unanswered, oldest', { voteCounts: counts(9, 9, 0) }),
			answered('Answered, weak', counts(0, 0, 3)),
			film('Unanswered, middle', { voteCounts: null }),
			answered('Answered, strong', counts(3, 1, 0)),
			film('Unanswered, newest', { voteCounts: counts(1, 0, 8) })
		];
		expect(titles(sortPool(movies, 'group'))).toEqual([
			'Answered, strong',
			'Answered, weak',
			'Unanswered, newest',
			'Unanswered, middle',
			'Unanswered, oldest'
		]);
	});

	test('four bands: answered pool, unanswered pool, answered watched, unanswered watched', () => {
		const movies = [
			film('Watched, unanswered', { status: 'watched' }),
			answered('Watched, answered', counts(5, 5, 0), { status: 'watched' }),
			film('Pool, unanswered'),
			answered('Pool, answered', counts(0, 0, 5), { myVote: 'no' })
		];
		expect(titles(sortPool(movies, 'group'))).toEqual([
			'Pool, answered',
			'Pool, unanswered',
			'Watched, answered',
			'Watched, unanswered'
		]);
	});

	test('sorting returns a copy and leaves the input alone', () => {
		const movies = [film('B'), film('A')];
		sortPool(movies, 'title');
		expect(titles(movies)).toEqual(['B', 'A']);
	});
});
