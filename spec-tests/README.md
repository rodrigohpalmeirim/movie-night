# Spec test vectors — Movie Night voting mechanism

Implementation-agnostic test vectors derived **only** from `voting-spec.md`. Every
expected value in `vectors/*.json` was computed by hand from the spec text; the
arithmetic is shown in each vector's `rationale` field.

These vectors describe a **pure function**:

```
decide_round(config, members, attendance, movies, standing_votes, vetoes, pair_votes, random_seed)
    -> round outcome
```

Nothing about storage, HTTP, UI or framework is asserted. An adapter that maps
your data layer onto the input shape below and your round-evaluation code onto
the output shape below is all that is needed to run them.

---

## 0. Spec changes since derivation

The vectors are an audit trail and are not edited to match an implementation.
They *are* re-derived when `voting-spec.md` itself changes. Every such change is
logged here.

**2026-08-01 — the `attendee_votes >= 3` eligibility floor was removed.**
Eligibility is now `status == "pool"` and `coverage >= COVERAGE_FLOOR`, nothing
more. Reason: an absolute floor on the raw vote count locked small groups out —
in a three-person group a single abstention made every movie permanently
ineligible — while `coverage`, being a *share* of the attendees, already keeps
under-seen movies waiting for the next round at any group size. Consequences,
all re-derived from the amended text:

* **V004** (renamed `004-coverage-alone-gates-eligibility`) — the only vector
  whose **outcome** changed. Its movie (coverage 2/3, two votes, approval 1.00)
  was ineligible and the round ended `no_clear_favourite`; it is now eligible
  and wins outright. It is kept, inverted, as the vector that pins the new rule.
* **V005** (renamed `005-fully-swiped-in-a-three-person-group`) — every expected
  value is unchanged; only the `description`, `spec_clause` and `rationale`,
  which quoted the retired floor, were reworded.
* **V008, V039** — the redundant `attendee_votes_below_minimum` entries in
  `ineligible_movies` were dropped. Those movies still fail `coverage`, so no
  expected outcome, tally, finalist set or winner changed.
* The `attendee_votes_below_minimum` value of the `reason` enum is retired. A
  vector that still used it would now fail as an unknown reason rather than pass
  quietly.
* **The other 36 vectors are untouched.** Several `rationale` fields still note
  in passing that `attendee_votes N >= 3` passed; that arithmetic is inert
  (their movies clear coverage regardless) and is left as derived.
* `MIN_ATTENDEE_VOTES` is likewise left in all 40 `input.config` blocks as the
  record of what they were derived against. No runner may read it.

---

## 1. Input shape

```jsonc
"input": {
  "config": {
    "N_FINALISTS": 5,          // spec default 5
    "APPROVAL_FLOOR": 0.5,     // spec default 0.5
    "COVERAGE_FLOOR": 0.6,     // spec default 0.6
    "MIN_ATTENDEE_VOTES": 3,   // RETIRED (see section 0): the eligibility floor this knob
                               //       fed no longer exists. Present for provenance; read by nothing.
    "VETO_THRESHOLD": 1,       // spec default 1
    "REWATCH_COOLDOWN": null   // spec default off; unused by these vectors
  },

  "members": [
    {
      "id": "u1",
      "join_order": 1,               // 1-based order in which members joined the group
      "joined_at": "2026-01-01T00:00:00Z",
      "fairness": {                  // the `Fairness` row for this user
        "last_win_at": null,         // when a movie THIS user suggested was last marked WATCHED.
                                     // null = has never had a winning suggestion.
        "wins_count": 0
      }
    }
  ],

  "attendance": [
    { "user_id": "u1", "attending": true, "runoff_submitted_at": "2026-07-30T20:00:00Z" }
  ],

  "movies": [
    { "id": "m1", "title": "M1", "runtime_min": 100, "suggested_by": "u1",
      "added_at": "2026-07-01T00:00:00Z", "status": "pool", "watched_at": null }
  ],

  "standing_votes": [
    { "user_id": "u1", "movie_id": "m1", "value": "yes" }   // or "no"
  ],

  "vetoes":     [ { "user_id": "u4", "movie_id": "m1" } ],
  "pair_votes": [ { "user_id": "u1", "movie_a_id": "m1", "movie_b_id": "m2", "winner_id": "m1" } ],
  "random_seed": "seed-001"
}
```

### Input semantics (all taken from the spec)

* **Attendee set** = `{ user_id : attending == true }`. A member with no
  `attendance` row is **not** attending. `attendees` (the divisor in `coverage`)
  is the size of that set — never the member count.
* **`runoff_submitted_at`** — `null` means *hasn't opened the app*; a timestamp
  means *done, even if they vetoed nothing* (spec: "Record veto-pass skips
  explicitly"). An **explicit veto pass** is therefore an attendance row with
  `runoff_submitted_at` set and **no** `vetoes` row for that user.
* **`standing_votes` is sparse and is the crux of the whole suite.** Rows are
  explicit `yes`/`no`. **The ABSENCE of a row means "not yet seen" — never
  "no".** An absent row must not appear in `attendee_votes`, must not appear in
  `yes_votes`, and must not depress `approval`. Several vectors are designed so
  that collapsing absence into "no" produces a *different* documented outcome.
* **`pair_votes`**: `winner_id: null` is an **explicit "no preference"** and
  contributes to neither side. A missing row (voter never reached that pair) also
  contributes to neither side. Both must leave the pair tally untouched.
* **`vetoes`**: at most one row per (round, user). A row from a non-attendee is
  invalid and ignored (spec: "each **attendee** may veto one finalist").
* **`fairness.last_win_at`** is the *watched* timestamp of the last movie this
  user suggested that won and was watched (spec: "Update the fairness counter
  for the winner's `suggested_by` when the movie is marked **watched**"). The
  data model stores `last_win_round_id`; a timestamp is used here so vectors are
  comparable without a round table.
* **`random_seed`** is provided so seeded tiebreaks are reproducible. Its
  *interpretation* is implementation-defined — see §3.

---

## 2. Expected-output shape

```jsonc
"expected": {
  "eligible_movie_ids":  ["m1"],                 // sorted by id
  "ineligible_movies":   [ { "movie_id": "m2", "reason": "coverage_below_floor",
                             "coverage": 0.5, "attendee_votes": 3 } ],
  "tallies":             { "m1": { "attendee_votes": 3, "yes_votes": 2,
                                   "coverage": 0.6, "approval": 0.6667 } },

  "finalist_ids":            ["m1", "m2"],       // set, sorted by id
  "finalist_ids_ranked":     ["m1", "m2"],       // yes-votes desc, then the tiebreak chain
  "rank_order_asserted":     true,               // see below
  "finalist_boundary_tiebreak": null,            // or { rule, tied_movie_ids, admitted, excluded }

  "veto_counts":            { "m1": 1 },         // attendee vetoes per finalist
  "veto_disqualified_ids":  ["m1"],              // vetoes >= VETO_THRESHOLD
  "vetoes_ignored_insufficient_finalists": false,
  "surviving_finalist_ids": ["m2", "m3"],

  "pairwise": [ { "a": "m2", "b": "m3", "a_preferred": 3, "b_preferred": 1,
                  "no_preference": 0, "not_voted": 0, "pair_winner": "m2" } ],
  "copeland_scores": { "m2": 1, "m3": 0 },

  "outcome":        "winner",                    // winner | winner_outright | no_clear_favourite
  "phase2_skipped": false,
  "winner_id":      "m2",                        // null when the winner is not uniquely determined
  "permissible_winner_ids": ["m2"],              // always populated; > 1 entry only for seeded random
  "decided_by":     "condorcet",
  "standing_vote_side_effects": [ { "user_id": "u4", "movie_id": "m1", "value": "no",
                                    "was": "yes" } ]
}
```

### Field notes

* **`reason`** enum for `ineligible_movies`:
  `status_not_pool`, `coverage_below_floor`. (`attendee_votes_below_minimum` was
  the third value and is retired — see section 0. Vectors list every failing
  reason they intend to assert, so a movie can still carry more than one.)
* **`decided_by`** enum:
  * `single_clear_approval_floor` — exactly one movie cleared `APPROVAL_FLOOR`,
    so it wins outright and Phase 2 is skipped.
  * `condorcet` — one surviving finalist beat every other finalist.
  * `copeland`, `approval`, `rotation_fairness`, `shortest_runtime`,
    `seeded_random` — the runoff chain, in spec order (1..5).
  * `null` — no winner (`no_clear_favourite`).
* **`rank_order_asserted`** — `true` when the ordering of
  `finalist_ids_ranked` is fully determined by the spec's chain and must match
  exactly. `false` when several finalists tie on yes-votes *and the tie is not
  at the `N_FINALISTS` boundary*, i.e. all of them are promoted anyway. The
  spec only requires deterministic tiebreaking **at the boundary** ("Ties at the
  finalist boundary … must be broken deterministically"), so in those vectors
  only `finalist_ids` (the set) is asserted and `finalist_ids_ranked` is listed
  in ascending-id order for readability.
* **`permissible_winner_ids`** — for cases the spec resolves by
  `seeded_random`, the vector asserts the **rule reached** plus the **set of
  permissible winners**, and sets `winner_id: null`. The PRNG mapping from
  `random_seed` to a choice is implementation-defined, so a specific id must not
  be asserted. The same convention applies to
  `finalist_boundary_tiebreak.permissible_admitted` /
  `permissible_finalist_sets` when randomness decides the finalist boundary.
* **Numbers**: `coverage` and `approval` are decimals rounded to 4 dp. Compare
  with tolerance 1e-4. Floor comparisons themselves must be done on the exact
  fraction (e.g. `2/3 >= 0.5`, `3/5 >= 0.6`), never on a rounded value.
* **Optional fields**: `tallies`, `pairwise`, `copeland_scores`,
  `ineligible_movies`, `veto_counts` and `standing_vote_side_effects` are
  diagnostics. A runner may ignore them; when present they are correct and are
  the cheapest way to localise a failure. `eligible_movie_ids`, `finalist_ids`,
  `veto_disqualified_ids`, `surviving_finalist_ids`, `outcome`, `winner_id` /
  `permissible_winner_ids` and `decided_by` are the load-bearing assertions.
* Vector **V039** additionally carries `pairwise_pairs_required`,
  `veto_taps_max`, `pair_taps_max` and `effort_note` to assert the effort-budget
  invariant.
* **A `null` expected value means "not asserted"** (as opposed to an empty list,
  which asserts emptiness). Only V017 uses this, for `finalist_ids`,
  `finalist_ids_ranked` and `surviving_finalist_ids`, because a seeded-random
  boundary tie makes the finalist set implementation-defined there; the
  permissible sets are given in `finalist_boundary_tiebreak` instead.
* An empty `veto_counts` (`{}`) asserts that no veto tally is computed at all,
  because the round never entered RUNOFF (V040).

---

## 3. The rules these vectors encode (restated verbatim-equivalent)

**Eligibility** — `status == "pool"` and
`coverage = attendee_votes / attendees >= COVERAGE_FLOOR`, where
`attendee_votes` counts attendees holding a standing vote row (yes *or* no) on
that movie. There is no separate floor on the raw count (section 0).
`approval = yes_votes among attendees / attendee_votes` — the divisor is
"voters who saw the card", **never** the attendee count.

**Finalists** — rank eligible movies by `yes_votes` among attendees; promote the
top `N_FINALISTS` that also satisfy `approval >= APPROVAL_FLOOR`. Boundary ties:
higher approval → rotation fairness → shortest runtime → seeded random.
If fewer than two movies clear the floor: exactly one → wins outright, skip
Phase 2; none → `no_clear_favourite`.

**Veto** — an attendee may veto one finalist; `vetoes >= VETO_THRESHOLD`
disqualifies. If vetoes would leave **fewer than two** finalists, ignore them
for ranking (but still report them). Vetoing sets the voter's standing vote on
that movie to `no`.

**Runoff** — full round robin over surviving finalists. For each pair, count
attendees preferring A to B; A beats B iff strictly more attendees prefer A.
A finalist that beats every other is the Condorcet winner. Otherwise:
1. Copeland score (most pairwise victories),
2. approval,
3. rotation fairness,
4. shortest runtime,
5. seeded random.

**Rotation fairness** — the finalist suggested by whichever *attendee* has gone
longest without a winning suggestion. `waiting_since(user) = last_win_at`, or
`joined_at` if the user has never won ("Measure members who have never won from
their join date, not as infinitely overdue"). Earliest `waiting_since` wins.

---

## 4. Interpretations chosen where the spec is silent or ambiguous

These are decisions, not spec text. Each is applied consistently across all
vectors and named in the affected vector's `rationale`.

1. **Order of the eligibility floor vs. the approval floor.** Coverage gates
   *eligibility*; `APPROVAL_FLOOR` gates *promotion to finalist*. A movie can be
   eligible yet not a finalist (V011). "Fewer than two movies clear the floor" is
   counted over **eligible** movies only (V012).
2. **`approval` in runoff tiebreak #2 is the fraction, not the raw yes count.**
   The spec calls it "Approval count" in rule 2 but defines `approval` as a
   fraction in Phase 1 and calls the same rung "higher approval" in the finalist
   chain. Fraction chosen; V029 pins it and would fail under the count reading.
3. **Tallies are frozen at RUNOFF entry.** "Vetoing sets the voter's standing
   vote on that movie to no" is recorded as a forward-looking side effect
   (`standing_vote_side_effects`); it does not retroactively change this round's
   `coverage`/`approval`/`yes_votes`. Otherwise the veto step would mutate the
   finalist set it was computed from.
4. **A veto by a non-attendee is ignored entirely** — no disqualification and no
   standing-vote side effect (V024). The spec grants the veto to attendees.
5. **The veto step does not happen at all when one movie wins outright**, since
   the spec says RUNOFF is "skipped entirely when only one movie clears the
   approval floor". A stray veto row must therefore not affect the outright
   winner (V040).
6. **Pair votes on pairs that are not both surviving finalists are ignored**
   (V019, V017). Tallies are computed on read, so stale/extra rows must not leak
   into the tally.
7. **A tied pair (equal preference counts) yields no winner for that pair**, so
   it contributes 0 to both Copeland scores. "A beats B if it wins strictly more
   head-to-heads."
8. **Rotation fairness only considers finalists suggested by attendees.** If
   none of the tied finalists has an attendee suggester, or if the most-overdue
   `waiting_since` timestamps are equal, the rung does not decide and evaluation
   falls through to shortest runtime (V033) and then seeded random (V034).
9. **`MIN_ATTENDEE_VOTES` was exposed as config** when the spec still hard-coded
   `>= 3`; every vector left it at 3, so nothing depended on that liberty — which
   is why the floor's removal (section 0) touched so few of them.
10. **The floors are inclusive** (`>=`): coverage exactly `0.6` passes (V001),
    approval exactly `0.5` passes (V013), `vetoes` exactly `VETO_THRESHOLD`
    disqualifies (V019).
11. **Zero attendees / zero movies** are not covered: the spec defines no
    behaviour (`coverage` would divide by zero) and guessing would encode an
    assumption rather than test one.
12. **Each rung narrows the tied set; it does not restart it.** With more than
    two candidates tied, rung *n* keeps the subset that is best on rung *n* and
    hands only that subset to rung *n+1*. A rung that fails to separate anything
    (all candidates equal, or - for rotation fairness - no candidate has an
    attendee suggester) is skipped and does not become `decided_by`.
    `decided_by` names the last rung that actually narrowed the set. V039
    exercises this: Copeland ties all five finalists at 0, approval narrows to
    {m01, m05}, and rotation fairness picks m05.
13. **Rank order inside the promoted set** uses the same chain as the boundary
    tie, with `finalist_ids_ranked` reported yes-votes-descending. It is only
    asserted where the chain fully determines it (see `rank_order_asserted`).

---

## 5. Index

`vectors/NNN-slug.json`, 40 vectors. Each file's `description` names the exact
spec clause it exercises, `spec_clause` quotes it, and `rationale` shows the
arithmetic.

| # | file | what it pins down |
|---|---|---|
| V001 | coverage-exactly-at-floor | coverage 3/5 = 0.60 exactly at COVERAGE_FLOOR passes (>=) |
| V002 | coverage-above-floor | coverage 4/5 = 0.80 above the floor passes |
| V003 | coverage-below-floor | 3/6 = 0.50 fails despite 100% approval (the spec's "two enthusiastic swipes" trap) |
| V004 | coverage-alone-gates-eligibility | coverage 2/3 passes on 2 votes -> eligible, sole clearer, outright win (re-derived 2026-08-01) |
| V005 | fully-swiped-in-a-three-person-group | 3 of 3 attendees swiped -> coverage 1.00 -> eligible |
| V006 | approval-divides-by-voters-who-saw-the-card | approval 2/4 = 0.50, not 2/5 = 0.40 |
| V007 | absence-of-vote-is-a-third-state | abandoned half-ballot must not read as "no" (would drop a finalist) |
| V008 | non-attendee-standing-votes-do-not-count | absent members' swipes excluded from every tally |
| V009 | non-attendee-pair-votes-do-not-count | absent member's pair vote excluded; pair tie -> Copeland tie -> approval |
| V010 | finalist-ranking-by-attendee-yes-votes | ranking key is yes-votes, not approval; rank 1 need not win |
| V011 | eligible-but-below-approval-floor-and-outright-win | approval floor gates promotion; exactly one clears -> outright, Phase 2 skipped |
| V012 | none-clear-approval-floor-no-clear-favourite | zero clear -> "no clear favourite", winner null |
| V013 | approval-floor-inclusive-at-exactly-half | approval exactly 0.50 clears (>=, not >) |
| V014 | boundary-tie-broken-by-approval | boundary tie, rung 1 approval 0.667 > 0.50 |
| V015 | boundary-tie-broken-by-rotation-fairness | equal approval -> rung 2 fairness (never-won vs last win 2026-05-01) |
| V016 | boundary-tie-broken-by-shortest-runtime | equal approval + equal fairness -> rung 3, 96 < 124 |
| V017 | boundary-tie-broken-by-seeded-random | all rungs tied -> rung 4; permissible finalist sets, not one answer |
| V018 | boundary-tie-never-broken-by-insertion-order | newest movie wins the boundary on approval; added_at must not decide |
| V019 | veto-threshold-one-disqualifies | 1 veto >= threshold 1 disqualifies; vetoed movie's pair votes ignored |
| V020 | veto-threshold-configurable-not-met | threshold 2, 1 veto -> survives and still wins |
| V021 | veto-threshold-two-met-by-two-voters | threshold 2 reached by two distinct attendees |
| V022 | veto-exception-zero-survivors-vetoes-ignored | vetoes would leave 0 -> ignored for ranking, reported in UI |
| V023 | veto-exception-one-survivor-vetoes-ignored | "fewer than two" includes 1; pair tie -> Copeland tie -> approval |
| V024 | non-attendee-veto-ignored | absent member's veto neither disqualifies nor flips a standing vote |
| V025 | explicit-veto-pass-is-not-a-veto | "done, vetoed nothing" vs "hasn't opened the app"; neither is a veto |
| V026 | clean-condorcet-winner | beats every other finalist -> no tiebreak consulted |
| V027 | cycle-resolved-by-copeland | 4 finalists, cycle m1>m2>m4>m1, Copeland 2/1/1/1 -> m1 |
| V028 | copeland-tie-resolved-by-approval | perfect 3-cycle, Copeland 1/1/1 -> approval 1.00 |
| V029 | approval-tiebreak-uses-fraction-not-yes-count | cycle decided by approval 1.00 (3 yes) over 0.80 (4 yes) |
| V030 | copeland-and-approval-tie-resolved-by-rotation-fairness | all Phase 1 numbers identical -> rung 3 picks the never-won suggester |
| V031 | rotation-fairness-restricted-to-attendees | most-overdue member is absent; his movie must not win the rung |
| V032 | never-won-measured-from-join-date | new member (joined 2026-07-01) does not jump the queue |
| V033 | fairness-tie-resolved-by-shortest-runtime | fairness genuinely tied -> 96 < 118 |
| V034 | all-rungs-exhausted-seeded-random | rung 5; rule + permissible winners asserted, winner_id null |
| V035 | no-preference-contributes-to-neither-side | explicit null and missing row both leave the tally at 2-1 |
| V036 | coverage-divisor-is-attendees-not-members | 3/3 = 1.00, not 3/10 = 0.30, in a 10-member group |
| V037 | watched-movie-not-eligible | status = watched excluded before any floor is applied |
| V038 | veto-sets-standing-vote-to-no | veto upserts the vetoer's standing vote to no (forward-looking) |
| V039 | effort-budget-constant-in-pool-size | 12-movie pool, 5 finalists, C(5,2) = 10 pairs; rung narrowing to fairness |
| V040 | outright-win-skips-veto-step | RUNOFF skipped, so a stray veto row cannot disqualify the outright winner |

### Coverage of the interesting discriminators

Twelve vectors are built so that a plausible *wrong* implementation produces a
different documented outcome rather than merely a different number:
V003/V036 (which divisor), V006 (approval divisor), V007 (absence as "no"),
V008/V009/V024/V031 (attendee-only), V013 (`>` vs `>=`), V018 (insertion order),
V029 (approval count vs fraction), V032 (never-won as infinitely overdue),
V035 (crediting "no preference" to a side), V040 (evaluating vetoes on a skipped
RUNOFF).
