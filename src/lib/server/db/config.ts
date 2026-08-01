/**
 * The per-group voting knobs, stored as one JSON column on `groups`
 * (app-spec data model). Snake-case keys are deliberate: this is the wire/DB
 * shape and it mirrors the knob names used in both specs.
 */

// Relative (not `$lib`) so drizzle-kit can bundle this file without the
// SvelteKit alias resolver.
import type { TallyConfig } from '../../tally/types.js';

export interface GroupConfig {
	/** N_FINALISTS — keep at or below 5 so a full round robin stays ≤10 pairs. */
	n_finalists: number;
	/** APPROVAL_FLOOR */
	approval_floor: number;
	/** COVERAGE_FLOOR */
	coverage_floor: number;
	/** VETO_THRESHOLD */
	veto_threshold: number;
	/** REWATCH_COOLDOWN in days; `null` = off (a watched movie never returns). */
	rewatch_cooldown: number | null;
}

export const DEFAULT_GROUP_CONFIG: GroupConfig = {
	n_finalists: 5,
	approval_floor: 0.5,
	coverage_floor: 0.6,
	veto_threshold: 1,
	rewatch_cooldown: null
};

/**
 * Maps the stored group config onto the pure tally module's input shape.
 * `rewatch_cooldown` is not a tally input — it governs re-suggestion, which
 * happens long before any tally runs.
 *
 * A `config` blob read from an older row may still contain `min_attendee_votes`;
 * it is not copied here, so nothing downstream can honour it.
 */
export function toTallyConfig(config: GroupConfig): TallyConfig {
	return {
		nFinalists: config.n_finalists,
		approvalFloor: config.approval_floor,
		coverageFloor: config.coverage_floor,
		vetoThreshold: config.veto_threshold
	};
}

/**
 * Fills in any knob missing from a stored row and drops any key that is not a
 * knob (forward/backward compatibility).
 *
 * The projection is deliberate rather than a spread. Groups created before the
 * `min_attendee_votes` eligibility floor was removed still carry that key in
 * their `config` blob, and old rounds carry it in `config_snapshot`; reading such
 * a row must neither crash nor honour the leftover. Projecting onto the current
 * knobs ignores it on read and forgets it on the next write — `updateSettings`
 * rebuilds the blob from this function's output, so the first settings save after
 * the upgrade cleans the row. Stored snapshots of past rounds keep the key
 * forever, which is correct: they are a record of what the round was told.
 */
export function withConfigDefaults(config: Partial<GroupConfig> | null | undefined): GroupConfig {
	const stored = config ?? {};
	return {
		n_finalists: stored.n_finalists ?? DEFAULT_GROUP_CONFIG.n_finalists,
		approval_floor: stored.approval_floor ?? DEFAULT_GROUP_CONFIG.approval_floor,
		coverage_floor: stored.coverage_floor ?? DEFAULT_GROUP_CONFIG.coverage_floor,
		veto_threshold: stored.veto_threshold ?? DEFAULT_GROUP_CONFIG.veto_threshold,
		// The only nullable knob: `null` means "off" and must survive the merge.
		rewatch_cooldown:
			stored.rewatch_cooldown === undefined
				? DEFAULT_GROUP_CONFIG.rewatch_cooldown
				: stored.rewatch_cooldown
	};
}
