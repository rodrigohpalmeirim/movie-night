# Movie Night — Voting Mechanism Spec

## Overview

Two-phase voting over a persistent pool of movies.

**Phase 1 — Swipe.** Unlimited yes/no votes establish which movies are *acceptable*, and select a handful of finalists.

**Phase 2 — Runoff.** Finalists are compared head-to-head, plus one veto each. This produces the winner.

Phase 1 answers "would we watch this at all?" Phase 2 answers "which of these do we most want tonight?" Both questions need answering; neither method answers both alone.

Design constraints the system is built around:

- Adding a movie must never invalidate a vote already cast.
- Per-night effort must be constant in pool size, so the app stays usable after months of accumulated suggestions.
- Nobody is ever asked to re-answer a question they have already answered.

---

## The central design rule: two vote lifetimes

Votes come in two layers with **different lifetimes**. Conflating them is the main failure mode.

| | Standing layer | Round layer |
|---|---|---|
| Question | "Would I ever watch this?" | "Which of tonight's finalists?" |
| Actions | yes / no | pairwise picks, 1 veto |
| Scope | one per (user, movie), no round | one set per (user, round) |
| Lifetime | permanent, editable at any time | reset every round |
| Asked | once, when the movie enters the pool | every round |

"Would I watch this?" is a durable property of the movie and the voter's taste, so it is asked once and never re-asked. Voters swipe each movie a single time, ever, and may revise any past swipe from the pool screen whenever they like.

"Which do I want tonight?" is volatile and mood-dependent, so it is asked fresh each round against a small finalist set.

Because nothing budgeted ever attaches to anything longer-lived than one night, no budget can lock up. There is no reset job to run and no counter that can drift.

---

## Phase 1: Swipe

New members swipe the existing pool once during onboarding. Existing members receive only a short top-up stack when movies are added ("2 new movies"), never a re-swipe of the pool.

| Gesture | Meaning |
|---|---|
| Swipe left | No |
| Swipe right | Yes, I'd happily watch this |

Standing votes are editable at any time from a pool screen. Absence of a vote is a **third state**, distinct from "no" — see the cross-cutting rules.

### Attendance

Each round has an explicit attendee set, and **all tallies count attendees only.** If someone isn't coming, their preferences shouldn't constrain what gets watched. Someone who is coming but doesn't open the app still contributes their standing approvals, so the winner remains acceptable to them. Absence degrades gracefully rather than disenfranchising.

### Eligibility

A movie is eligible if `status = pool` and:

```
attendee_votes(movie) = attendees with a standing vote on this movie

coverage(movie) = attendee_votes(movie) / attendees
approval(movie) = yes_votes among attendees / attendee_votes(movie)
```

Require `coverage >= COVERAGE_FLOOR` (default 0.6). That is the whole test.

The coverage rule is load-bearing in a persistent pool. Without it, a movie added yesterday with two enthusiastic swipes shows 100% approval and beats a film with eight yes-votes out of ten. A movie that can't clear coverage waits for the next round — the correct, non-punitive way to handle late additions when the pool is long-lived.

There is deliberately **no** absolute floor on `attendee_votes`. An earlier version of this spec also required `attendee_votes >= 3`, which locked small groups out: with three attendees and one abstention nothing could ever be eligible, and the round ended "no clear favourite" for a reason the group could not fix. Coverage is a *share*, so it does that job at any size — three of five and one of one are both a fully-seen film. The one thing that cannot be waived is an electorate: with no attendees, `coverage` divides by zero, nothing is eligible, and no round may be decided.

`approval` divides by voters who *saw the card*, never by total attendees.

### Selecting finalists

Rank eligible movies by `yes_votes` among attendees. Promote the top `N_FINALISTS` (default 5) that also satisfy `approval >= APPROVAL_FLOOR` (default 0.5).

Ties at the finalist boundary (e.g. 5th and 6th place with equal yes-votes) are common in a small group and must be broken deterministically, never by insertion order. Reuse the runoff's chain: higher approval, then rotation fairness, then shortest runtime, then seeded random.

The approval floor is load-bearing. Without it, a pool of uniformly unappealing movies still produces a confident-looking winner. If fewer than two movies clear the floor:

- Exactly one clears it → it wins outright, skip Phase 2.
- None clear it → end the round with "no clear favourite" and prompt for more suggestions. This is a legitimate and useful outcome.

---

## Phase 2: Runoff

### Veto

Before the pairwise step, each attendee may veto **one finalist** — a film they genuinely can't sit through. One screen, five rows, one optional tap. Skippable.

A finalist with `vetoes >= VETO_THRESHOLD` is disqualified for this round. Default `VETO_THRESHOLD = 1`; make it configurable, since one veto is right for five friends and too strict for twenty.

Vetoing sets the voter's standing vote on that movie to "no", so the two layers can never contradict each other. This flip is forward-looking only: the round's tallies are computed from a snapshot of standing votes taken when finalists were computed, so a veto can never mutate the tallies of the round it was cast in. Otherwise, when a vetoed movie survives into the round robin, two identical rounds could pick different winners depending on veto order.

Pre-fill each voter's veto with last round's target if that movie is a finalist again. Without this, the person who genuinely cannot watch horror re-vetoes every week; with it, that costs one tap.

A vetoed movie returns to the pool next round rather than being deleted. A block persists only as long as someone keeps spending their single veto on it, so vetoes cast in a moment of pique quietly expire while real objections stay in force.

Exception: if vetoes leave fewer than two finalists, ignore them for ranking but surface them prominently in the UI. Never reach a state with no options.

Accepted disclosure (decided, not an oversight): because voters are only asked about *surviving* pairs, a ballot shrinking mid-runoff reveals which finalist was disqualified. Asking the full round robin over the frozen finalist set would close this channel; that secrecy was judged not worth the wasted taps on pairs the tally discards anyway.

### Pairwise comparison

Surviving finalists go to a full round robin. With 5 finalists that's 10 pairs, with 4 it's 6 — small enough that every voter completes all of them, so there is no sampling, no Elo, no rating model, no confidence intervals. Keep `N_FINALISTS` at or below 5 so this stays true.

Present one pair per screen: two posters, tap the preferred one. Allow "skip / no preference" — forcing a choice between two films someone hasn't seen produces noise, not information.

### Tally

For each pair, count how many attendees preferred A to B. A beats B if it wins strictly more head-to-heads. The winner beats every other finalist (the Condorcet winner).

Cycles are possible (A beats B beats C beats A) and must be handled rather than left to crash. Resolve in order:

Each rule *ranks and narrows* the tied set; whatever remains tied falls through to the next rule. A rule that separates nothing is skipped. In particular, at rule 3 a finalist whose suggester is not attending has the worst possible fairness claim and is eliminated by that rung (rather than the rung being skipped as indecisive).

1. **Copeland score** — most pairwise victories wins.
2. **Approval** — the higher-approved finalist wins (the `approval` fraction, not the raw yes count).
3. **Rotation fairness** — the finalist suggested by whichever *attendee* has gone longest without a winning suggestion.
4. **Shortest runtime.**
5. **Seeded random**, recorded on the round so the result is reproducible and auditable.

Rule 3 is worth implementing properly rather than treating as a formality. Over many rounds it is what stops the person with unusual taste from never winning, and it is the main thing this app can do that a show of hands cannot. Restrict it to attendees, or absent members accumulate "owed a win" credit for nights they skipped. Measure members who have never won from their join date, not as infinitely overdue — otherwise someone who joined yesterday jumps the entire queue.

---

## Effort budget

```
new movie added   → 1 swipe, once ever
per movie night   → 1 optional veto tap + up to 10 pairwise taps
```

**Constant in pool size.** If any per-round step scales with the size of the pool, something has been built wrong. This is a testable invariant, not an aspiration.

---

## Lifecycle of a movie

```
suggested → pool → finalist → won → watched → archived
                ↑                                  |
                └──── optional re-watch after cooldown ────┘
```

When a movie is watched, set `status = watched` and stamp `watched_at`. Its standing votes are **archived, not deleted** — needed for history and re-watches. Nothing about retirement touches anyone's budget, because budgets are only ever per-round.

Optionally allow a watched movie back after a cooldown (default: never, configurable) with standing votes restored as a starting point voters can revise.

Update the fairness counter for the winner's `suggested_by` when the movie is marked **watched**, not when the round is decided — otherwise an abandoned movie night still consumes someone's turn.

---

## Cross-cutting rules

**Results stay hidden until the round closes.** No live tallies, no vote counts on cards, no "trending" section. Visible partial results cause anchoring and bandwagoning, and hand the last voter disproportionate power. This affects outcomes more than the choice of voting method does — treat it as a hard requirement, not a preference. A voter always sees their own standing votes; only aggregates are hidden.

**Never conflate "no" with "not yet seen".** The absence of a standing vote is a distinct state from a left-swipe. If they are collapsed, an abandoned half-finished ballot silently reads as rejection of every movie the voter never reached, and the coverage rule stops working entirely. Record veto-pass skips explicitly for the same reason: "done, vetoed nothing" is not "hasn't opened the app".

**Never force a re-vote.** Adding a movie produces a top-up stack for everyone else; it invalidates nothing. This is why a swipe ballot is correct for an app where suggestions arrive over time — any ranked-ballot alternative would require every voter to redo their whole ballot whenever anything is added.

**Onboard new members into the current round first.** Someone joining in month three faces a backlog of twenty-plus movies. Show them tonight's finalists first so they can participate immediately, then offer the backlog as an optional stack.

---

## State machine

```
OPEN → RUNOFF → DECIDED → WATCHED
```

- `OPEN` — pool open for additions, and standing swipes for anyone with gaps (new movies only). Suggesting and swiping are one state: a new suggestion simply lands in everyone's top-up stack. Closes on deadline or when all attendees have no gaps.
- `RUNOFF` — finalists computed. Veto screen, then pairwise. Skipped entirely when only one movie clears the approval floor.
- `DECIDED` — winner revealed, all tallies now visible.
- `WATCHED` — winner retired, fairness counters updated.

A round can only leave `OPEN` or `RUNOFF` while at least one member is attending. This is arithmetic, not a preference: an empty attendee set makes every `coverage` a division by zero and turns a "winner" into an all-zero head-to-head grid broken by runtime. One attendee is enough.

---

## Data model

```
User          { id, display_name }

Movie         { id, title, year, runtime_min, poster_url,
                suggested_by → User, added_at,
                status: pool|watched, watched_at }

StandingVote  { user_id, movie_id, value: yes|no, updated_at }
                -- unique (user_id, movie_id)
                -- NO round_id: this is the persistent layer
                -- absence of a row = not yet seen, NOT a "no"

Round         { id, state, created_at, closes_at,
                finalist_ids[], winner_id, random_seed }

Attendance    { round_id, user_id, attending: bool,
                runoff_submitted_at }
                -- null = hasn't opened the app
                -- set = done, even if they vetoed nothing

Veto          { round_id, user_id, movie_id, created_at }
                -- unique (round_id, user_id): one veto per round

PairVote      { round_id, user_id, movie_a_id, movie_b_id,
                winner_id | null,   -- null = explicit no preference
                created_at }
                -- unique on (round_id, user_id, unordered pair)

Fairness      { user_id, last_win_round_id, wins_count }
```

`StandingVote` has no `round_id`; `Veto` and `PairVote` do. Do not merge these tables or unify them behind one "votes" abstraction — the split between permanent and per-round is the whole reason budgets can't lock up and ballots never need redoing.

## Implementation notes

- Vote writes are idempotent upserts on the unique constraints above; a voter changing their mind updates in place. Re-submitting must not double-count.
- Enforce the one-veto-per-round limit **server-side** via the unique constraint. Client-side enforcement alone is trivially bypassed.
- Compute all tallies on read rather than maintaining running counters. Data volume is tiny and derived counters drift.
- Persist `random_seed` per round at creation so any tiebreak is reproducible if someone disputes the result.
- Configurable per group: `N_FINALISTS` (5), `APPROVAL_FLOOR` (0.5), `COVERAGE_FLOOR` (0.6), `VETO_THRESHOLD` (1), `REWATCH_COOLDOWN` (off).

---

## Deliberately not included

Recorded so these aren't re-derived later:

- **Weighted "super-like" votes.** Considered and cut. Their job was to separate "tolerable" from "excited", but the pairwise runoff does that with finer resolution. Their only unique function was nudging a film into the finalist set, which isn't worth the budget state, reset semantics, and shortlist machinery it required.
- **A shortlist stage between eligible and finalists.** Only needed to bound the cost of collecting per-movie intensity votes. With those gone, the finalist set is small enough to act on directly.
- **Live vote counts.** See cross-cutting rules; this is a deliberate omission, not a missing feature.
