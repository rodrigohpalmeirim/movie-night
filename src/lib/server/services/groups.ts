/**
 * Groups, identity, and settings.
 *
 * Trust-based throughout (app-spec design principle 1): any member can edit any
 * setting, rename themselves, or regenerate the invite link. The app prevents
 * accidents, not malice.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import {
	DEFAULT_GROUP_CONFIG,
	fairness,
	groups,
	members,
	newId,
	newInviteToken,
	withConfigDefaults,
	type Db,
	type Group,
	type GroupConfig,
	type Member
} from '../db/index.js';
import { notifyGroup } from '../events.js';
import { fail, ok, type Result } from '../result.js';

const MAX_NAME_LENGTH = 80;

function cleanName(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const trimmed = raw.trim().replace(/\s+/g, ' ');
	if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) return null;
	return trimmed;
}

/* ------------------------------------------------------------------ */
/* Creation                                                            */
/* ------------------------------------------------------------------ */

export interface CreatedGroup {
	group: Group;
	member: Member;
}

/**
 * Landing page: "Anyone visits the landing page, enters a group name, and gets a
 * group. Creation generates an invite token — a long random slug (>=128 bits,
 * URL-safe)." The creator becomes the first member and is cookied immediately, so
 * they never see the picker on their own device.
 */
export function createGroup(
	db: Db,
	input: { name: unknown; memberName: unknown; now?: Date }
): Result<CreatedGroup> {
	const name = cleanName(input.name);
	if (name === null) return fail('invalid_input', 'A group name of 1-80 characters is required');
	const memberName = cleanName(input.memberName);
	if (memberName === null) return fail('invalid_input', 'Your display name is required');

	const now = input.now ?? new Date();
	const groupId = newId();

	return db.transaction((tx) => {
		const group = tx
			.insert(groups)
			.values({
				id: groupId,
				name,
				inviteToken: newInviteToken(),
				createdAt: now,
				config: { ...DEFAULT_GROUP_CONFIG }
			})
			.returning()
			.get();
		const member = insertMember(tx as unknown as Db, { groupId, displayName: memberName, now });
		notifyGroup(groupId);
		return ok({ group, member });
	});
}

/**
 * Case-insensitive name lookup.
 *
 * Uniqueness must fold case, or "ana" quietly becomes a second member alongside
 * "Ana" — one typo, one extra ballot, and two entries in every attendee list.
 * Display casing is preserved as typed; only the comparison folds. `lower()` is
 * the same ASCII fold the unique index uses, so the two can never disagree.
 */
function findByFoldedName(db: Db, groupId: string, displayName: string): Member | undefined {
	return db
		.select()
		.from(members)
		.where(and(eq(members.groupId, groupId), sql`lower(${members.displayName}) = lower(${displayName})`))
		.get();
}

/** Members always get a fairness row, so rotation fairness has a join date. */
function insertMember(db: Db, input: { groupId: string; displayName: string; now: Date }): Member {
	const member = db
		.insert(members)
		.values({ id: newId(), groupId: input.groupId, displayName: input.displayName, createdAt: input.now })
		.returning()
		.get();
	db.insert(fairness)
		.values({ memberId: member.id, lastWinRoundId: null, lastWinAt: null, winsCount: 0 })
		.onConflictDoNothing()
		.run();
	return member;
}

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export function listMembers(db: Db, groupId: string): Member[] {
	return db
		.select()
		.from(members)
		.where(eq(members.groupId, groupId))
		.orderBy(asc(members.createdAt), asc(members.id))
		.all();
}

/**
 * Member picker: "A list of existing member names — tap yours to claim it" or
 * "I'm new here — type a display name (unique within the group)".
 *
 * Accepted risk, stated in the spec: a friend can pick someone else's name.
 * There is deliberately no check beyond existence.
 */
export function claimMember(
	db: Db,
	input: { groupId: string; memberId?: unknown; name?: unknown; now?: Date }
): Result<Member> {
	const now = input.now ?? new Date();

	if (typeof input.memberId === 'string' && input.memberId.length > 0) {
		const existing = db
			.select()
			.from(members)
			.where(and(eq(members.groupId, input.groupId), eq(members.id, input.memberId)))
			.get();
		if (!existing) return fail('unknown_member', 'That member is not in this group');
		return ok(existing);
	}

	const displayName = cleanName(input.name);
	if (displayName === null) return fail('invalid_input', 'A display name of 1-80 characters is required');

	// The DB's unique (group_id, lower(display_name)) is the real guard; this read
	// is only here to turn the constraint error into a useful message.
	const taken = findByFoldedName(db, input.groupId, displayName);
	if (taken) return fail('name_taken', `"${taken.displayName}" is already taken in this group`);

	try {
		const member = insertMember(db, { groupId: input.groupId, displayName, now });
		notifyGroup(input.groupId);
		return ok(member);
	} catch {
		return fail('name_taken', `"${displayName}" is already taken in this group`);
	}
}

/** Settings: "Member list (rename self; members are never deleted)". */
export function renameMember(
	db: Db,
	input: { groupId: string; memberId: string; name: unknown }
): Result<Member> {
	const displayName = cleanName(input.name);
	if (displayName === null) return fail('invalid_input', 'A display name of 1-80 characters is required');
	const clash = findByFoldedName(db, input.groupId, displayName);
	if (clash && clash.id !== input.memberId) {
		return fail('name_taken', `"${clash.displayName}" is already taken in this group`);
	}
	try {
		const updated = db
			.update(members)
			.set({ displayName })
			.where(and(eq(members.groupId, input.groupId), eq(members.id, input.memberId)))
			.returning()
			.get();
		if (!updated) return fail('unknown_member', 'That member is not in this group');
		notifyGroup(input.groupId);
		return ok(updated);
	} catch {
		return fail('name_taken', `"${displayName}" is already taken in this group`);
	}
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

interface KnobSpec {
	min: number;
	max: number;
	integer: boolean;
	nullable?: boolean;
}

/**
 * Validated ranges for the six knobs.
 *
 * `n_finalists` is capped at 5 because the spec makes it load-bearing: "Keep
 * `N_FINALISTS` at or below 5 so this stays true" — i.e. so a full round robin
 * stays at 10 pairs and every voter finishes it. Its floor is 2, because one
 * finalist is not a runoff.
 */
export const KNOB_RANGES: Record<keyof GroupConfig, KnobSpec> = {
	n_finalists: { min: 2, max: 5, integer: true },
	approval_floor: { min: 0, max: 1, integer: false },
	coverage_floor: { min: 0, max: 1, integer: false },
	veto_threshold: { min: 1, max: 50, integer: true },
	rewatch_cooldown: { min: 0, max: 3650, integer: true, nullable: true },
	min_attendee_votes: { min: 1, max: 50, integer: true }
};

export function validateConfigPatch(patch: Record<string, unknown>): Result<Partial<GroupConfig>> {
	const out: Partial<GroupConfig> = {};
	for (const [key, raw] of Object.entries(patch)) {
		// `Object.hasOwn`, not `key in`: `in` walks the prototype chain, so a body of
		// `{"toString": 7}` used to validate and be written into the config blob.
		if (!Object.hasOwn(KNOB_RANGES, key)) return fail('invalid_input', `Unknown setting "${key}"`);
		const spec = KNOB_RANGES[key as keyof GroupConfig];

		if (raw === null || raw === '' || raw === undefined) {
			if (!spec.nullable) return fail('invalid_input', `"${key}" cannot be empty`);
			out[key as 'rewatch_cooldown'] = null;
			continue;
		}
		const value = typeof raw === 'string' ? Number(raw) : raw;
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			return fail('invalid_input', `"${key}" must be a number`);
		}
		if (spec.integer && !Number.isInteger(value)) {
			return fail('invalid_input', `"${key}" must be a whole number`);
		}
		if (value < spec.min || value > spec.max) {
			return fail('invalid_input', `"${key}" must be between ${spec.min} and ${spec.max}`);
		}
		(out as Record<string, number>)[key] = value;
	}
	return ok(out);
}

/**
 * app-spec: "Knob changes take effect at the next finalist computation; they never
 * retro-affect a round already in RUNOFF or later." That guarantee is delivered
 * by `rounds.config_snapshot`, frozen at OPEN → RUNOFF, not by blocking edits
 * here — the group can still fix a typo mid-round.
 */
export function updateSettings(
	db: Db,
	input: { groupId: string; name?: unknown; config?: Record<string, unknown> }
): Result<Group> {
	const patch: { name?: string; config?: GroupConfig } = {};

	if (input.name !== undefined) {
		const name = cleanName(input.name);
		if (name === null) return fail('invalid_input', 'A group name of 1-80 characters is required');
		patch.name = name;
	}

	if (input.config !== undefined) {
		const validated = validateConfigPatch(input.config);
		if (!validated.ok) return validated;
		const current = db.select().from(groups).where(eq(groups.id, input.groupId)).get();
		if (!current) return fail('unknown_group', 'Group not found');
		patch.config = { ...withConfigDefaults(current.config), ...validated.value };
	}

	if (Object.keys(patch).length === 0) return fail('invalid_input', 'Nothing to update');

	const updated = db.update(groups).set(patch).where(eq(groups.id, input.groupId)).returning().get();
	if (!updated) return fail('unknown_group', 'Group not found');
	notifyGroup(input.groupId);
	return ok(updated);
}

/**
 * The safety valve for the accepted risks: "issues a new token and kills the old
 * URL. Existing device sessions survive regeneration; only the link changes" —
 * which holds because the member cookie is keyed by group id.
 */
export function regenerateInviteToken(db: Db, groupId: string): Result<Group> {
	const updated = db
		.update(groups)
		.set({ inviteToken: newInviteToken() })
		.where(eq(groups.id, groupId))
		.returning()
		.get();
	if (!updated) return fail('unknown_group', 'Group not found');
	notifyGroup(groupId);
	return ok(updated);
}
