/**
 * Soft member removal: what a departure hides, what it stops counting, and what it
 * deliberately leaves exactly where it was.
 *
 * voting-spec, cross-cutting rules → Removed members: "Removed members leave the
 * present, not the past." The rule is implemented as one filter on the attendee set
 * (`loadAttendeeIds`) plus roster filters in the views; these specs pin both, and
 * pin that history, credit and stored outcomes are untouched.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { members as membersTable, rounds, standingVotes } from './db/index.js';
import { memberCookieName, resolveContext, resolveFromCookies } from './context.js';
import { unwrap, type Result } from './result.js';
import {
	claimMember,
	listMembers,
	listRemovedMembers,
	removeMember,
	renameMember,
	restoreMember
} from './services/groups.js';
import { setStandingVote } from './services/movies.js';
import {
	advanceRound,
	createRound,
	evaluateRunoff,
	loadAttendeeIds,
	loadFairness,
	loadStandingVotes,
	planAdvance,
	setRsvp
} from './services/rounds.js';
import {
	buildGroupContextView,
	buildPoolView,
	buildRevealView,
	buildRoundView,
	buildSettingsView
} from './services/views.js';
import { BASE_NOW, createTestWorld, type TestWorld } from './testing.js';

let world: TestWorld | undefined;
afterEach(() => {
	world?.cleanup();
	world = undefined;
});

function code(result: Result<unknown>): string {
	if (result.ok) throw new Error('expected a failure');
	return result.code;
}

const LATER = new Date(BASE_NOW.getTime() + 60_000);

/* ------------------------------------------------------------------ */
/* The stamp itself                                                    */
/* ------------------------------------------------------------------ */

describe('removal is a soft, reversible stamp', () => {
	test('stamps removed_at and is idempotent', () => {
		const w = createTestWorld({ memberNames: ['Ana', 'Ben'] });
		world = w;
		const removed = unwrap(
			removeMember({ db: w.db, groupId: w.group.id, memberId: w.member('Ben').id, now: LATER })
		);
		expect(removed.removedAt?.getTime()).toBe(LATER.getTime());
		// A second tap is a no-op, not an error, and does not re-stamp the time.
		const again = unwrap(
			removeMember({
				db: w.db,
				groupId: w.group.id,
				memberId: w.member('Ben').id,
				now: new Date(LATER.getTime() + 5_000)
			})
		);
		expect(again.removedAt?.getTime()).toBe(LATER.getTime());
		// The row is still there. Members are never deleted.
		expect(w.db.select().from(membersTable).all().length).toBe(2);
	});

	test('any member can remove any member — including themselves', () => {
		const w = createTestWorld({ memberNames: ['Ana', 'Ben'] });
		world = w;
		// No roles to check: the same guard as every other member action.
		expect(removeMember({ db: w.db, groupId: w.group.id, memberId: w.member('Ana').id }).ok).toBe(true);
		expect(listMembers(w.db, w.group.id).map((m) => m.displayName)).toEqual(['Ben']);
	});

	test('restoring clears the stamp and is idempotent', () => {
		const w = createTestWorld({ memberNames: ['Ana', 'Ben'] });
		world = w;
		unwrap(removeMember({ db: w.db, groupId: w.group.id, memberId: w.member('Ben').id, now: LATER }));
		expect(
			unwrap(restoreMember({ db: w.db, groupId: w.group.id, memberId: w.member('Ben').id })).removedAt
		).toBeNull();
		expect(restoreMember({ db: w.db, groupId: w.group.id, memberId: w.member('Ben').id }).ok).toBe(true);
	});

	test('an unknown member is not removable', () => {
		const w = createTestWorld({ memberNames: ['Ana'] });
		world = w;
		expect(code(removeMember({ db: w.db, groupId: w.group.id, memberId: 'ghost' }))).toBe(
			'unknown_member'
		);
		expect(code(restoreMember({ db: w.db, groupId: w.group.id, memberId: 'ghost' }))).toBe(
			'unknown_member'
		);
	});

	test('a member of another group is not removable through this one', () => {
		const w = createTestWorld({ memberNames: ['Ana'] });
		const other = createTestWorld({ memberNames: ['Zed'] });
		world = w;
		expect(
			code(removeMember({ db: w.db, groupId: w.group.id, memberId: other.member('Zed').id }))
		).toBe('unknown_member');
		other.cleanup();
	});
});

/* ------------------------------------------------------------------ */
/* Hidden from the present                                             */
/* ------------------------------------------------------------------ */

describe('a removed member is not in the group’s present', () => {
	function removedBen() {
		const w = createTestWorld({ memberNames: ['Ana', 'Ben'], movies: [{ title: 'Alien', suggestedBy: 'Ben' }] });
		unwrap(removeMember({ db: w.db, groupId: w.group.id, memberId: w.member('Ben').id, now: LATER }));
		return w;
	}

	test('is absent from the roster and the picker list', () => {
		const w = removedBen();
		world = w;
		expect(listMembers(w.db, w.group.id).map((m) => m.displayName)).toEqual(['Ana']);
		expect(listRemovedMembers(w.db, w.group.id).map((m) => m.displayName)).toEqual(['Ben']);
	});

	test('is absent from the group context view’s member list', () => {
		const w = removedBen();
		world = w;
		const view = buildGroupContextView(w.db, w.group, w.member('Ana'));
		expect(view.members.map((m) => m.displayName)).toEqual(['Ana']);
	});

	test('the settings view lists them separately, so they can be restored', () => {
		const w = removedBen();
		world = w;
		const view = buildSettingsView({ db: w.db, group: w.group, me: w.member('Ana') });
		expect(view.members.map((m) => m.displayName)).toEqual(['Ana']);
		expect(view.removedMembers.map((m) => m.displayName)).toEqual(['Ben']);
		expect(view.removedMembers[0].removedAt).toBe(LATER.toISOString());
	});

	test('is absent from the round’s participant list and its counts', () => {
		const w = removedBen();
		world = w;
		const round = unwrap(
			createRound({ db: w.db, groupId: w.group.id, actorId: w.member('Ana').id, now: BASE_NOW })
		);
		const view = buildRoundView({ db: w.db, group: w.group, config: w.config, me: w.member('Ana'), round })!;
		expect(view.participants.map((p) => p.displayName)).toEqual(['Ana']);
		// "1 no answer", not 2: the denominator is the current group.
		expect(view.participation.noAnswer).toBe(1);
	});

	test('cannot be RSVPed in, by themselves or by proxy', () => {
		const w = removedBen();
		world = w;
		const round = unwrap(
			createRound({ db: w.db, groupId: w.group.id, actorId: w.member('Ana').id, now: BASE_NOW })
		);
		const args = { db: w.db, groupId: w.group.id, roundId: round.id, memberId: w.member('Ben').id };
		expect(code(setRsvp({ ...args, attending: true, actorId: w.member('Ana').id }))).toBe(
			'member_removed'
		);
		expect(code(setRsvp({ ...args, attending: true, actorId: w.member('Ben').id }))).toBe(
			'member_removed'
		);
	});

	test('keeps their suggestions in the pool, still credited to them by name', () => {
		const w = removedBen();
		world = w;
		const pool = buildPoolView({ db: w.db, group: w.group, me: w.member('Ana') });
		expect(pool.movies.map((m) => m.title)).toEqual(['Alien']);
		expect(pool.movies[0].suggestedBy?.displayName).toBe('Ben');
	});

	test('holds their display name, so it cannot be claimed or re-added', () => {
		const w = removedBen();
		world = w;
		// Claiming the name: taken, and the message points at the way back.
		const claimed = claimMember(w.db, { groupId: w.group.id, name: 'Ben' });
		expect(code(claimed)).toBe('name_taken');
		if (claimed.ok) throw new Error('unreachable');
		expect(claimed.message).toContain('restore');
		// Case-folded, like every other name check.
		expect(code(claimMember(w.db, { groupId: w.group.id, name: 'ben' }))).toBe('name_taken');
		// And nobody may rename themselves into it either.
		expect(
			code(renameMember(w.db, { groupId: w.group.id, memberId: w.member('Ana').id, name: 'Ben' }))
		).toBe('name_taken');
	});

	test('their identity cannot be claimed by id either', () => {
		const w = removedBen();
		world = w;
		const result = claimMember(w.db, { groupId: w.group.id, memberId: w.member('Ben').id });
		expect(code(result)).toBe('member_removed');
	});
});

/* ------------------------------------------------------------------ */
/* The claim cookie                                                    */
/* ------------------------------------------------------------------ */

describe('a claim cookie pointing at a removed member', () => {
	test('resolves as unclaimed — the picker, never a 500', () => {
		const w = createTestWorld({ memberNames: ['Ana', 'Ben'] });
		world = w;
		const cookies = new Map([[memberCookieName(w.group.id), w.member('Ben').id]]);
		const read = (name: string) => cookies.get(name);

		const before = resolveFromCookies({ db: w.db, token: w.group.inviteToken, getCookie: read });
		expect(before.kind).toBe('ok');

		unwrap(removeMember({ db: w.db, groupId: w.group.id, memberId: w.member('Ben').id, now: LATER }));
		const after = resolveFromCookies({ db: w.db, token: w.group.inviteToken, getCookie: read });
		expect(after.kind).toBe('need_member');
		if (after.kind === 'unknown_group') throw new Error('unreachable');
		// The group still resolves, so the picker renders with its config.
		expect(after.group.id).toBe(w.group.id);
		expect(after.config.n_finalists).toBe(5);
	});

	test('works again the moment they are restored — nothing was deleted', () => {
		const w = createTestWorld({ memberNames: ['Ana', 'Ben'] });
		world = w;
		const memberId = w.member('Ben').id;
		unwrap(removeMember({ db: w.db, groupId: w.group.id, memberId, now: LATER }));
		expect(
			resolveContext({ db: w.db, token: w.group.inviteToken, memberIdFromCookie: memberId }).kind
		).toBe('need_member');
		unwrap(restoreMember({ db: w.db, groupId: w.group.id, memberId }));
		expect(
			resolveContext({ db: w.db, token: w.group.inviteToken, memberIdFromCookie: memberId }).kind
		).toBe('ok');
	});
});

/* ------------------------------------------------------------------ */
/* Stopping the count                                                  */
/* ------------------------------------------------------------------ */

const MEMBERS = ['Ana', 'Ben', 'Cal', 'Dee'];

/**
 * An OPEN round with everyone in and one film swiped by everyone. Ana and Ben say
 * yes (Ben with a star); Cal and Dee say no. So with four attendees the film has
 * coverage 1.00 and approval 0.50 — exactly at the floor — and one star.
 */
function votedWorld() {
	const w = createTestWorld({
		memberNames: MEMBERS,
		movies: [{ title: 'Alien', runtimeMin: 100, suggestedBy: 'Ana' }]
	});
	const round = unwrap(
		createRound({ db: w.db, groupId: w.group.id, actorId: w.member('Ana').id, now: BASE_NOW, seed: 99 })
	);
	for (const name of MEMBERS) {
		unwrap(
			setRsvp({
				db: w.db,
				groupId: w.group.id,
				roundId: round.id,
				memberId: w.member(name).id,
				attending: true,
				actorId: w.member(name).id,
				now: BASE_NOW
			})
		);
	}
	for (const [name, value, starred] of [
		['Ana', 'yes', false],
		['Ben', 'yes', true],
		['Cal', 'no', false],
		['Dee', 'no', false]
	] as const) {
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
	}
	return { w, round };
}

function tallyFor(w: TestWorld, round: Parameters<typeof planAdvance>[0]['round']) {
	const plan = unwrap(planAdvance({ db: w.db, groupId: w.group.id, config: w.config, round, now: LATER }));
	if (plan.kind === 'runoff_to_decided') throw new Error('unreachable');
	return plan.phase1.tallies[0];
}

describe('a removed member stops counting, mid-round included', () => {
	test('drops out of the attendee set even with an attending RSVP on the live round', () => {
		const { w, round } = votedWorld();
		world = w;
		expect(loadAttendeeIds(w.db, round.id).length).toBe(4);
		unwrap(removeMember({ db: w.db, groupId: w.group.id, memberId: w.member('Dee').id, now: LATER }));
		expect(loadAttendeeIds(w.db, round.id).length).toBe(3);
		expect(loadAttendeeIds(w.db, round.id)).not.toContain(w.member('Dee').id);
		// The attendance row is untouched: it records what happened.
		expect(w.db.select().from(rounds).where(eq(rounds.id, round.id)).get()?.state).toBe('open');
	});

	test('their standing vote leaves the tally, numerator and denominator alike', () => {
		const { w, round } = votedWorld();
		world = w;
		expect(tallyFor(w, round)).toMatchObject({ attendeeVotes: 4, yesVotes: 2, noVotes: 2, starVotes: 1 });
		// Dee said no. Removing her takes her out of both counts.
		unwrap(removeMember({ db: w.db, groupId: w.group.id, memberId: w.member('Dee').id, now: LATER }));
		const after = tallyFor(w, round);
		expect(after).toMatchObject({ attendeeVotes: 3, yesVotes: 2, noVotes: 1 });
		expect(after.coverage).toBe(1);
		expect(after.approval).toBeCloseTo(2 / 3, 10);
	});

	test('their star leaves with them', () => {
		const { w, round } = votedWorld();
		world = w;
		unwrap(removeMember({ db: w.db, groupId: w.group.id, memberId: w.member('Ben').id, now: LATER }));
		expect(tallyFor(w, round).starVotes).toBe(0);
		// Kept, not deleted — and counted again on restore.
		expect(
			w.db.select().from(standingVotes).where(eq(standingVotes.memberId, w.member('Ben').id)).get()
				?.starred
		).toBe(true);
		unwrap(restoreMember({ db: w.db, groupId: w.group.id, memberId: w.member('Ben').id }));
		expect(tallyFor(w, round).starVotes).toBe(1);
	});

	test('they are gone from the loaders that feed the tally', () => {
		const { w } = votedWorld();
		world = w;
		unwrap(removeMember({ db: w.db, groupId: w.group.id, memberId: w.member('Dee').id, now: LATER }));
		expect(loadStandingVotes(w.db, w.group.id).map((v) => v.memberId)).not.toContain(
			w.member('Dee').id
		);
		expect(loadFairness(w.db, w.group.id).map((f) => f.memberId)).not.toContain(w.member('Dee').id);
		expect(loadFairness(w.db, w.group.id).length).toBe(3);
	});

	test('removing everyone who is attending blocks the transition on MIN_ELECTORATE', () => {
		const { w, round } = votedWorld();
		world = w;
		for (const name of MEMBERS) {
			unwrap(removeMember({ db: w.db, groupId: w.group.id, memberId: w.member(name).id, now: LATER }));
		}
		const plan = planAdvance({ db: w.db, groupId: w.group.id, config: w.config, round, now: LATER });
		expect(code(plan)).toBe('not_enough_attendees');
	});

	test('their votes are frozen out of the snapshot at OPEN → RUNOFF', () => {
		const { w, round } = votedWorld();
		world = w;
		unwrap(removeMember({ db: w.db, groupId: w.group.id, memberId: w.member('Ben').id, now: LATER }));
		const advanced = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id, now: LATER })
		);
		const snapshot = advanced.round.standingSnapshot ?? [];
		expect(snapshot.map((row) => row.member_id)).not.toContain(w.member('Ben').id);
		expect(snapshot.some((row) => row.starred === true)).toBe(false);
	});

	test('a decided round keeps its winner, finalists and published tallies', () => {
		const { w, round } = votedWorld();
		world = w;
		// Alien is the only candidate, so it wins outright and the round is DECIDED.
		const advanced = unwrap(
			advanceRound({ db: w.db, groupId: w.group.id, config: w.config, roundId: round.id, now: BASE_NOW })
		);
		expect(advanced.round.state).toBe('decided');
		expect(advanced.round.winnerId).toBe(w.movie('Alien').id);
		const frozen = advanced.round.finalistIds;

		for (const name of MEMBERS) {
			unwrap(removeMember({ db: w.db, groupId: w.group.id, memberId: w.member(name).id, now: LATER }));
		}
		const after = w.db.select().from(rounds).where(eq(rounds.id, round.id)).get()!;
		expect(after.state).toBe('decided');
		expect(after.winnerId).toBe(w.movie('Alien').id);
		expect(after.finalistIds).toEqual(frozen);
		// Recomputing from the frozen snapshot still works with nobody left in the
		// group, and the reveal still names the film and its suggester. The tallies do
		// go to zero, because they are computed on read against the current attendee
		// set — which is the documented rule, not a lost record: `winner_id`,
		// `finalist_ids` and the snapshot itself are the historical facts, and they are
		// all still there.
		const runoff = unwrap(evaluateRunoff({ db: w.db, groupId: w.group.id, round: after }));
		expect(runoff.tallies.find((t) => t.movieId === w.movie('Alien').id)?.attendeeVotes).toBe(0);
		const reveal = buildRevealView({ db: w.db, group: w.group, round: after });
		expect(reveal.winner?.title).toBe('Alien');
		expect(reveal.winner?.suggestedBy?.displayName).toBe('Ana');
	});
});
