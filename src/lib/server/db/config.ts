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
	/** MIN_ATTENDEE_VOTES — the eligibility minimum, exposed because a 3-person
	 *  group can never satisfy a hard-coded 3 while anyone abstains. */
	min_attendee_votes: number;
}

export const DEFAULT_GROUP_CONFIG: GroupConfig = {
	n_finalists: 5,
	approval_floor: 0.5,
	coverage_floor: 0.6,
	veto_threshold: 1,
	rewatch_cooldown: null,
	min_attendee_votes: 3
};

/**
 * Maps the stored group config onto the pure tally module's input shape.
 * `rewatch_cooldown` is not a tally input — it governs re-suggestion, which
 * happens long before any tally runs.
 */
export function toTallyConfig(config: GroupConfig): TallyConfig {
	return {
		nFinalists: config.n_finalists,
		approvalFloor: config.approval_floor,
		coverageFloor: config.coverage_floor,
		vetoThreshold: config.veto_threshold,
		minAttendeeVotes: config.min_attendee_votes
	};
}

/** Fills in any knob missing from a stored row (forward/backward compatibility). */
export function withConfigDefaults(config: Partial<GroupConfig> | null | undefined): GroupConfig {
	return { ...DEFAULT_GROUP_CONFIG, ...(config ?? {}) };
}
