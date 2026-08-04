/**
 * Movie suggestion (TMDB proxy, dedupe, restore, re-watch cooldown), standing
 * votes, removal, and settings validation.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import {
	DEFAULT_GROUP_CONFIG,
	groups,
	movies,
	standingVotes,
	toTallyConfig,
	withConfigDefaults,
	type GroupConfig
} from './db/index.js';
import { unwrap, type Result } from './result.js';
import { regenerateInviteToken, renameMember, updateSettings, validateConfigPatch } from './services/groups.js';
import { removeMovie, setStandingVote, suggestMovie } from './services/movies.js';
import { detectAuthStyle, TmdbClient, TmdbUnavailableError } from './tmdb.js';
import { suggestLimiter, tmdbSearchLimiter } from './ratelimit.js';
import { BASE_NOW, createTestWorld, fakeTmdb, type TestWorld } from './testing.js';

let world: TestWorld | undefined;
afterEach(() => {
	world?.cleanup();
	world = undefined;
});

function code(result: Result<unknown>): string {
	if (result.ok) throw new Error('expected a failure');
	return result.code;
}

const CATALOGUE = {
	550: { title: 'Fight Club', runtime: 139 },
	13: { title: 'Forrest Gump', runtime: 142 },
	77: { title: 'Memento', runtime: null }
};

/* ------------------------------------------------------------------ */

describe('TMDB proxy', () => {
	test('search maps results and never exposes the key', async () => {
		const tmdb = fakeTmdb(CATALOGUE);
		const results = await tmdb.search('fight');
		expect(results).toEqual([
			{ tmdbId: 550, title: 'Fight Club', year: 2021, posterPath: '/p550.jpg', overview: '' }
		]);
		expect(JSON.stringify(results)).not.toContain('test-key');
	});

	test('search results are cached briefly, then refetched', async () => {
		let calls = 0;
		let clock = 1_000;
		const tmdb = new TmdbClient({
			apiKey: 'k',
			cacheTtlMs: 60_000,
			now: () => clock,
			fetchImpl: async () => {
				calls++;
				return Response.json({ results: [] });
			}
		});
		await tmdb.search('alien');
		await tmdb.search('ALIEN'); // case-insensitive cache hit
		expect(calls).toBe(1);
		clock += 60_001;
		await tmdb.search('alien');
		expect(calls).toBe(2);
	});

	test('an empty query never hits the network', async () => {
		const tmdb = new TmdbClient({
			apiKey: 'k',
			fetchImpl: async () => {
				throw new Error('should not be called');
			}
		});
		expect(await tmdb.search('   ')).toEqual([]);
	});

	test('a missing API key surfaces as unavailable, not a crash', async () => {
		// An explicit empty key means "not configured"; `undefined` would fall back
		// to process.env.TMDB_API_KEY, which may well be set on a dev machine.
		const tmdb = new TmdbClient({ apiKey: '', fetchImpl: async () => Response.json({}) });
		expect(tmdb.configured).toBe(false);
		await expect(tmdb.search('anything')).rejects.toBeInstanceOf(TmdbUnavailableError);
		await expect(tmdb.detail(550)).rejects.toBeInstanceOf(TmdbUnavailableError);
	});

	test('an upstream error surfaces as unavailable', async () => {
		const tmdb = fakeTmdb(CATALOGUE, { failWith: 502 });
		await expect(tmdb.search('fight')).rejects.toBeInstanceOf(TmdbUnavailableError);
	});

	test('a network failure surfaces as unavailable', async () => {
		const tmdb = new TmdbClient({
			apiKey: 'k',
			fetchImpl: async () => {
				throw new Error('ECONNREFUSED');
			}
		});
		await expect(tmdb.search('x')).rejects.toBeInstanceOf(TmdbUnavailableError);
	});

	test('search is rate limited', () => {
		tmdbSearchLimiter.reset();
		let allowed = 0;
		for (let i = 0; i < 40; i++) if (tmdbSearchLimiter.check('198.51.100.4').allowed) allowed++;
		expect(allowed).toBe(30);
		tmdbSearchLimiter.reset();
	});
});

describe('suggesting a movie', () => {
	test('fetches the runtime at save time because it feeds tiebreak rule 4', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const result = unwrap(
			await suggestMovie({
				db: world.db,
				groupId: world.group.id,
				config: world.config,
				actorId: world.member('Ana').id,
				tmdbId: 550,
				tmdb: fakeTmdb(CATALOGUE)
			})
		);
		expect(result.kind).toBe('created');
		expect(result.movie.runtimeMin).toBe(139);
		expect(result.movie.title).toBe('Fight Club');
		expect(result.movie.suggestedBy).toBe(world.member('Ana').id);
		expect(result.movie.status).toBe('pool');
	});

	test('an unknown runtime is stored as null rather than guessed', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const result = unwrap(
			await suggestMovie({
				db: world.db,
				groupId: world.group.id,
				config: world.config,
				actorId: world.member('Ana').id,
				tmdbId: 77,
				tmdb: fakeTmdb(CATALOGUE)
			})
		);
		expect(result.movie.runtimeMin).toBeNull();
	});

	test('re-suggesting a pool movie just navigates to it', async () => {
		world = createTestWorld({ memberNames: ['Ana', 'Ben'] });
		const tmdb = fakeTmdb(CATALOGUE);
		const first = unwrap(
			await suggestMovie({
				db: world.db,
				groupId: world.group.id,
				config: world.config,
				actorId: world.member('Ana').id,
				tmdbId: 550,
				tmdb
			})
		);
		const second = unwrap(
			await suggestMovie({
				db: world.db,
				groupId: world.group.id,
				config: world.config,
				actorId: world.member('Ben').id,
				tmdbId: 550,
				tmdb
			})
		);
		expect(second.kind).toBe('exists');
		expect(second.movie.id).toBe(first.movie.id);
		// Still one row: unique (group_id, tmdb_id).
		expect(world.db.select().from(movies).all().length).toBe(1);
	});

	test('the same movie in another group is a separate row', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const other = createTestWorld({ memberNames: ['Zed'] });
		try {
			const tmdb = fakeTmdb(CATALOGUE);
			unwrap(
				await suggestMovie({
					db: world.db,
					groupId: world.group.id,
					config: world.config,
					actorId: world.member('Ana').id,
					tmdbId: 550,
					tmdb
				})
			);
			const elsewhere = unwrap(
				await suggestMovie({
					db: other.db,
					groupId: other.group.id,
					config: other.config,
					actorId: other.member('Zed').id,
					tmdbId: 550,
					tmdb
				})
			);
			expect(elsewhere.kind).toBe('created');
		} finally {
			other.cleanup();
		}
	});

	test('re-suggesting a removed movie restores it with standing votes intact', async () => {
		world = createTestWorld({ memberNames: ['Ana', 'Ben'], movies: [{ title: 'Alien' }] });
		const alien = world.movie('Alien');
		unwrap(
			setStandingVote({
				db: world.db,
				groupId: world.group.id,
				memberId: world.member('Ana').id,
				movieId: alien.id,
				value: 'yes'
			})
		);
		unwrap(
			removeMovie({
				db: world.db,
				groupId: world.group.id,
				movieId: alien.id,
				actorId: world.member('Ben').id
			})
		);

		const restored = unwrap(
			await suggestMovie({
				db: world.db,
				groupId: world.group.id,
				config: world.config,
				actorId: world.member('Ben').id,
				tmdbId: alien.tmdbId,
				tmdb: fakeTmdb(CATALOGUE)
			})
		);
		expect(restored.kind).toBe('restored');
		expect(restored.movie.status).toBe('pool');
		expect(restored.movie.removedBy).toBeNull();
		expect(
			world.db
				.select()
				.from(standingVotes)
				.where(and(eq(standingVotes.movieId, alien.id), eq(standingVotes.memberId, world.member('Ana').id)))
				.get()?.value
		).toBe('yes');
	});

	test('re-watch is blocked by default (REWATCH_COOLDOWN off)', async () => {
		world = createTestWorld({
			memberNames: ['Ana'],
			movies: [{ title: 'Alien', status: 'watched', watchedAt: BASE_NOW }]
		});
		expect(world.config.rewatch_cooldown).toBeNull();
		const result = await suggestMovie({
			db: world.db,
			groupId: world.group.id,
			config: world.config,
			actorId: world.member('Ana').id,
			tmdbId: world.movie('Alien').tmdbId,
			tmdb: fakeTmdb(CATALOGUE)
		});
		expect(code(result)).toBe('rewatch_cooldown');
	});

	test('a configured cooldown blocks until it elapses, then restores to the pool', async () => {
		world = createTestWorld({
			memberNames: ['Ana'],
			movies: [{ title: 'Alien', status: 'watched', watchedAt: BASE_NOW }],
			config: { rewatch_cooldown: 30 }
		});
		const args = {
			db: world.db,
			groupId: world.group.id,
			config: world.config,
			actorId: world.member('Ana').id,
			tmdbId: world.movie('Alien').tmdbId,
			tmdb: fakeTmdb(CATALOGUE)
		};
		const tooSoon = await suggestMovie({ ...args, now: new Date(BASE_NOW.getTime() + 29 * 86_400_000) });
		expect(code(tooSoon)).toBe('rewatch_cooldown');

		const ready = unwrap(
			await suggestMovie({ ...args, now: new Date(BASE_NOW.getTime() + 31 * 86_400_000) })
		);
		expect(ready.kind).toBe('rewatch');
		expect(ready.movie.status).toBe('pool');
		// `watched_at` is KEPT: the group really did watch it, history refers to that
		// date, and the next cooldown is measured from it. Nulling it made the film
		// forget it had ever been watched.
		expect(ready.movie.watchedAt?.getTime()).toBe(BASE_NOW.getTime());
	});

	test('a bad tmdb id is rejected before any network call', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		for (const tmdbId of [undefined, 'abc', -1, 1.5]) {
			const result = await suggestMovie({
				db: world.db,
				groupId: world.group.id,
				config: world.config,
				actorId: world.member('Ana').id,
				tmdbId,
				tmdb: fakeTmdb(CATALOGUE)
			});
			expect(code(result)).toBe('invalid_input');
		}
	});

	test('an unavailable TMDB becomes a 503-mapped failure, not a crash', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const result = await suggestMovie({
			db: world.db,
			groupId: world.group.id,
			config: world.config,
			actorId: world.member('Ana').id,
			tmdbId: 550,
			tmdb: new TmdbClient({ apiKey: '' })
		});
		expect(code(result)).toBe('tmdb_unavailable');
	});
});

describe('standing votes', () => {
	test('are upserts, not duplicates', () => {
		world = createTestWorld({ memberNames: ['Ana'], movies: [{ title: 'Alien' }] });
		const args = {
			db: world.db,
			groupId: world.group.id,
			memberId: world.member('Ana').id,
			movieId: world.movie('Alien').id
		};
		unwrap(setStandingVote({ ...args, value: 'yes' }));
		unwrap(setStandingVote({ ...args, value: 'no' }));
		const rows = world.db.select().from(standingVotes).all();
		expect(rows.length).toBe(1);
		expect(rows[0].value).toBe('no');
	});

	test('reject anything that is not yes or no', () => {
		world = createTestWorld({ memberNames: ['Ana'], movies: [{ title: 'Alien' }] });
		expect(
			code(
				setStandingVote({
					db: world.db,
					groupId: world.group.id,
					memberId: world.member('Ana').id,
					movieId: world.movie('Alien').id,
					value: 'maybe'
				})
			)
		).toBe('invalid_input');
	});

	test('cannot be cast on another group’s movie', () => {
		world = createTestWorld({ memberNames: ['Ana'], movies: [{ title: 'Alien' }] });
		expect(
			code(
				setStandingVote({
					db: world.db,
					groupId: 'some-other-group',
					memberId: world.member('Ana').id,
					movieId: world.movie('Alien').id,
					value: 'yes'
				})
			)
		).toBe('unknown_movie');
	});
});

describe('removing movies', () => {
	test('records who removed it and is idempotent', () => {
		world = createTestWorld({ memberNames: ['Ana', 'Ben'], movies: [{ title: 'Alien' }] });
		const removed = unwrap(
			removeMovie({
				db: world.db,
				groupId: world.group.id,
				movieId: world.movie('Alien').id,
				actorId: world.member('Ben').id
			})
		);
		expect(removed.status).toBe('removed');
		expect(removed.removedBy).toBe(world.member('Ben').id);
		expect(removed.removedAt).not.toBeNull();
		expect(
			removeMovie({
				db: world.db,
				groupId: world.group.id,
				movieId: world.movie('Alien').id,
				actorId: world.member('Ana').id
			}).ok
		).toBe(true);
	});

	test('a watched movie lives in history and is not removed', () => {
		world = createTestWorld({
			memberNames: ['Ana'],
			movies: [{ title: 'Alien', status: 'watched', watchedAt: BASE_NOW }]
		});
		expect(
			code(
				removeMovie({
					db: world.db,
					groupId: world.group.id,
					movieId: world.movie('Alien').id,
					actorId: world.member('Ana').id
				})
			)
		).toBe('invalid_input');
	});

	test('an unknown movie fails', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		expect(
			code(
				removeMovie({
					db: world.db,
					groupId: world.group.id,
					movieId: 'nope',
					actorId: world.member('Ana').id
				})
			)
		).toBe('unknown_movie');
	});
});

describe('settings', () => {
	test('accepts all six knobs inside their ranges', () => {
		const patch = unwrap(
			validateConfigPatch({
				n_finalists: 4,
				approval_floor: 0.6,
				coverage_floor: 0.5,
				vetoes_enabled: false,
				veto_threshold: 2,
				rewatch_cooldown: 90
			})
		);
		expect(patch).toEqual({
			n_finalists: 4,
			approval_floor: 0.6,
			coverage_floor: 0.5,
			vetoes_enabled: false,
			veto_threshold: 2,
			rewatch_cooldown: 90
		});
	});

	/**
	 * The one boolean knob. A form posts it as a string, so both spellings are
	 * accepted — but nothing else is: a truthiness test would read `"off"` as ON,
	 * which is the quietest possible way to leave vetoes running.
	 */
	test('vetoes_enabled takes true/false in either form, and nothing else', () => {
		expect(unwrap(validateConfigPatch({ vetoes_enabled: 'false' }))).toEqual({
			vetoes_enabled: false
		});
		expect(unwrap(validateConfigPatch({ vetoes_enabled: 'true' }))).toEqual({
			vetoes_enabled: true
		});
		expect(unwrap(validateConfigPatch({ vetoes_enabled: true }))).toEqual({ vetoes_enabled: true });
		for (const raw of ['off', 'on', '0', '1', 0, 1, '', null]) {
			expect(code(validateConfigPatch({ vetoes_enabled: raw }))).toBe('invalid_input');
		}
	});

	test('vetoes_enabled defaults to on, so an older group keeps its veto', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		expect(withConfigDefaults(world.group.config).vetoes_enabled).toBe(true);

		// A blob written before the knob existed: the key is simply absent.
		const { vetoes_enabled: _omitted, ...older } = DEFAULT_GROUP_CONFIG;
		world.db
			.update(groups)
			.set({ config: older as GroupConfig })
			.where(eq(groups.id, world.group.id))
			.run();
		expect(withConfigDefaults(world.reloadGroup().config).vetoes_enabled).toBe(true);

		// ...and a stored `false` survives the same projection.
		unwrap(updateSettings(world.db, { groupId: world.group.id, config: { vetoes_enabled: false } }));
		expect(withConfigDefaults(world.reloadGroup().config).vetoes_enabled).toBe(false);
	});

	// The eligibility floor it set is gone, so it is an unknown setting like any
	// other typo — not a knob that silently does nothing.
	test('the retired min_attendee_votes knob is rejected, not ignored', () => {
		expect(code(validateConfigPatch({ min_attendee_votes: 3 }))).toBe('invalid_input');
	});

	test('coerces form strings', () => {
		expect(unwrap(validateConfigPatch({ n_finalists: '3' }))).toEqual({ n_finalists: 3 });
	});

	test('rejects out-of-range and non-numeric values', () => {
		// N_FINALISTS above 5 would break the "every voter completes all pairs"
		// premise the spec calls load-bearing.
		expect(code(validateConfigPatch({ n_finalists: 6 }))).toBe('invalid_input');
		expect(code(validateConfigPatch({ n_finalists: 1 }))).toBe('invalid_input');
		expect(code(validateConfigPatch({ n_finalists: 3.5 }))).toBe('invalid_input');
		expect(code(validateConfigPatch({ approval_floor: 1.2 }))).toBe('invalid_input');
		expect(code(validateConfigPatch({ coverage_floor: -0.1 }))).toBe('invalid_input');
		expect(code(validateConfigPatch({ veto_threshold: 0 }))).toBe('invalid_input');
		expect(code(validateConfigPatch({ approval_floor: 'nope' }))).toBe('invalid_input');
		expect(code(validateConfigPatch({ nonsense: 1 }))).toBe('invalid_input');
	});

	/**
	 * The ceiling came down from 50 to 5, which is a rule about WRITES. A group that
	 * stored a bigger number under the old ceiling must still read, still tally and
	 * still be editable — the next save is what brings it into range, because the
	 * settings rail cannot express more than 5.
	 */
	test('veto_threshold above 5 is refused on write and tolerated on read', () => {
		expect(unwrap(validateConfigPatch({ veto_threshold: 5 }))).toEqual({ veto_threshold: 5 });
		expect(code(validateConfigPatch({ veto_threshold: 6 }))).toBe('invalid_input');

		world = createTestWorld({ memberNames: ['Ana'] });
		world.db
			.update(groups)
			.set({ config: { ...DEFAULT_GROUP_CONFIG, veto_threshold: 12 } })
			.where(eq(groups.id, world.group.id))
			.run();
		const stored = withConfigDefaults(world.reloadGroup().config);
		expect(stored.veto_threshold).toBe(12);
		expect(toTallyConfig(stored).vetoThreshold).toBe(12);

		unwrap(updateSettings(world.db, { groupId: world.group.id, config: { veto_threshold: 5 } }));
		expect(withConfigDefaults(world.reloadGroup().config).veto_threshold).toBe(5);
	});

	test('rewatch_cooldown is the only nullable knob ("off")', () => {
		expect(unwrap(validateConfigPatch({ rewatch_cooldown: null }))).toEqual({ rewatch_cooldown: null });
		expect(code(validateConfigPatch({ n_finalists: null }))).toBe('invalid_input');
	});

	/**
	 * Groups created before the eligibility floor was removed still have
	 * `min_attendee_votes` in their stored blob. Reading must ignore it (never
	 * crash, never honour it), and the next write must forget it.
	 */
	test('a leftover config key from an older schema is ignored, then dropped on save', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		world.db
			.update(groups)
			.set({ config: { ...DEFAULT_GROUP_CONFIG, min_attendee_votes: 3 } as GroupConfig })
			.where(eq(groups.id, world.group.id))
			.run();

		const onRead = withConfigDefaults(world.reloadGroup().config);
		expect('min_attendee_votes' in onRead).toBe(false);
		expect(onRead).toEqual(DEFAULT_GROUP_CONFIG);
		// The retired key must not be able to reach the tally either.
		expect('minAttendeeVotes' in toTallyConfig(onRead)).toBe(false);

		unwrap(updateSettings(world.db, { groupId: world.group.id, config: { veto_threshold: 2 } }));
		expect(Object.keys(world.reloadGroup().config).sort()).toEqual([
			'approval_floor',
			'coverage_floor',
			'n_finalists',
			'rewatch_cooldown',
			'veto_threshold',
			'vetoes_enabled'
		]);
	});

	test('a partial patch leaves the other knobs alone', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		unwrap(updateSettings(world.db, { groupId: world.group.id, config: { veto_threshold: 3 } }));
		const config = withConfigDefaults(world.reloadGroup().config);
		expect(config.veto_threshold).toBe(3);
		expect(config.n_finalists).toBe(5);
		expect(config.approval_floor).toBe(0.5);
	});

	test('the group name can be renamed, blank is rejected', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		unwrap(updateSettings(world.db, { groupId: world.group.id, name: '  Thursday Films  ' }));
		expect(world.reloadGroup().name).toBe('Thursday Films');
		expect(code(updateSettings(world.db, { groupId: world.group.id, name: '   ' }))).toBe('invalid_input');
	});

	test('an empty update is rejected rather than silently doing nothing', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		expect(code(updateSettings(world.db, { groupId: world.group.id }))).toBe('invalid_input');
	});

	test('members can rename themselves, but not onto a taken name', () => {
		world = createTestWorld({ memberNames: ['Ana', 'Ben'] });
		const renamed = unwrap(
			renameMember(world.db, {
				groupId: world.group.id,
				memberId: world.member('Ana').id,
				name: 'Ana B'
			})
		);
		expect(renamed.displayName).toBe('Ana B');
		expect(
			code(
				renameMember(world.db, {
					groupId: world.group.id,
					memberId: world.member('Ana').id,
					name: 'Ben'
				})
			)
		).toBe('name_taken');
	});

	test('regenerating the invite token produces a fresh 192-bit slug', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const before = world.group.inviteToken;
		const after = unwrap(regenerateInviteToken(world.db, world.group.id)).inviteToken;
		expect(after).not.toBe(before);
		expect(after).toMatch(/^[A-Za-z0-9_-]{32}$/);
	});
});

/* ------------------------------------------------------------------ */
/* Regressions from the adversarial review                            */
/* ------------------------------------------------------------------ */

describe('regression: TMDB credential format detection', () => {
	test('a v3 API key (32 hex) travels as the api_key query parameter', async () => {
		// Verified against the live API: a v3 key sent as `Authorization: Bearer`
		// returns 401, and as `?api_key=` returns 200.
		const V3 = 'a'.repeat(32);
		let seenUrl = '';
		let seenAuth: string | null = 'unset';
		const tmdb = new TmdbClient({
			apiKey: V3,
			fetchImpl: async (input, init) => {
				seenUrl = String(input);
				seenAuth = new Headers(init?.headers).get('authorization');
				return Response.json({ results: [] });
			}
		});
		expect(tmdb.authStyle).toBe('v3-query');
		await tmdb.search('alien');
		expect(new URL(seenUrl).searchParams.get('api_key')).toBe(V3);
		expect(seenAuth).toBeNull();
	});

	test('a v4 read token (JWT) travels as an Authorization: Bearer header', async () => {
		const V4 = 'eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.c2lnbmF0dXJl';
		let seenUrl = '';
		let seenAuth: string | null = 'unset';
		const tmdb = new TmdbClient({
			apiKey: V4,
			fetchImpl: async (input, init) => {
				seenUrl = String(input);
				seenAuth = new Headers(init?.headers).get('authorization');
				return Response.json({ results: [] });
			}
		});
		expect(tmdb.authStyle).toBe('v4-bearer');
		await tmdb.search('alien');
		expect(seenAuth).toBe(`Bearer ${V4}`);
		expect(new URL(seenUrl).searchParams.get('api_key')).toBeNull();
	});

	test('both styles are also applied to the detail endpoint', async () => {
		const seen: string[] = [];
		const make = (key: string) =>
			new TmdbClient({
				apiKey: key,
				fetchImpl: async (input, init) => {
					seen.push(`${new Headers(init?.headers).get('authorization') ?? '-'} ${String(input)}`);
					return Response.json({ id: 1, title: 'X', runtime: 100, release_date: '2000-01-01' });
				}
			});
		await make('b'.repeat(32)).detail(1);
		await make('eyJa.eyJb.sig').detail(1);
		expect(seen[0]).toContain('api_key=bbbb');
		expect(seen[0].startsWith('- ')).toBe(true);
		expect(seen[1]).toContain('Bearer eyJa.eyJb.sig');
		expect(seen[1]).not.toContain('api_key=');
	});

	test('detectAuthStyle falls back to the v3 query parameter for unknown shapes', () => {
		expect(detectAuthStyle('short')).toBe('v3-query');
		expect(detectAuthStyle('')).toBe('v3-query');
	});
});

describe('regression: upstream TMDB status is not echoed to clients', () => {
	test('a 401 from TMDB becomes a generic "unavailable" message', async () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		const result = await suggestMovie({
			db: world.db,
			groupId: world.group.id,
			config: world.config,
			actorId: world.member('Ana').id,
			tmdbId: 550,
			tmdb: fakeTmdb(CATALOGUE, { failWith: 401 })
		});
		expect(code(result)).toBe('tmdb_unavailable');
		if (result.ok) throw new Error('unreachable');
		expect(result.message).toBe('Movie lookup is unavailable right now');
		expect(result.message).not.toContain('401');
	});
});

describe('regression: suggesting is rate limited', () => {
	test('it has its own bucket, because each call spends a TMDB request', () => {
		suggestLimiter.reset();
		let allowed = 0;
		for (let i = 0; i < 30; i++) if (suggestLimiter.check('203.0.113.99').allowed) allowed++;
		expect(allowed).toBe(20);
		// Independent of the search bucket.
		tmdbSearchLimiter.reset();
		expect(tmdbSearchLimiter.check('203.0.113.99').allowed).toBe(true);
		suggestLimiter.reset();
		tmdbSearchLimiter.reset();
	});
});

describe('regression: config validation ignores the prototype chain', () => {
	test('a prototype key is rejected rather than validated', () => {
		// `key in KNOB_RANGES` walked the prototype chain, so `{"toString": 7}`
		// validated and was written into the stored config blob.
		for (const key of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
			expect(code(validateConfigPatch({ [key]: 7 }))).toBe('invalid_input');
		}
	});

	test('a prototype key cannot reach the stored config', () => {
		world = createTestWorld({ memberNames: ['Ana'] });
		expect(
			code(updateSettings(world.db, { groupId: world.group.id, config: { toString: 7 } }))
		).toBe('invalid_input');
		expect(Object.keys(withConfigDefaults(world.reloadGroup().config)).sort()).toEqual([
			'approval_floor',
			'coverage_floor',
			'n_finalists',
			'rewatch_cooldown',
			'veto_threshold',
			'vetoes_enabled'
		]);
	});
});
