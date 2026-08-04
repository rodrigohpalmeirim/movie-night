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
   (none where the group has vetoes off) plus ≤10 pairwise taps, regardless of pool size.
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

- A list of existing member names — tap yours to claim it. Removed members are not listed.
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
  `COVERAGE_FLOOR` (0.6), `VETOES_ENABLED` (on), `VETO_THRESHOLD` (1),
  `REWATCH_COOLDOWN` (off). That is the complete set: eligibility is the coverage floor
  alone, so there is no minimum-swipes knob (an absolute floor on the raw vote count only
  ever locked small groups out — see the voting spec's Eligibility section).
  `VETOES_ENABLED` is the one boolean, so it is the one knob drawn as a latched On/Off
  pair rather than a number; the numeric knobs are sliders, printing their current value
  beside the label, except `REWATCH_COOLDOWN`, which stays a written-in field because
  blank means "never" and a range input has no way to say that.
- Member list (rename self; remove and restore members — but never delete them, because
  history references them).

Knob changes take effect at the next finalist computation; they never retro-affect a
round already in `RUNOFF` or later.

### Removing a member

People leave groups. Any member can remove any member (there are no roles here, and this
is the same trust the proxy RSVP already assumes), **including themselves** — leaving the
group is a thing a person does for themselves. Every removal is reversible by anyone, from
the same screen.

Removal is soft: it stamps `removed_at`, and the voting spec's *Removed members* rule
("removed members leave the present, not the past") governs what that means for tallies.
In app terms:

- The member disappears from the member list, the round screen's participant list, the
  picker, and the RSVP controls. They cannot be RSVPed in, by themselves or by proxy.
- Their standing votes and stars are kept and stop counting; their suggestions stay in the
  pool, still credited to them by name; history still names them.
- A device whose cookie points at a removed member resolves as *unclaimed* and lands on
  the picker — the same fallback as a stale cookie, never an error. Removing yourself
  therefore drops you back to the picker on the spot. Restoring the member makes that
  cookie work again, since nothing was deleted.
- A removed member still holds their display name: `unique (group_id, display_name)` is
  untouched, so claiming or adding that name reports it as **taken** and points at restore.
  There is deliberately no name-reuse machinery — restore is the way back.
- The restore path is a member action like any other, and restoring counts every kept
  vote again, exactly as it was.

---

## Movies

### Suggesting

Suggestion is TMDB-search only:

1. Member types a title; the server proxies TMDB `/search/movie` (API key stays
   server-side).
2. Results show poster, title, year. Tapping one saves the movie with
   `tmdb_id, title, year, runtime_min, poster_path` (runtime fetched from the movie
   detail endpoint at save time — it feeds tiebreak rule 4), plus the cached `details`
   blob the same call returns (Movie details, below).
3. Duplicates are blocked per group on `tmdb_id`: suggesting an existing pool movie
   just navigates to it; re-suggesting a *watched* movie follows the re-watch/cooldown
   rule in the voting spec; re-suggesting a *removed* movie restores it (standing votes
   intact).

Suggestions are open at all times — the pool is persistent and independent of rounds.
Movies added while a round is `OPEN` enter it via top-up; movies added later than that
wait for the next round.

### Movie details

The detail call is `GET /movie/{tmdb_id}?append_to_response=videos,credits,release_dates`
— **one** request, which is why the extras are free: the runtime lookup was already
being paid for. What is kept, cached on the movie row as a single `details` JSON blob:

- `tagline`, `overview`, `genres` (names)
- `certification` — the age rating for `$CERT_COUNTRY` (default `PT`), falling back to
  `US`, then to the first country TMDB has a non-empty rating for
- `directors`, and the top ~5 billed `cast` as `{ name, character }`
- `trailer_key` — a **YouTube video id only**. Preference: official Trailer, then any
  Trailer, then official Teaser; YouTube-hosted only. It is rendered as a plain link to
  `youtube.com/watch?v=…` in a new tab. No embedded player: the app talks to exactly one
  third-party origin (`image.tmdb.org`) and that rule does not bend for an iframe.

Every field is nullable or empty-able and every section renders only when it has
content — TMDB has all of this for a blockbuster and none of it for an obscurity. The
extras add **no** failure mode to suggesting: a payload missing all of them, or shaped
in a way nobody predicted, still saves the film with an empty blob. (An outright TMDB
outage blocks the suggestion exactly as it always did, because that is the call the
runtime comes from.)

**Caching and lazy backfill.** `details_fetched_at` stamps every *attempt*, successful
or not. Rows that predate the feature (or whose fetch failed) are filled in by the reads
that need them — the swipe deck, a movie's detail screen, the pool list — which fetch
what they are missing, cache it on the row and serve it in the same response. Three
brakes: at most a few films per page load, no retry inside a six-hour window after a
failed attempt, and no two concurrent reads fetching the same film. A film that TMDB has
deleted therefore costs one request per window rather than one per page load, and a
group that predates the extras warms up as it is used instead of in a batch. Once
fetched, details are never refreshed: they are facts about a finished film.

These are public facts and touch no tally, so they are serialized with the movie
wherever it appears and carry no phase gate.

### Pool screen

The pool is a browsable list: poster, title, year, runtime, suggested-by, and **the
viewer's own standing vote** (yes / starred yes / no / not yet seen — visually distinct
states; a star is an upgraded yes, per the voting spec). Tapping a movie allows revising
the standing vote, and starring or unstarring it, at any time. Aggregate counts are never
shown here (hidden-tallies rule). The detail screen also prints the cached TMDB
details — tagline, rating badge, genre chips, story, director, top cast — and a
prominent "Watch trailer" link when there is one.

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
*nobody* is in — otherwise no movie could be eligible (coverage divides by the attendee
count) and the round would end "no clear favourite" for a reason the group can fix in one
tap. One attendee is enough; nothing here scales the requirement with group size.

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
  nothing" is distinguishable from "hasn't opened the app". Where the round's frozen
  knobs say `vetoes_enabled: false` the veto step does not exist: the round screen's CTA
  goes straight to the pairs, a veto write is refused, the veto screen redirects there,
  and "finished" means the pairs alone — so a voter can complete a runoff that has no
  veto to record.
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
| Swipe | Full-screen card stack: poster, title, year, runtime, genres · rating; swipe right = yes, left = no, plus a star affordance for an upgraded yes; buttons for desktop. A ⓘ corner turns the card over to a printed back (tagline, story, director, cast, trailer link); a drag turns it face up again and carries on. Used for top-ups and backlog. |
| Veto | One screen, the finalists as rows, one optional tap, explicit "no veto" submit. Absent where the round was frozen with vetoes off — the route redirects to the pairs rather than dead-ending. |
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
                         vetoes_enabled, veto_threshold, rewatch_cooldown } }
               -- blobs written before `min_attendee_votes` was retired may still
                  carry that key; reads ignore it and the next save drops it
               -- blobs written before `vetoes_enabled` existed lack that key;
                  reads fill it in as true, so an existing group keeps its veto

Member       { id, group_id → Group, display_name, created_at, removed_at | null }
               -- unique (group_id, display_name); never deleted
               -- removed_at set = left the group: hidden from the member list and
                  the picker, cannot be RSVPed, excluded from the electorate and
                  every coverage denominator; votes/stars kept, restorable; still
                  holds its display name, so the unique index still bites
               -- replaces the voting spec's User; all user_id refs mean member_id

Movie        { id, group_id → Group, tmdb_id, title, year, runtime_min, poster_path,
               details: { tagline, overview, genres[], certification,
                          directors[], cast[{ name, character }],
                          trailer_key } | null,        -- cached TMDB extras, one blob
               details_fetched_at | null,              -- last ATTEMPT, success or not
               suggested_by → Member, added_at,
               status: pool | watched | removed,
               watched_at, removed_at, removed_by → Member }
               -- unique (group_id, tmdb_id)
               -- details null = never fetched successfully; the lazy backfill
                  retries on a later read, outside the retry window

StandingVote { member_id, movie_id, value: yes | no, starred: bool, updated_at }
               -- unique (member_id, movie_id); absence = not yet seen
               -- starred = an UPGRADED yes (voting spec, Phase 1 → Stars);
                  starred with value "no" is not a representable state

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
POST  movies { tmdb_id }                 → suggest (one server-side detail call:
                                           runtime + the cached details blob)
POST  movies/[id]/vote { value?, starred? }  → standing-vote upsert; `starred` is
                                           the star flag on a yes (star ⇒ yes)
POST  movies/[id]/remove
GET   history
POST  settings { ... } | settings/regenerate-link
      settings members: rename self, remove member, restore member (form actions)
```

Server-side rules the API must enforce (beyond DB constraints):

- Aggregates are **never** serialized to the client before the round is `decided` —
  hidden tallies are enforced at the API layer, not by UI omission.
- Phase-gated writes: vetoes/pairs accepted only in `runoff`, RSVP only before `decided`.
  A veto is additionally refused when the round's frozen knobs have vetoes off — the
  round's own snapshot decides, never the group's current setting.
- Transition guards: leaving `OPEN` or `RUNOFF` requires at least one attendee — a
  decision needs a non-empty electorate, and it is not configurable; illegal state
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
| Movie data | **TMDB API** (free tier) | Server-side key; posters served from `image.tmdb.org`; TMDB attribution wherever their data is used — the suggest sheet, plus a permanent line on Settings (a condition of the free API). Cache search responses briefly server-side; cache the per-movie details blob on the row, and lazily backfill it (Movies → Movie details). `$CERT_COUNTRY` picks which country's age rating is kept. |

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
