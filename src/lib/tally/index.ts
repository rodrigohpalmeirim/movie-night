/**
 * Pure tally module — the voting mechanism from docs/voting-spec.md.
 *
 * Public surface. Nothing in here touches the database, SvelteKit, or the
 * clock: every function is a deterministic transform of plain data, seeded from
 * the round's stored `random_seed` where randomness is required.
 */

export type {
	BoundaryTiebreakRule,
	CondorcetResult,
	CycleTiebreakRule,
	FairnessInput,
	HeadToHead,
	IneligibleReason,
	Matchup,
	MemberId,
	MovieId,
	MovieInput,
	MovieStatus,
	MovieTally,
	PairVoteInput,
	Phase1Input,
	Phase1Outcome,
	Phase1Result,
	RoundId,
	RunoffInput,
	RunoffResult,
	SharedTiebreakRule,
	StandingVoteInput,
	StandingVoteValue,
	TallyConfig,
	TiebreakOutcome,
	VetoInput,
	VetoResult
} from './types.js';

export { DEFAULT_TALLY_CONFIG } from './types.js';

export {
	attendeeSet,
	computeMovieTally,
	computePhase1,
	computeTallies,
	fairnessMap,
	indexStandingVotes,
	meetsRatio
} from './phase1.js';
export type { IndexedVote } from './phase1.js';

export {
	computeCondorcet,
	computeCopeland,
	computeHeadToHead,
	findCondorcetWinner,
	generateMatchups,
	matchupCount,
	normalizePair,
	pairKey
} from './pairwise.js';

export { computeRunoff, computeVeto } from './runoff.js';

export {
	BOUNDARY_CHAIN,
	CYCLE_CHAIN,
	buildRankRow,
	comparator,
	decide,
	describeDecision,
	rank,
	rotationFairnessKey,
	runtimeKey
} from './tiebreak.js';
export type { RankRow } from './tiebreak.js';

export { fnv1a32, memberSeed, mulberry32, seededKey, seededShuffle } from './prng.js';
