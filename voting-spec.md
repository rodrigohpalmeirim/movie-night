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
| Star | Yes, and I'd *especially* like to watch this |

Standing votes are editable at any time from a pool screen. Absence of a vote is a **third state**, distinct from "no" — see the cross-cutting rules.

### Stars

A **star** is an *upgraded yes*, not a third vote value.

- **A star implies a yes.** Starring is only valid on a yes; unstarring falls back to a plain yes, never to "no" or to no vote at all. Setting a standing vote to "no" — including the veto's forward-looking flip — drops the star with it, because the two can never coexist.
- **Unlimited.** Any member may star any number of films. There is no budget, so there is nothing to reset and no counter that can drift — the property that made per-round intensity budgets untenable (see *Deliberately not included*).
- **Editable whenever the underlying swipe is**, from the same screens.

Stars do exactly one job:

> A star is the **highest-priority tie-breaker after the approval count** when selecting finalists in Phase 1. Nothing else.

```
star_votes(movie) = attendees whose standing vote on this movie is a STARRED yes
```

Because stars are consulted only *after* `yes_votes`, a star can never promote a movie past one with more yes-votes; it separates only films the approval count has already tied. Where yes-vote counts differ, stars are irrelevant.

Stars play **no** role anywhere else: not in `coverage`, `approval` or eligibility; not in the veto step; not in the round robin; not in the runoff's cycle tiebreak chain. They are counted from attendees only, like every other tally.

### Attendance

Each round has an explicit attendee set, drawn from the group's **current** members (see *Removed members* in the cross-cutting rules), and **all tallies count attendees only.** If someone isn't coming, their preferences shouldn't constrain what gets watched. Someone who is coming but doesn't open the app still contributes their standing approvals, so the winner remains acceptable to them. Absence degrades gracefully rather than disenfranchising.

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

Ties at the finalist boundary (e.g. 5th and 6th place with equal yes-votes) are common in a small group and must be broken deterministically, never by insertion order. The full ranking key is therefore:

```
1. yes_votes    among attendees, descending   -- the primary ranking key
2. star_votes   among attendees, descending   -- see Stars, above
3. approval     descending                    -- then the runoff's chain
4. rotation fairness
5. shortest runtime
6. seeded random
```

Steps 3–6 are the runoff's own chain, reused verbatim ("higher approval, then rotation fairness, then shortest runtime, then seeded random"). Step 2 is the one addition, and it exists only here: the runoff's chain itself is unchanged and never consults stars.

The approval floor is load-bearing. Without it, a pool of uniformly unappealing movies still produces a confident-looking winner. If fewer than two movies clear the floor:

- Exactly one clears it → it wins outright, skip Phase 2.
- None clear it → end the round with "no clear favourite" and prompt for more suggestions. This is a legitimate and useful outcome.

---

## Phase 2: Runoff

### Veto

Before the pairwise step, each attendee may veto **one finalist** — a film they genuinely can't sit through. One screen, five rows, one optional tap. Skippable.

A finalist with `vetoes >= VETO_THRESHOLD` is disqualified for this round. Default `VETO_THRESHOLD = 1`; make it configurable, since one veto is right for five friends and too strict for twenty.

**The step itself is optional per group.** `VETOES_ENABLED` (default true, so every existing group keeps its veto) turns the whole thing off for groups where a unilateral strike costs more than it saves. When it is off there is no veto step: nobody is asked, nothing is recorded, and Phase 2 runs the pairwise step alone against an empty veto set — no finalist is disqualified, the fewer-than-two exception below cannot fire, and the reveal has no veto section rather than an empty one. Nothing else in the phase changes, and no tally rule does: the tally already takes the veto set as an input, and an empty one is a set it must handle anyway (every round where nobody vetoed).

Which rounds a change affects is settled by the freeze that already protects `VETO_THRESHOLD`: **the knobs are frozen onto the round when its finalists are computed**, so switching vetoes off — or on — applies from the next finalist computation and never to a round already in the runoff. That is exactly what stops a live runoff from waiting on veto submissions that can no longer be made: a round told vetoes are on keeps its veto step until it is decided, and a round told they are off refuses a veto that arrives late, whatever the group's setting says by then.

Vetoing sets the voter's standing vote on that movie to "no" — dropping any star, since a star is an upgraded yes — so the two layers can never contradict each other. This flip is forward-looking only: the round's tallies are computed from a snapshot of standing votes taken when finalists were computed, so a veto can never mutate the tallies of the round it was cast in. Otherwise, when a vetoed movie survives into the round robin, two identical rounds could pick different winners depending on veto order.

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
                    (the veto tap is absent where VETOES_ENABLED is off)
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

**Removed members leave the present, not the past.** People drift out of a group, and a member who has gone should stop constraining what the group watches — but history refers to them, so they are never deleted. Removal is a soft `removed_at` stamp, reversible by anyone in the group, and it means exactly one thing: *a removed member is not part of the group's present.*

- They are not in the member list, and cannot be marked as attending — by themselves or by proxy.
- They are therefore not in the attendee set, which removes them from every `coverage` denominator, from `approval`, from `star_votes`, from the electorate a round needs in order to be decided, and from rotation fairness.
- Their standing votes and stars are **kept, not deleted**, and simply stop being counted. Restoring them counts every one of those answers again, exactly as it was.
- Their suggestions stay in the pool and stay credited to them.
- Past rounds are untouched: a decided outcome, its frozen finalist set and its published tallies are historical facts, and they keep naming whoever was there.
- The one edge worth stating: if someone is removed *during* an active round, any RSVP, standing vote, star, veto or pairwise pick they had already recorded stops counting from that moment, because every tally is computed on read against the current attendee set. What has already been *decided* does not move.

**Onboard new members into the current round first.** Someone joining in month three faces a backlog of twenty-plus movies. Show them tonight's finalists first so they can participate immediately, then offer the backlog as an optional stack.

---

## State machine

```
OPEN → RUNOFF → DECIDED → WATCHED
```

- `OPEN` — pool open for additions, and standing swipes for anyone with gaps (new movies only). Suggesting and swiping are one state: a new suggestion simply lands in everyone's top-up stack. Closes on deadline or when all attendees have no gaps.
- `RUNOFF` — finalists computed. Veto screen (only where `VETOES_ENABLED`, per the round's frozen knobs), then pairwise. Skipped entirely when only one movie clears the approval floor.
- `DECIDED` — winner revealed, all tallies now visible.
- `WATCHED` — winner retired, fairness counters updated.

A round can only leave `OPEN` or `RUNOFF` while at least one *current* member is attending (a removed member counts for nothing here, like everywhere else). This is arithmetic, not a preference: an empty attendee set makes every `coverage` a division by zero and turns a "winner" into an all-zero head-to-head grid broken by runtime. One attendee is enough.

---

## Data model

```
User          { id, display_name, removed_at }
                -- removed_at set = left the group: not in the member list,
                --   not in any attendee set, votes/stars kept but uncounted;
                --   never deleted, because history refers to them

Movie         { id, title, year, runtime_min, poster_url,
                suggested_by → User, added_at,
                status: pool|watched, watched_at }

StandingVote  { user_id, movie_id, value: yes|no, starred: bool, updated_at }
                -- unique (user_id, movie_id)
                -- NO round_id: this is the persistent layer
                -- absence of a row = not yet seen, NOT a "no"
                -- starred = true is an UPGRADED yes; starred with value "no"
                --   is not a representable state

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

- Vote writes are idempotent upserts on the unique constraints above; a voter changing their mind updates in place. Re-submitting must not double-count. Starring is part of that same upsert, not a separate row: `starred` travels with the value it upgrades, which is what makes "a star implies a yes" unbreakable rather than merely enforced.
- Enforce the one-veto-per-round limit **server-side** via the unique constraint. Client-side enforcement alone is trivially bypassed.
- Compute all tallies on read rather than maintaining running counters. Data volume is tiny and derived counters drift.
- Persist `random_seed` per round at creation so any tiebreak is reproducible if someone disputes the result.
- Configurable per group: `N_FINALISTS` (5), `APPROVAL_FLOOR` (0.5), `COVERAGE_FLOOR` (0.6), `VETOES_ENABLED` (on), `VETO_THRESHOLD` (1), `REWATCH_COOLDOWN` (off). Every one of them is frozen onto a round at its finalist computation, which is where "a knob never retro-affects a live runoff" is enforced — once, for all of them.

---

## Deliberately not included

Recorded so these aren't re-derived later:

- **Weighted "super-like" votes.** Considered and cut, and the cut still stands as written: a *weighted* vote — one that adds to a movie's score and so can outrank plain yes-votes — was not worth the budget state, reset semantics, and shortlist machinery it required, and the pairwise runoff already separates "tolerable" from "excited" with finer resolution.

  **Superseded in part (see Phase 1 → Stars).** The star that was later adopted keeps the intent and none of the machinery: it is unlimited, so there is no budget to spend, reset or leak; it is a flag on the standing vote, so there is nothing new to store and no shortlist stage; and it is a *tie-breaker only*, so it can never outrank a yes-vote or nudge a film past a better-approved one. It changes an outcome in exactly one situation — two films tied on yes-votes at the finalist boundary — which is the situation the group actually wanted a say in.
- **A shortlist stage between eligible and finalists.** Only needed to bound the cost of collecting per-movie intensity votes. With those gone, the finalist set is small enough to act on directly.
- **Live vote counts.** See cross-cutting rules; this is a deliberate omission, not a missing feature.
