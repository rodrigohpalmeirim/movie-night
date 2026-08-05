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

**2026-08-04 — stars were added to Phase 1, and member removal became a soft
`removed_at`.** Both are additions; neither retired a rule and neither changed a
single expected value in V001–V040. Consequences, all re-derived from the amended
text:

*Stars.* A star is an **upgraded yes** (`starred` on the standing vote, valid only
on a `yes`, unlimited per member), and it does exactly one job: it is the
tie-breaker directly below `yes_votes` when ranking finalists. The Phase 1 key is
now `yes_votes → star_votes → approval → rotation fairness → shortest runtime →
seeded random`. Everything from `approval` down is unchanged, and the runoff's own
chain (`copeland → approval → …`) does **not** gain the rung: stars are absent
from Phase 2 entirely, and from `coverage`, `approval` and eligibility.

* **No existing vector's outcome, tally, finalist set, boundary rule or winner
  changed.** Every vector in V001–V040 has zero stars, so the new rung compares
  `0` with `0`, separates nothing, and is skipped by the spec's own composition
  rule ("a rule that separates nothing is skipped"). The rung is *inserted*, not
  substituted: nothing that previously reached `approval` stops reaching it.
* **New: V041, V042, V043.** They pin, respectively, the rung deciding a boundary
  tie *ahead of* approval; the guarantee that stars never outrank a yes-vote; and
  an equal star count falling through instead of deciding.
* The `finalist_boundary_tiebreak.rule` enum gains `stars`. `decided_by` does
  **not**: it names a rung of the *runoff* chain, which stars never join.
* `input.standing_votes[]` gains an optional `"starred": true`. Absent means a
  plain vote, which is why no existing vector needed touching.
* `expected.tallies[*]` gains an optional `star_votes`. Only the new vectors carry
  it; a runner asserts it when present.

*Member removal.* `members[]` gains an optional `removed_at`. A removed member is
kept for history but is **not part of the group's present**: not in the attendee
set, so out of every `coverage` denominator, out of `approval` and `star_votes`,
out of the electorate a round needs, and out of rotation fairness. Their standing
votes, stars, RSVPs, vetoes and pair votes are all kept and all stop counting —
including ones recorded earlier in a still-active round.

* **New: V044.** A three-member electorate with three removed members who each
  still hold an `attending = true` RSVP, votes, and stars. Two plausible wrong
  readings (counting them in the electorate; excluding them from the denominator
  but not from the vote rows) each produce a *different documented winner*.
* No existing vector has a removed member, so the filter is a no-op across
  V001–V040.
* Removal is filtered by the **caller**, not by a new tally rule: the spec defines
  it as an effect on the attendee set, and `decide_round` already takes that set
  as input.

*Convention for both:* the new vectors omit the retired `MIN_ATTENDEE_VOTES` key
from `input.config`, because they were derived after its removal and there is
nothing for them to record.

**2026-08-04 — the veto step became optional per group (`VETOES_ENABLED`, default
true).** An addition, and the only one of these three that could not change a
vector even in principle: **no vector's expected values, and no tally rule, moved.**
Consequences, re-derived from the amended text:

* `VETOES_ENABLED` off means the caller hands `decide_round` an **empty `vetoes[]`**
  and asks no one for one. It is not a new tally rule and there is nothing new for
  a vector to pin: 35 of the 44 vectors already pass `"vetoes": []`, so the
  disabled case is the case they were derived against. **No new vectors** — inventing
  V045 "vetoes off" would restate V026 with a different label.
* The veto rules themselves are unchanged where the step exists: the threshold, the
  standing-vote flip, the pass-is-not-a-veto rule and the fewer-than-two-survivors
  exception all read exactly as before (V019–V025, V038, V040 untouched).
* `input.config` does **not** gain the key in any vector. A runner that meets a
  config block without it reads the spec default (on), which is what all 44 were
  derived against; a runner that is handed the key reads it as gating whether the
  `vetoes[]` it receives may be non-empty, nothing more.
* Which rounds a change applies to is a *freeze* question, not a tally question:
  the knobs are frozen onto a round at its finalist computation, so a mid-round
  toggle is invisible to `decide_round`, which is handed one config block per
  round and has no notion of the group's live settings.

**2026-08-05 — stars became a rung of the RUNOFF chain as well, directly below
approval.** The first amendment here that *revokes* a guarantee rather than adding
to one: the spec used to say "Stars play no role anywhere else … not in the
runoff's cycle tiebreak chain", and the 2026-08-04 entry above records that
reading. It is gone. The cycle chain is now `copeland → approval → stars →
rotation fairness → shortest runtime → seeded random`, and the spec's stated
reason for that seat is that the chain already falls back to standing signals the
moment the live vote ties — `approval` is one — so a star is not a new kind of
input there, only a finer-grained one, reached once both the pairwise vote and
approval have refused to decide. The product rule both chains still share: stars
are seasoning, not votes. Every rung above them is a yes-signal, so they separate
only films that signal has already tied and never promote one past it — past more
yes-votes at the boundary, past a better approval in the runoff. Consequences, all
re-derived from the amended text:

* **No existing vector's expected values changed**, for the same reason the
  2026-08-04 addition changed none: every vector that reaches the cycle chain has
  zero stars on every finalist (the only starred vectors, V041–V044, are decided
  at the boundary or by Condorcet), so the new rung compares `0` with `0`,
  separates nothing, and is skipped. The rung is *inserted*: nothing that reached
  rotation fairness before stops reaching it.
* **New: V045, V046, V047.** They pin, respectively, the rung deciding a runoff
  once Copeland *and* approval have tied; its position **below** approval (the
  most-starred film of the night is eliminated by approval, and the rung then
  decides between the survivors); and its attendee scope (two stars from members
  who are not coming decide nothing). All three name a different winner under a
  chain with no star rung at all (rotation fairness picks it instead); V046 names a
  third winner again under a chain that seats the rung *above* approval, and V047
  under one that counts a non-attendee's star.
* **`decided_by` gains `stars`.** The 2026-08-04 entry says it does not, on the
  grounds that it names a rung of the runoff chain "which stars never join". That
  sentence is now false and the enum in §2 has the value.
* **The runoff's rungs 3–5 are renumbered 4–6.** Rotation fairness is rule 4,
  shortest runtime 5, seeded random 6 — which is also what they are in the Phase 1
  chain, so the two chains now agree rung for rung from rotation fairness down.
  The V030 and V034 index lines below are re-worded accordingly; a *rationale*
  inside a vector file still quoting the old numbers is left as derived, exactly as
  the 2026-08-01 entry left its inert arithmetic. V041's `spec_clause` likewise
  still quotes "Nothing else." from the pre-amendment Stars section: the Phase 1
  rung that vector pins did not move, and vectors are not rewritten to track
  prose.
* Nothing changes in the input shape. `starred` was already an optional field on
  `standing_votes` and `star_votes` an optional expected tally; the new vectors use
  both, and a Phase-2-only runner that ignored `star_votes` before now needs the
  star counts to reach the right winner.

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
                               // VETOES_ENABLED (spec default on) is absent from every
                               //       vector: off simply means an empty `vetoes` array,
                               //       which 35 vectors already pass. See section 0.
    "REWATCH_COOLDOWN": null   // spec default off; unused by these vectors
  },

  "members": [
    {
      "id": "u1",
      "join_order": 1,               // 1-based order in which members joined the group
      "joined_at": "2026-01-01T00:00:00Z",
      "removed_at": null,            // OPTIONAL (see section 0). Set = left the group: kept for
                                     // history, but absent from every attendee set from then on.
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
    { "user_id": "u1", "movie_id": "m1", "value": "yes" },  // or "no"
    { "user_id": "u2", "movie_id": "m1", "value": "yes", "starred": true }
                                     // OPTIONAL `starred` (see section 0): an UPGRADED yes.
                                     // Absent = a plain vote. Only valid on "yes".
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
* **A removed member counts for nothing.** A member with `removed_at` set is
  excluded from the attendee set (and therefore from `attendees`), from every
  standing vote, star, veto and pair-vote tally, and from rotation fairness — even
  where they hold an `attending: true` row cast before removal. Their rows are
  deliberately left in the vector: keeping them is what makes the exclusion
  testable. Only V044 uses this.
* **`standing_votes` is sparse and is the crux of the whole suite.** Rows are
  explicit `yes`/`no`, optionally `starred` (an upgraded yes — never valid on a
  `no`, and counted only as a Phase 1 tie-breaker). **The ABSENCE of a row means
  "not yet seen" — never "no".** An absent row must not appear in `attendee_votes`, must not appear in
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
                                   "coverage": 0.6, "approval": 0.6667,
                                   "star_votes": 1 } },   // OPTIONAL, new vectors only

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

* **`finalist_boundary_tiebreak.rule`** enum: `stars`, `approval`,
  `rotation_fairness`, `shortest_runtime`, `seeded_random` — the Phase 1 chain
  below the `yes_votes` key. Since 2026-08-05 `decided_by` carries the same five
  values plus `copeland`: the two chains are built from the same tie-breakers and
  differ only in where the star sits (above approval here, below it there).
* **`reason`** enum for `ineligible_movies`:
  `status_not_pool`, `coverage_below_floor`. (`attendee_votes_below_minimum` was
  the third value and is retired — see section 0. Vectors list every failing
  reason they intend to assert, so a movie can still carry more than one.)
* **`decided_by`** enum:
  * `single_clear_approval_floor` — exactly one movie cleared `APPROVAL_FLOOR`,
    so it wins outright and Phase 2 is skipped.
  * `condorcet` — one surviving finalist beat every other finalist.
  * `copeland`, `approval`, `stars`, `rotation_fairness`, `shortest_runtime`,
    `seeded_random` — the runoff chain, in spec order (1..6).
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
more `star_votes` → higher approval → rotation fairness → shortest runtime →
seeded random. `star_votes` counts attendees whose standing vote is a *starred*
yes; it is a tie-breaker only — here and in the runoff — and sits below
`yes_votes` by construction, so it can never promote a movie past a movie with
more yes-votes.
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
3. `star_votes` among attendees — below approval, never above it, so a star
   separates only finalists the pairwise vote and approval have both tied,
4. rotation fairness,
5. shortest runtime,
6. seeded random.

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

`vectors/NNN-slug.json`, 47 vectors. Each file's `description` names the exact
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
| V030 | copeland-and-approval-tie-resolved-by-rotation-fairness | all Phase 1 numbers identical (stars included, at zero) -> rotation fairness picks the never-won suggester |
| V031 | rotation-fairness-restricted-to-attendees | most-overdue member is absent; his movie must not win the rung |
| V032 | never-won-measured-from-join-date | new member (joined 2026-07-01) does not jump the queue |
| V033 | fairness-tie-resolved-by-shortest-runtime | fairness genuinely tied -> 96 < 118 |
| V034 | all-rungs-exhausted-seeded-random | the last rung; rule + permissible winners asserted, winner_id null |
| V035 | no-preference-contributes-to-neither-side | explicit null and missing row both leave the tally at 2-1 |
| V036 | coverage-divisor-is-attendees-not-members | 3/3 = 1.00, not 3/10 = 0.30, in a 10-member group |
| V037 | watched-movie-not-eligible | status = watched excluded before any floor is applied |
| V038 | veto-sets-standing-vote-to-no | veto upserts the vetoer's standing vote to no (forward-looking) |
| V039 | effort-budget-constant-in-pool-size | 12-movie pool, 5 finalists, C(5,2) = 10 pairs; rung narrowing to fairness |
| V040 | outright-win-skips-veto-step | RUNOFF skipped, so a stray veto row cannot disqualify the outright winner |
| V041 | boundary-tie-broken-by-stars | star rung decides a yes-vote tie *ahead of* approval (which would have picked the other film) |
| V042 | stars-never-outrank-a-yes-vote | 2 stars and 2 yes lose to 3 yes and no stars; no tiebreak is reached at all |
| V043 | equal-stars-fall-through-to-approval | equal star counts separate nothing -> rung skipped, approval decides |
| V044 | removed-member-counts-for-nothing | removed members' RSVPs, votes and stars all inert; two wrong readings give two different winners |
| V045 | runoff-copeland-and-approval-tie-resolved-by-stars | Copeland 1/1/1 and approval 0.80 all round -> the star rung decides, and `decided_by` is `stars` |
| V046 | runoff-approval-outranks-stars | approval eliminates the most-starred film of the night, and the rung then picks between the two survivors |
| V047 | runoff-stars-are-attendee-scoped | two starred yeses from members who are not coming decide nothing; one attendee's star does |

### Coverage of the interesting discriminators

Twenty-one vectors are built so that a plausible *wrong* implementation produces a
different documented outcome rather than merely a different number:
V003/V036 (which divisor), V006 (approval divisor), V007 (absence as "no"),
V008/V009/V024/V031 (attendee-only), V013 (`>` vs `>=`), V018 (insertion order),
V029 (approval count vs fraction), V032 (never-won as infinitely overdue),
V035 (crediting "no preference" to a side), V040 (evaluating vetoes on a skipped
RUNOFF), V041 (no star rung, or a star rung below approval, in Phase 1),
V042/V043 (stars above `yes_votes`, or summed into the ranking key),
V044 (a removed member left in the electorate, or their vote rows left in the
tally), V045 (a runoff chain with no star rung, which falls to rotation fairness
and a different winner), V046 (a star rung seated above approval instead of below
it — three readings, three winners), V047 (an absent member's star counted in the
runoff).
