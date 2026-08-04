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
	/**
	 * VETOES_ENABLED — whether the runoff has a veto step at all.
	 *
	 * `true` by default, and additive: a blob written before this knob existed has
	 * no key, reads as `true`, and so every group that already had a veto keeps it.
	 * Turning it off removes the step outright — no veto screen, no veto rows, and
	 * an empty veto set handed to Phase 2 (voting-spec, Phase 2 → Veto).
	 *
	 * Like every other knob it is *frozen onto the round* at OPEN → RUNOFF, which
	 * is the single place the mid-round rule lives: a change applies from the next
	 * finalist computation and can neither strand a runoff waiting on vetoes that
	 * can no longer be cast, nor demand one from a runoff already past that step.
	 */
	vetoes_enabled: boolean;
	/** VETO_THRESHOLD — how many vetoes disqualify; moot while vetoes are off. */
	veto_threshold: number;
	/** REWATCH_COOLDOWN in days; `null` = off (a watched movie never returns). */
	rewatch_cooldown: number | null;
}

export const DEFAULT_GROUP_CONFIG: GroupConfig = {
	n_finalists: 5,
	approval_floor: 0.5,
	coverage_floor: 0.6,
	vetoes_enabled: true,
	veto_threshold: 1,
	rewatch_cooldown: null
};

/**
 * Maps the stored group config onto the pure tally module's input shape.
 * `rewatch_cooldown` is not a tally input — it governs re-suggestion, which
 * happens long before any tally runs.
 *
 * `vetoes_enabled` is not one either, deliberately: switching vetoes off is not a
 * new tally rule, it is an empty `vetoes` array (voting-spec: "Phase 2 runs the
 * pairwise step alone against an empty veto set"). The caller decides whether any
 * veto rows are collected; the tally is handed the result and needs no flag to
 * behave, because "nobody vetoed" is a case it has always had to handle.
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
 *
 * It cuts the other way too, which is what makes an additive knob safe: a snapshot
 * taken before `vetoes_enabled` existed has no such key, and reading it fills in the
 * default — so a round frozen back then is a round that was told vetoes are on,
 * which is exactly what it was.
 */
export function withConfigDefaults(config: Partial<GroupConfig> | null | undefined): GroupConfig {
	const stored = config ?? {};
	return {
		n_finalists: stored.n_finalists ?? DEFAULT_GROUP_CONFIG.n_finalists,
		approval_floor: stored.approval_floor ?? DEFAULT_GROUP_CONFIG.approval_floor,
		coverage_floor: stored.coverage_floor ?? DEFAULT_GROUP_CONFIG.coverage_floor,
		// Additive knob: a blob written before it existed has no key and reads as the
		// default (on), so an existing group keeps its veto step. `??` and not `||`,
		// because a stored `false` is an answer and must survive the merge.
		vetoes_enabled: stored.vetoes_enabled ?? DEFAULT_GROUP_CONFIG.vetoes_enabled,
		veto_threshold: stored.veto_threshold ?? DEFAULT_GROUP_CONFIG.veto_threshold,
		// The only nullable knob: `null` means "off" and must survive the merge.
		rewatch_cooldown:
			stored.rewatch_cooldown === undefined
				? DEFAULT_GROUP_CONFIG.rewatch_cooldown
				: stored.rewatch_cooldown
	};
}
