# Movie Night — App Spec

Companion to [voting-spec.md](voting-spec.md), which defines the voting mechanism and is
authoritative for everything it covers (eligibility, finalists, veto, pairwise tally,
tiebreaks, vote lifetimes, data-model core). This document specifies everything around it:
groups, identity, movie entry, round orchestration, screens, stack, and deployment.

## Product summary

A mobile-first web app where a group of friends maintains a shared pool of movie
suggestions and, on movie night, runs a two-phase vote (swipe → runoff) to pick what to
watch. Multi-tenant: anyone can create a group and share a secret link. Trust-based
throughout — no accounts, no roles, no moderation hierarchy.

## Design principles

1. **Trust the group.** Members are friends. Identity is claim-a-name, any member can
   advance a round or remove a movie. The app prevents *accidents* (double votes, early
   reveals), not *malice*.
2. **The group chat is the notification system.** The app never pushes; coordination
   ("go vote!") happens where the group already talks.
3. **Constant per-night effort** (inherited from the voting spec): one optional veto tap
   plus ≤10 pairwise taps, regardless of pool size.
4. **One small server, boring tech.** Tiny data volume; tallies computed on read; SQLite.

---

## Groups & identity

### Creating a group

Anyone visits the landing page, enters a group name, and gets a group. Creation generates
an **invite token** — a long random slug (≥128 bits, URL-safe). The invite link is:

```
https://<host>/g/<invite_token>
```

Knowing the token *is* the authentication. All group data lives behind it. There is no
other credential.

### Joining & claiming identity

Opening the group link on a device without a session shows the **member picker**:

- A list of existing member names — tap yours to claim it.
- "I'm new here" — type a display name (unique within the group) to create a member.

The choice is stored in a long-lived cookie (per group, e.g. `member_<group_id>`), so the
device stays signed in. A new device just repeats the picker. "Not you?" in the settings
screen clears the cookie and returns to the picker.

The cookie **must be set server-side** (HTTP `Set-Cookie`, long `Max-Age`), never via
`document.cookie` or `localStorage` — Safari's tracking prevention caps script-written
storage at ~7 days, which would silently log iPhone members out weekly and read as "the
app forgot who I am".

**Accepted risks (explicitly not defended against):** a friend can pick someone else's
name; anyone with the link can join. This is the intended trade for zero-friction entry.
The safety valve is **regenerate invite link** in group settings (any member): issues a
new token and kills the old URL. Existing device sessions survive regeneration; only the
link changes.

### New-member onboarding

Per the voting spec's cross-cutting rule: if a round is live, a new member lands on the
current round first (RSVP → tonight's flow), with the pool backlog offered as an optional
swipe stack afterwards — never a forced twenty-movie gauntlet before they can participate.

### Group settings (any member can edit)

- Group name.
- Invite link (view / copy / regenerate).
- Voting knobs from the voting spec: `N_FINALISTS` (5), `APPROVAL_FLOOR` (0.5),
  `COVERAGE_FLOOR` (0.6), `VETO_THRESHOLD` (1), `REWATCH_COOLDOWN` (off).
- `MIN_ATTENDEE_VOTES` (3) — the eligibility minimum from the voting spec, exposed as a
  knob because a 3-person group can never satisfy a hard-coded 3 while anyone abstains.
- Member list (rename self; members are never deleted — history references them).

Knob changes take effect at the next finalist computation; they never retro-affect a
round already in `RUNOFF` or later.

---

## Movies

### Suggesting

Suggestion is TMDB-search only:

1. Member types a title; the server proxies TMDB `/search/movie` (API key stays
   server-side).
2. Results show poster, title, year. Tapping one saves the movie with
   `tmdb_id, title, year, runtime_min, poster_path` (runtime fetched from the movie
   detail endpoint at save time — it feeds tiebreak rule 4).
3. Duplicates are blocked per group on `tmdb_id`: suggesting an existing pool movie
   just navigates to it; re-suggesting a *watched* movie follows the re-watch/cooldown
   rule in the voting spec; re-suggesting a *removed* movie restores it (standing votes
   intact).

Suggestions are open at all times — the pool is persistent and independent of rounds.
Movies added while a round is `OPEN` enter it via top-up; movies added later than that
wait for the next round.

### Pool screen

The pool is a browsable list: poster, title, year, runtime, suggested-by, and **the
viewer's own standing vote** (yes / no / not yet seen — three visually distinct states).
Tapping a movie allows revising the standing vote at any time. Aggregate counts are never
shown here (hidden-tallies rule).

Unswiped movies surface as a swipe stack ("3 to swipe") pinned at the top.

### Removing

Any member can remove a pool movie (duplicate, joke, "we saw it elsewhere"). Removal sets
`status = removed` and records who removed it; standing votes are kept so restoring (by
re-suggesting) loses nothing. Removed movies are excluded from eligibility, top-ups, and
coverage denominators. Removal is available from the movie detail view, one confirm tap.

---

## Rounds

At most **one active round per group** (active = any state before `DECIDED`). The round
lifecycle follows the voting spec's state machine, driven manually — suggesting and
swiping happen together in `OPEN` until finalists are computed:

```
OPEN → RUNOFF → DECIDED → WATCHED
        (any state) → ABANDONED
```

**Any member** can create a round and advance it. Every transition is a single labeled
button on the round screen ("Close swiping & pick finalists", "Reveal the winner", …) with
a confirm step, since transitions are one-way.

`ABANDONED` (addition to the voting spec's machine): any member can abandon a round at any
point before `WATCHED` — movie night got cancelled. Abandoning frees the group to start a
new round, discards the round's vetoes/pair votes (standing votes are permanent and
unaffected), and — consistent with the voting spec — does **not** update fairness
counters, which only move on `WATCHED`.

### Attendance (default out)

Creating a round marks nobody as attending. Each member normally RSVPs for themselves —
an in/out toggle at the top of the round screen — but **any member can RSVP anyone**
(trust-based, like everything else). This preserves the voting spec's graceful
degradation: the friend who confirmed in chat but never opens the app can be marked in
by whoever organizes, and their standing votes then count. Proxy RSVPs record who set
them ("in — marked by Ana") so mistakes are visible and reversible.

- RSVP can change any time until the round is `DECIDED`.
- All tallies are computed on read against the *current* attendee set, per the voting
  spec.
- The finalist set is computed once at `OPEN → RUNOFF` from the attendees at that
  moment and is **not** recomputed if attendance changes afterwards; later RSVP-ins can
  still veto and cast pair votes, and RSVP-outs stop counting in the tally.

Because default is out, the round screen shows RSVP status prominently ("4 in, 3 no
answer") and the transition to `RUNOFF` is blocked with an explanatory message while
attendees < `MIN_ATTENDEE_VOTES` — otherwise no movie could be eligible and the round
would end "no clear favourite" for a reason the group can fix in one tap.

### Phase-by-phase behavior

- **OPEN** — round exists; RSVP, suggesting, and swiping all happen here. Attendees with
  unswiped movies see their top-up stack. The transition button shows readiness ("2 of 5
  attendees have unswiped movies"). Any member may close the round to runoff regardless —
  the coverage floor already protects under-seen movies, which simply wait for next
  round.
- **RUNOFF** — computed per the voting spec. If exactly one movie clears the approval
  floor, skip to `DECIDED`; if none, the round ends in a distinct
  `DECIDED`-with-no-winner presentation ("no clear favourite — add suggestions?").
  Otherwise attendees get the veto screen (pre-filled per the voting spec) then the
  pairwise screens, one pair at a time, in per-user shuffled order. Progress
  ("6 of 10 pairs") is per-voter only; no aggregates leak. `runoff_submitted_at` is set
  when a voter finishes their last pair (or passes the veto screen), so "done, chose
  nothing" is distinguishable from "hasn't opened the app".
- **DECIDED** — triggered manually ("Reveal the winner"). The reveal is a moment: winner
  poster full-screen, then the now-public tallies — head-to-head grid, approval numbers,
  vetoes, and which tiebreak rule (if any) decided it, including the seeded-random proof.
  The transition warns if attendees haven't submitted ("2 attendees haven't voted —
  reveal anyway?") but never blocks: friends nag, the app doesn't.
- **WATCHED** — one button on the decided screen ("We watched it 🎬"), typically tapped
  night-of or after. Retires the movie, stamps `watched_at`, updates the fairness
  counter per the voting spec.

---

## Screens

All under `/g/<token>`; the member picker interposes when no session cookie exists.

| Screen | Purpose |
|---|---|
| Landing (`/`) | Create a group; nothing else. |
| Member picker | Claim a name or add yourself. |
| **Round** (home tab) | State-dependent: RSVP bar, phase CTA (swipe / veto / pairs), transition buttons, reveal. |
| Swipe | Full-screen card stack: poster, title, year, runtime; swipe right = yes, left = no; buttons for desktop. Used for top-ups and backlog. |
| Veto | One screen, the finalists as rows, one optional tap, explicit "no veto" submit. |
| Pairwise | Two posters per screen, tap one or "no preference"; progress indicator. |
| **Pool** (tab) | Browsable pool + own standing votes + suggest (TMDB search) + unswiped stack entry + movie detail (revise vote, remove). |
| **History** (tab) | Past nights, newest first: winner poster, date, suggested-by; expandable to the round's full revealed tally. Watched movies also live here. |
| Settings | Group name, knobs, invite link + regenerate, members, "not you?". |

Mobile-first, installable PWA (manifest + icons + theme color). Offline support is not a
v1 requirement; the service worker may cache the shell but every action requires the
network.

Live-ness: **SSE invalidation pings, no websockets.** Because all state is
server-computed and tallies are hidden until reveal, real-time sync never pushes data —
only "something changed, refetch". Each group has an in-process emitter (one Bun server,
so a plain `EventEmitter` keyed by `group_id` is the whole pub/sub); every write action
emits a ping; the client holds an `EventSource` and calls `invalidateAll()` on ping,
debounced. `EventSource` reconnects automatically. The stream sends a keep-alive comment
every ~25 s so proxies don't drop idle connections. Screens also refetch on
focus/visibility change — this covers iOS PWAs, which drop connections when backgrounded.
No polling loop.

---

## Data model

Extends the voting spec's model (which remains authoritative for the voting tables —
notably: `StandingVote` has no round scope, vetoes/pair votes do, and the tables must not
be unified). Everything is group-scoped.

```
Group        { id, name, invite_token (unique, indexed), created_at,
               config: { n_finalists, approval_floor, coverage_floor,
                         veto_threshold, rewatch_cooldown, min_attendee_votes } }

Member       { id, group_id → Group, display_name, created_at }
               -- unique (group_id, display_name); never deleted
               -- replaces the voting spec's User; all user_id refs mean member_id

Movie        { id, group_id → Group, tmdb_id, title, year, runtime_min, poster_path,
               suggested_by → Member, added_at,
               status: pool | watched | removed,
               watched_at, removed_at, removed_by → Member }
               -- unique (group_id, tmdb_id)

StandingVote { member_id, movie_id, value: yes | no, updated_at }
               -- unique (member_id, movie_id); absence = not yet seen

Round        { id, group_id → Group, state: open | runoff | decided | watched |
               abandoned,
               created_at, created_by → Member,
               finalist_ids[], winner_id | null,        -- null in decided = no clear favourite
               tiebreak_rule_used | null, random_seed,
               decided_at, watched_at }
               -- at most one round per group with state < decided (partial unique index)

Attendance   { round_id, member_id, attending: bool, updated_at,
               updated_by → Member,                   -- self, or whoever proxy-RSVPed
               runoff_submitted_at | null }
               -- no row = hasn't answered; attending=false = explicitly out

Veto         { round_id, member_id, movie_id | null, created_at }
               -- unique (round_id, member_id); movie_id null = explicit "no veto"

PairVote     { round_id, member_id, movie_a_id, movie_b_id,
               winner_id | null, created_at }
               -- unique (round_id, member_id, unordered pair); null = no preference

Fairness     { member_id, last_win_round_id, wins_count }
```

All vote writes are idempotent upserts on their unique constraints; the one-veto limit
and pair uniqueness are enforced by the database, not the client (voting spec,
implementation notes). All tallies, eligibility, coverage, and Condorcet/tiebreak logic
compute on read.

---

## API shape

SvelteKit conventions: `load` functions for reads, form actions for transitions and
settings, small JSON endpoints for high-frequency taps.

```
POST /create-group                       → creates group + first member, sets cookie

/g/[token]                               all routes below resolve the group by token,
                                         404 on unknown token; member cookie identifies
                                         the actor, else redirect to picker

POST  claim-member { name | member_id }  → sets cookie
GET   events                             → SSE stream; emits an invalidation ping on
                                           every write in the group, no payload
GET   round                              → current round, my RSVP, my pending work
POST  round/create | advance | abandon | watched
POST  round/rsvp { member_id, attending }  → self or proxy; records who set it
POST  round/veto { movie_id | null }
POST  round/pair { a, b, winner | null }
GET   pool                               → movies + my standing votes only
POST  movies/search { query }            → proxied TMDB search
POST  movies { tmdb_id }                 → suggest (fetches runtime server-side)
POST  movies/[id]/vote { yes | no }      → standing-vote upsert
POST  movies/[id]/remove
GET   history
POST  settings { ... } | settings/regenerate-link
```

Server-side rules the API must enforce (beyond DB constraints):

- Aggregates are **never** serialized to the client before the round is `decided` —
  hidden tallies are enforced at the API layer, not by UI omission.
- Phase-gated writes: vetoes/pairs accepted only in `runoff`, RSVP only before `decided`.
- Transition guards: runoff requires attendees ≥ `min_attendee_votes`; illegal state
  jumps rejected.
- Transitions are **conditional updates** (`UPDATE ... WHERE state = <expected>`): any
  member can advance the round, so two simultaneous taps must resolve to one transition
  and one no-op, never a double-advance or recomputed finalists.
- `Referrer-Policy: same-origin` app-wide — the invite token is in every URL and would
  otherwise leak in the `Referer` header on cross-origin requests (e.g. every poster
  loaded from `image.tmdb.org`). For the same reason, no third-party CDN assets: fonts,
  scripts, and styles are self-hosted.
- Light rate limiting on unauthenticated surfaces (group creation, TMDB search proxy).

---

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | **SvelteKit** (Svelte 5) | SSR + form actions fit the mostly-server-computed model; progressive enhancement means voting works without JS beyond the swipe gesture. |
| Runtime | **Bun** | `svelte-adapter-bun` (or adapter-node run under Bun); built-in `bun:sqlite`. |
| Database | **SQLite** via **Drizzle ORM** (`bun:sqlite` driver) | Typed schema, migrations via drizzle-kit; WAL mode. One file, trivially backed up. |
| Styling | **Tailwind CSS v4** | Mobile-first utilities; posters do most of the visual work. |
| Gestures | Small custom pointer-event handler or a tiny library for the swipe stack | Buttons remain the accessible/desktop path; swipe is enhancement. |
| Movie data | **TMDB API** (free tier) | Server-side key; posters served from `image.tmdb.org`; TMDB attribution in the footer (a condition of the free API). Cache search responses briefly server-side. |

**Deployment:** a single small VPS or Fly.io machine running the Bun server; SQLite on a
persistent volume; nightly snapshot or Litestream replication for backup. No external
services beyond TMDB. HTTPS mandatory (the invite token travels in URLs). If a reverse
proxy fronts the app, disable response buffering on the SSE route (`X-Accel-Buffering:
no` for nginx) or the pings never reach the client.

Testing priority: the tally module (eligibility, coverage, approval, Condorcet,
cycle/tiebreak chain, seeded random) as pure functions with table-driven tests — it's the
part of the app where a silent bug produces plausible-looking wrong winners. Second
priority: the effort-budget invariant from the voting spec (per-round taps constant in
pool size) as an integration test.

---

## Non-goals (v1)

- Notifications, share buttons, deep links into phases — the group chat is the channel;
  people paste the group link themselves.
- Accounts, passwords, email, roles, permissions, moderation tools.
- Streaming availability, ratings/reviews, comments, watch parties, TV series.
- WebSockets, presence ("Ana is voting…"), or live vote animations — SSE invalidation
  pings are the ceiling for v1. The in-process emitter assumes a single server; scaling
  out would need external pub/sub, which is explicitly out of scope.
- Native apps; offline mode.
- Fairness/stats screens beyond history (v2 candidate — the data accumulates regardless).

## Open questions (deferred, not blocking)

- Member avatars/emoji for the picker and history (pure polish).
- Data export (JSON dump per group) if anyone ever asks.
