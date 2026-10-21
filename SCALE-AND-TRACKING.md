# SCALE-AND-TRACKING.md — how this app looks, performs and scales, and how a rider is tracked

**Status:** draft, 2026-10-20. **Authority:** for *how the app improves after it
works*, this file wins. `PRODUCTION.md` still owns "how we get to a public
release" and its register is still the item list; `AGENTS.md` owns the rules,
`KUNIGAL.md` the language, `DESIGN.md` the visuals. Where this file and
`PRODUCTION.md` disagree about a fact, this one is newer — but check the date,
because this is written against the repository as it stands today.

**Why this file exists.** A request came in: compare the app to Blinkit and
Zepto, find where the look, the speed, the refresh behaviour, the concurrency
and the scalability can be improved, and design — in detail — how a rider's
location is captured, shown to the customer, and drawn as a route. That is four
different questions and each has a different right answer *for this shop*, which
is one shop on one street. They are answered in §3 (look), §4 (speed), §5
(scale) and §6 (tracking).

**The one idea that governs everything below.** Blinkit and Zepto are the wrong
model to copy, and copying them is the most likely way to spend real money on
the wrong thing. They are dark-store networks running at a scale — 125,000
orders per day for one of them `[EXTERNAL]` — where every optimisation pays for
itself a hundred thousand times a day. Kunigal is one shop with a delivery
radius measured in streets and a target of *one order a day to prove it works*.
A mechanism that is correct at Blinkit's scale can be actively harmful here:
push notifications to a rider's phone every three seconds is a battery
emergency in a town with patchy power, and a live map that streams at 1 Hz is a
data plan the customer is paying for out of ₹49 of rice. So each section below
says, explicitly, **what Blinkit does** and **what this shop should do instead**
— and in several places the answer is "nothing, deliberately".

---

## 0. How to read this file

Same three marks as `PRODUCTION.md`:

| Mark | Means |
| --- | --- |
| `[VERIFIED]` | Read out of this repository, or run on this machine, in this session. The evidence is named. |
| `[EXTERNAL]` | Checked against a live public source in this session. The source is named. Re-check before relying on it. |
| `[UNVERIFIED]` | A belief that was *not* confirmed this session, or a claim that cannot be settled without a device, an account or a measurement. Treat it as a hypothesis with a verification step. |

The section that matters most is §6, because it is the only one whose answer is
mostly **new code**, and because tracking a person's location is the one thing in
this whole app that can hurt a human being if it is built carelessly.

---

## 1. The scale we are actually designing for

Numbers, not adjectives. Everything in §4, §5 and §6 is sized against this table
and nothing else.

| Quantity | Today | Pilot (goal) | Realistic ceiling for one shop in Kunigal | Evidence |
| --- | --- | --- | --- | --- |
| Shops | 1 | 1 | 1–3 | `[VERIFIED]` seed has one `stores` row |
| Products | 34 | ~40 | a few hundred | `[VERIFIED]` `supabase/seed.sql` |
| Categories | 8 | 8 | ~15 | `[VERIFIED]` |
| Orders / day | 0 | 1–5 | ~50–100 at a very good festival day | `[UNVERIFIED]` estimate, owner to confirm |
| Riders online at once | 0 | 1–3 | ~5 | `[UNVERIFIED]` |
| Customers with the app open at once | 0 | 1–10 | a few hundred on a festival morning | `[UNVERIFIED]` |
| Delivery radius | — | one town | ~3 km | `[UNVERIFIED]`, `delivery_zones` exists |
| Peak orders / minute | 0 | <1 | ~5 | `[UNVERIFIED]` |

**The binding constraint is not the database.** A Postgres row change is
microseconds. The constraints are: (a) how many *simultaneous websocket
connections* the Supabase plan allows, (b) how many *messages per second* the
plan allows, and (c) what a cheap Android phone can do with a live map while a
call is coming in. §5 and §6 are shaped by (a), (b) and (c) in that order.

---

## 2. How Blinkit and Zepto actually work (and why we are not them)

Facts gathered for this file. Sources are named and dated; this is a fast-moving
area and these will age.

| Fact | Source | Mark |
| --- | --- | --- |
| Blinkit was Grofers, acquired by Zomato/Eternal in 2022 for US$568M; operates in 153 cities as of March 2025 | Wikipedia "Blinkit" | `[EXTERNAL]` |
| Grofers was delivering ~125,000 orders/day by November 2021 | Wikipedia "Blinkit" (Moneycontrol cite) | `[EXTERNAL]` |
| Zepto: 1,000+ dark stores by 2026, ₹9,366 crore revenue (2025), ~16,898 employees (Mar 2026) | Wikipedia "Zepto (company)" | `[EXTERNAL]` |
| Both verticalised: they run **their own** dark stores, not a partner shop. Zepto explicitly tried the kirana-partner model (as KiranaKart) and it "did not gain traction" | Wikipedia "Zepto (company)" | `[EXTERNAL]` |
| Blinkit/Zepto have faced repeated regulatory action (FSSAI raids, municipal fines, dark-pattern criticism) at their scale | Wikipedia, both articles | `[EXTERNAL]` |
| Supabase Realtime limits: **Free** 200 concurrent connections / 100 msg/s; **Pro** 500 / 500; **Pro (no spend cap)** 10,000 / 2,500 | Supabase Realtime Limits docs, read 2026-10-20 | `[EXTERNAL]` |
| Supabase Postgres Changes payload cap 1,024 KB, above which `new`/`old` include only fields ≤64 bytes | Supabase Realtime Limits docs | `[EXTERNAL]` |
| Realtime filters are evaluated server-side (`eq`, `in` up to 100 values, `ilike`, …), so filtered-out events never leave the database | Supabase Postgres Changes docs | `[EXTERNAL]` |
| Over-limit errors are named: `too_many_channels`, `too_many_connections`, `too_many_joins`, `tenant_events` (auto-reconnect once throughput falls) | Supabase Realtime Limits docs | `[EXTERNAL]` |

### What this means for Kunigal — the three real lessons

1. **They are a fulfilment network; we are a shop's phone that happens to have
   an app.** Their whole product is the dark store + the routing engine. Ours is
   *replacing one phone call*. Every feature below is judged by "does this make
   the call unnecessary", not "does this match Blinkit".
2. **Their scale justifies costs we cannot pay.** A live 1 Hz GPS stream with a
   turn-by-turn map on the customer's screen is, for them, a rounding error. For
   this shop it is a data bill and a battery drain on a phone the customer also
   uses to receive the rider's call. §6 designs the **degraded-first** version:
   works on 2G, works with the screen off, works if the map never loads.
3. **Their regulatory pain is a warning, not a template.** FSSAI raids and
   municipal fines are what happens when you scale food logistics faster than
   your compliance `[EXTERNAL]`. The FSSAI/GST/Legal-Metrology deliverables
   already listed in `PRODUCTION.md` §14 are the cheap version of the same risk,
   and they stay client deliverables.

**What we *should* copy from them, honestly:** the storefront discipline — a
front page that shows the basket's progress constantly, a delivery-time promise
that is *believable* rather than aspirational, and a rider face + call button on
the tracking screen. Those three are already partly built (§3, §6). Everything
else they do is a function of their scale.

---

## 3. The look — where the UI can improve

The design system (`DESIGN.md`, `src/constants/theme.ts`) is already good and
this section does **not** propose re-theming it. It proposes a short list of
*specific screens and moments* where the current build is weaker than the plan
it was written against, ordered by how much a real customer would notice.

Grounded in the screens as they stand `[VERIFIED]` by reading
`src/app/(tabs)/index.tsx`, `src/app/order/[id].tsx`, `src/app/product/[id].tsx`.

### 3.1 The five changes worth making

| # | Where | What is weak today | What to change | Cost |
| --- | --- | --- | --- | --- |
| UX-1 | Home hero (`index.tsx` lines ~200–222) | The hero shows the greeting, the ask, the delivery area and the ETA, but the ETA is a small badge and the shop's closed/open state is a separate card below. On a phone held at arm's length the *most important* fact — "can I order right now and when will it come" — is not the biggest thing on the screen. | Make the hero's primary line the **promise** ("ರಾತ್ರಿ 8 ಗಂಟೆಗೆ ಬಾಗಿಲಿಗೆ" / delivers by 8 pm), with the ETA and open/closed folded into that one line, and demote the greeting to a caption. One claim, big. | Small — `index.tsx` only |
| UX-2 | Terminal-bad order states (`order/[id].tsx`) | `StatusRow` already refuses to draw a half-filled tracker for `cancelled`/`failed`/`returned` (lines 433–441) — good. But the enclosing card's title is the generic `order.trackTitle` ("Delivery status", `en.json` line 367), so a failed order sits under a heading that promises tracking. | Give the status card a **state-aware heading** (`order.trackTitlePlaced`, `…Failed`, …) so a failed order's card is titled truthfully. Small, but it is the sentence a worried customer reads first. | Small, needs keys in both locales |
| UX-3 | Product screen (`product/[id].tsx`, 304 lines) | Pack chips ("also in 1 kg") exist but sit at their own price with no visual tie to the base price. A customer who reads slowly cannot tell whether 1 kg costs more per gram or less. | On each pack chip, show the **per-unit price** and a tiny "cheaper per kg" / "costlier per kg" word, computed from integers via `src/lib/pack.ts`. Highest-trust change on the product page, and it is pure arithmetic, no new data. | Small–Medium, needs `check:packs` additions |
| UX-4 | Checkout (`checkout.tsx`) | **Already strong** and should not be "fixed" blindly: the total uses the big `price` type (lines 372–375) and the address card already leads with the landmark (`near ${landmark}`, line 542) `[VERIFIED]`. | Only worth doing if a device review shows the *"pay ₹X in cash at delivery"* line (key exists: `checkout.payAtDelivery`, line 355) reads as an afterthought. Verify on a device before touching it. | Verify first, then decide |
| UX-5 | Loading everywhere | `LoadingState` is a spinner. On a 2G connection a spinner for 6 seconds reads as "broken". | Replace the spinner with a **skeleton of the actual layout** (grey product-card shapes) on Home and the order screen. `expo-image` is already a dependency; the skeleton is plain views. This is the change that most affects perceived speed (§4) at near-zero risk. | Small–Medium |

### 3.2 What NOT to do

- **Do not add a bottom navigation item or a promotional carousel.** Blinkit's
  home is dense because it sells thousands of SKUs; a 34-product shop with three
  rails already has more sections than products in some of them.
- **Do not animate the hero or add motion for its own sake.** On a cheap phone,
  every animation is a dropped frame that makes the app feel *slower*, not
  faster.
- **Do not re-theme.** The green/marigold, warm-paper palette is deliberately
  chosen in `theme.ts` for this town and is not improved by being made more
  "app-like".

---

## 4. The speed — refresh rate, round trips, perceived latency

"Refresh rate" is three different things and they must be separated, because
they have three different fixes:

1. **Server refresh** — how fresh the data in Postgres is. Irrelevant here;
   writes are already authoritative and immediate.
2. **Client refresh** — how quickly the app *learns* about a change. This is
   Realtime + TanStack Query's `staleTime`. `[VERIFIED]` `src/hooks/use-catalog.ts`
   sets `staleTime: 60_000` on catalogue; `src/lib/query-persistence.ts` sets a
   global 60 s `staleTime` and a 7-day persisted cache.
3. **Perceived refresh** — how fresh the screen *looks*, which is dominated by
   whether there is a skeleton, a spinner, or stale-but-plausible content on
   first paint.

### 4.1 What the app does today `[VERIFIED]`

- Home fetches `categories`, `products`, `store_settings`, `store`, `zones`,
  `addresses`, `favourites`, `orders`, `offers` — **up to nine queries on one
  screen**, several gated on sign-in. The catalogue itself is one `select *`
  over a 34-row table.
- The whole shelf is fetched once and filtered in memory (documented in
  `index.tsx` lines 42–54). Correct at this size.
- The persisted cache is an **allowlist** of `categories`, `products`, `product`
  — so shelves survive a cold start offline. Good.
- Order screens refetch on a Realtime event (doorbell pattern) and every order
  query shares the `['orders']` prefix `[VERIFIED]` `use-realtime-orders.tsx`.

### 4.2 The round-trip problem, named

On a cold start, before the customer can *do* anything, the app issues up to
nine GETs. On 2G each is a separate TLS setup and a separate round trip; nine of
them in parallel is fine on wifi and miserable on one bar. **This, not the
database, is what "slow" means here.** `[UNVERIFIED]` — no cold-start timing has
been measured on a device; this is the reasoning, and §7 says how to prove it.

### 4.3 Fixes, in order

| # | Fix | Effect | Risk |
| --- | --- | --- | --- |
| PERF-1 | **Render persisted shelf immediately, then refresh.** Already partly done; make it explicit with `initialData` from the persister and never block first paint on a network call for public shop data. | Removes the spinner entirely on a warm device; the single biggest perceived-speed win | Low |
| PERF-2 | **Skeletons instead of spinners** (UX-5). | Turns a 6 s wait from "broken" into "loading" | Low |
| PERF-3 | **Raise `staleTime` for public shop data** from 60 s to e.g. 5 min, and rely on Realtime for freshness where it matters (orders). The catalogue does not change second-to-second. | Removes redundant refetches on tab switches | Low |
| PERF-4 | **Defer the non-critical queries.** `offers`, `zones`, `favourites` can load after first paint rather than in parallel with the shelf. | Fewer critical-path round trips | Low |
| PERF-5 | **One `shop_bootstrap()` RPC** returning store + settings + zones in a single call, replacing three GETs. | −2 round trips on every cold start | Medium (new RPC + test) |
| PERF-6 | **Currency/units formatting** — already a pure function (`money.ts`), never a fetch. Confirm no screen formats money inside a render loop over many rows. | Avoids jank | Low, check only |

**Do not** reach for an edge cache, a CDN, or a service worker. The payloads are
tiny and the problem is round-trip count, not bytes or origin load.

---

## 5. The scale — concurrency, hit rates, what breaks first

### 5.1 Where the app's concurrency comes from `[VERIFIED]`

Every signed-in client opens **one** Realtime channel
(`orders:${userId}`, `use-realtime-orders.tsx` line 71) subscribed to
`postgres_changes` on the whole `orders` table, unfiltered. On any order write,
Realtime evaluates RLS per subscriber and delivers to those allowed to see the
row, and each such client then fires a REST refetch.

### 5.2 The arithmetic against the real limits

Supabase Realtime on **Free** allows 200 concurrent connections and 100
messages/second; **Pro** 500 / 500; **Pro with no spend cap** 10,000 / 2,500
`[EXTERNAL]` (Supabase docs, read 2026-10-20).

Worked example at the *realistic ceiling* (§1: say 100 orders/day, 5 riders,
300 customers with the app open on a festival morning):

- Connections: 305. **Exceeds Free (200), inside Pro (500).** → The pilot must
  be on a **paid plan**, or connections will be refused with
  `too_many_connections` `[EXTERNAL]`.
- Message volume: each order write fans out to every client allowed to see that
  row. A customer sees only their own order; **riders and admins see all of
  them.** So one order status change ≈ 1 (customer) + R (riders) + A (admins)
  messages. At 5 riders, 10 status changes per order, 100 orders/day:
  ≈ 100 × 10 × 6 ≈ **6,000 messages/day**, i.e. ~0.07 msg/s average. **Nowhere
  near 500/s** even on the worst minute.
- The refetch storm is the real cost: each delivered event triggers one REST
  refetch per receiving client. 6,000 events/day × ~1 row each is trivial for
  Postgres; the risk is *one busy minute* (say a batch of status updates) causing
  a burst of simultaneous refetches. At this scale it is still trivial.

**Verdict `[INFERENCE]`:** the current design does not break until roughly
**two orders of magnitude above the realistic one-shop ceiling**, and the first
thing to break is **connections on a free plan**, not messages or queries.

### 5.3 What to change anyway (cheap, removes the sharp edges)

| # | Fix | Why |
| --- | --- | --- |
| SCALE-1 | **Put Realtime filters on the subscription** so a customer's channel only asks for `user_id=eq.<me>` — Realtime evaluates `eq` server-side `[EXTERNAL]`, so events for other people's orders never even reach the customer's socket. | Cuts customer-side message volume to ~0 and makes the "doorbell" honest. Riders/admins still need the wide stream, or a filtered one on `assigned_to`. |
| SCALE-2 | **Keep every index the screens need.** Review `[VERIFIED]` list: `orders_waiting_idx`, `orders_assigned_idx`, `orders_status_placed_idx`, `orders_user_id_idx`, `orders_store_id_idx`, `orders_status_idx`, `products_store_sort_idx`, partial `orders_failed_idx`. Add anything a new tracking query needs *in the same migration as the query*. |
| SCALE-3 | **Partial indexes for the hot predicates**, e.g. tracking reads only rows with a recent fix. Never index a column just because it exists. |
| SCALE-4 | **Explicit connection budget in the runbook**: know which Supabase plan the pilot is on and what its connection/message ceiling is, and monitor Realtime logs. | The failure mode is silent-ish (`too_many_connections`) `[EXTERNAL]`. |
| SCALE-5 | **Do not hold a socket open for a signed-out user.** Already true (`use-realtime-orders.tsx` line 68) — keep it. | Free connection budget. |
| SCALE-6 | **Give the 60 s poll a backstop role only**, as the code comments already say, and never add a second poll. | Two polls is two storms. |

### 5.4 Hit rates

"Hit rate" here means: of the requests a client makes, how many are answered from
cache without going to the network. Today `[VERIFIED]`: catalogue cached 7 days
on disk + 60 s in memory; orders never cached (correct — they are personal);
product detail cached. The improvement is **PERF-3** (raise catalogue
`staleTime`) plus **PERF-4** (defer junk). There is no cache-hit problem to
solve beyond that; do not build a cache layer for nine small GETs.

---

## 6. Tracking a rider — the detailed design

This is the part that is mostly not built. It is designed **before** any map SDK
is chosen, deliberately: the data path and the privacy rules do not depend on
which map we draw later, and choosing the map first is how projects end up with
a map that cannot be removed for slow phones.

### 6.1 What the customer actually needs (and does not)

The customer is standing in a courtyard with one bar of signal, waiting for a
bag of groceries, on a phone they also use to take the rider's call.

They need, in this order:
1. **Is it coming, and roughly when?** — a time and a state, not a dot.
2. **Who is bringing it, and can I call them?** — **already built** (`RiderCard`,
   `rider_directory`).
3. **Where are they right now?** — nice to have, and *only* meaningful if it is
   honest. A stale dot is worse than no dot, because the customer will walk to
   the road and wait.

They do **not** need turn-by-turn navigation, a 3D map, or a second-by-second
dot. Blinkit's customers do not need it either; it is a trust signal, not a
navigation aid `[INFERENCE]`.

### 6.2 The data path, step by step

```
rider phone                 Postgres                         customer phone
-----------                 --------                         --------------
location permission
  ↓ (only while an order
     is out_for_delivery
     and assigned to me)
GPS fix
  ↓ throttled by rule (§6.4)
write via one RPC:  ───►  rider_positions (one row per rider, upsert)
   record_my_position(        · rider_id  (auth.uid(), never a param)
     lat, lng, accuracy,      · lat/lng    (numeric, no float money concerns here)
     recorded_at)             · accuracy_m
                              · recorded_at
                              · order_id (nullable, the order being delivered)
                                ↓
                         security definer view / RPC
                         returns ONLY {lat, lng, age, eta} to
                         the customer of an active order
                                ↓                    ───► Realtime (or 30 s poll)
                                                     on the customer's order screen
                                                     renders text + optional map
```

### 6.3 Why the shape above (the decisions, and their reasons)

- **One row per rider, not a trail.** A history table grows without bound and is
  a surveillance record of an employee. We need the *current* position; the past
  is only needed for disputes and can be a deliberate, bounded later addition.
  `upsert` on `rider_id`.
- **The RPC takes no rider id.** Same rule as `set_my_name()` and
  `delete_my_account()`: it acts on `auth.uid()` only, so no client can write a
  position for somebody else. Non-negotiable, and testable.
- **Only while delivering.** We do not track riders when they are idle. This is
  both a privacy rule and a battery rule. Enforcement: the RPC refuses unless the
  caller has an order in `out_for_delivery` assigned to them `[VERIFIED]` shape
  matches `guard_order_update`'s delivery branch.
- **The customer sees a derived value, not the raw row.** The customer gets
  `{lat, lng, age_seconds, eta_minutes}` for *the rider on their order*, through
  a narrow view or `security definer` function — never a direct `select` on
  `rider_positions`. Same discipline as `rider_directory` (migration
  `20261021000001`), which exposes four columns and no more.
- **ETA is computed on the server, not the client.** Straight-line distance from
  the rider to the delivery landmark, divided by a conservative speed, floored
  at "a few minutes". The client must never compute a number it then shows as a
  promise (§4 of `AGENTS.md`, rule 9.1's spirit: the server owns the number).
- **Realtime is optional here, polling is the baseline.** Given §5.2, the design
  *works* on a 30 s poll and *improves* with Realtime. A fresh-enough dot every
  30 s is honest ("updated 20 s ago" can be shown); a dot that pretends to be
  live and is 4 minutes old is a lie. **Show the age.**

### 6.4 Throttling — how often a position is written

| Condition | Write interval | Reason |
| --- | --- | --- |
| Rider has no active delivery | never | privacy + battery |
| Rider moving (speed > ~2 m/s) | every 20–30 s | a dot that moves at this cadence is enough for "is it coming" |
| Rider stationary (not moving) | every 2–3 min | nothing is changing; saves battery |
| Screen off / app backgrounded | **stop**; write one final "last seen" | background GPS is the battery killer `[UNVERIFIED]` needs a device test |
| Customer's order screen open | no change to *writes*; may poll faster | the throttle is on the rider, not the viewer, so the customer cannot cause a storm |

The throttle rule is **pure logic** and belongs in a `src/lib/tracking-rules.ts`
module with a `check:tracking` script — exactly the pattern used for
`speech-rules.ts`, `order-view.ts` and `pack.ts`, because those modules cannot
import native code under Node `[VERIFIED]` precedent.

### 6.5 The map — the vendor-agnostic decision

**Decision: design the screen so the map is replaceable and optional, and do not
pick the SDK until the tracking phase starts.**

Three renderings of the same data, in increasing cost:

1. **Text only (baseline, must never be removed).** "Ravi is about 1.2 km away ·
   ~7 min · updated 20 s ago" + the existing call button. Works on 2G, works with
   maps blocked, works on any phone, costs nothing. **This is the pilot version.**
2. **Static route line (middle).** A single image (server-composed or a static
   map URL) showing the shop → rider → landmark line. No pan, no zoom, no tiles
   streamed. Cheap and honest.
3. **Live map (last).** `react-native-maps` (Google) or an HTML/MapLibre view,
   rendered only when the customer taps "show on map" — never the default, never
   auto-loading. This is the only option that needs an API key, native config,
   and a data budget conversation with the owner.

**Route indication** = the polyline from the rider's current position to the
delivery landmark. Note the honest limitation: we do not have road geometry
without a routing API `[UNVERIFIED]` whether a free routing service is
acceptable — so the pilot draws a **straight line** and labels it as a direction,
not a path. Drawing a fake road route is exactly the sort of confident lie
`PRODUCTION.md` §2 is built to avoid.

### 6.6 The privacy and safety rules (non-negotiable)

Tracking a person's location is the riskiest thing in this app. Rules:

1. **Consent, in Kannada, before the first fix**, explaining: tracked only while
   delivering, who can see it, and how to stop (turn off the order). Not a wall
   of text — one screen, in the rider's language.
2. **The rider's position is visible to the customer of the active order and to
   the owner, and nobody else.** Enforced in the database, not the app.
3. **Positions expire.** `recorded_at` older than ~10 minutes is *not shown at
   all* rather than shown as current. A stale point is removed from view.
4. **Nothing is persisted beyond the current position** in v1. No trail, no
   history, no analytics on where riders went.
5. **Deleting the rider's account deletes their position row** (cascade), like
   `delete_my_account()` already handles the rest (migration `20261020000001`).
6. **The 60 s benchmark rule from `AGENTS.md`:** this feature ships with a
   migration, a test, and a DB-proven forbidden case (a rider cannot write
   another rider's position; a customer cannot read a position for an order that
   is not theirs; a customer cannot read a position after the order is delivered).

### 6.7 What is deliberately NOT built

- No background location when no order is active. No "rider is online" map for
  the owner. No route optimisation. No geofencing. No history. Each of these is
  a real product for a real company; none of them is needed to replace one phone
  call in Kunigal, and every one of them has a privacy or a battery cost.

---

## 7. The honest gaps and how to close them

Nothing in §3–§6 has been proven on a device. That is the whole point of listing
it here rather than claiming it is done.

| Gap | How to close it | Owner |
| --- | --- | --- |
| Cold-start round-trip count and time are `[UNVERIFIED]` (no device available on this machine) | Measure with the app on a real cheap Android on 2G throttled; count requests in the dashboard | Dev (needs device) |
| Realtime connection ceiling is reasoned, not measured | Know the Supabase plan; watch Realtime logs during the pilot | Dev + client |
| No map SDK chosen | Decide when the tracking phase starts; text-first means this can wait | Dev + client |
| Background-location battery behaviour `[UNVERIFIED]` | Device test with the rider build | Dev (needs device) |
| Whether a free routing API is usable `[UNVERIFIED]` | Check licence + quota before drawing any road route | Dev |
| Rider consent wording in Kannada | New strings in both locales, signed off per `KUNIGAL.md` | Dev + owner |
| The 60 s poll and the tracking poll must not double | One timer, one owner; assert in a check script | Dev |

---

## 8. The build order (what to do, in sequence)

Cheapest and highest-value first, and the tracking work gated behind the parts
that make it honest.

| Phase | Work | Gate |
| --- | --- | --- |
| T0 | UX-1, UX-2, UX-5 (look + skeleton) | typecheck, lint, visual check on device |
| T1 | PERF-1…PERF-4 (perceived speed) | cold-start timing on device |
| T2 | SCALE-1 (Realtime filters) + SCALE-4 (plan/limits noted) | DB tests + Realtime log check |
| T3 | `src/lib/tracking-rules.ts` + `check:tracking` (pure logic, no native) | lint, check:tracking — **DONE 2026-10-21**, see `CHANGELOG.md` |
| T4 | `rider_positions` table + `record_my_position()` + narrow read view + migration + **test with forbidden cases** | `npm run test:db` |
| T5 | Rider consent screen (both languages) + write throttle wired to the rule module | device test |
| T6 | Customer text-first tracking block on `order/[id].tsx` (age + distance + ETA) | device test |
| T7 | Optional static route image, then optional live map, behind a tap | owner's data-budget decision |

**Every phase ends the same way**, per `AGENTS.md` §9.10: `npm run typecheck`
passes, `npm run lint` passes, `supabase/tests/` passes against real PostgreSQL,
and a dated `CHANGELOG.md` entry says what was verified and how. Phase T4 in
particular is not done until a test *proves* the forbidden cases fail.

---

## 9. Client/owner decisions this file creates

Distinct from `PRODUCTION.md` §14, and all of them the owner's or the client's,
not the developer's.

1. **Supabase plan.** The pilot needs at least Pro for the Realtime connection
   ceiling (§5.2). Who pays, and which plan?
2. **Data budget.** If a live map is ever shown, whose data plan pays for it —
   the customer's or the shop's? (Text-first is the default for this reason.)
3. **Rider phones.** Do riders supply their own phone, and will they accept
   location sharing while delivering? The consent screen needs a real answer.
4. **Rider tracking hours.** While delivering only, or also "on shift"? This
   file assumes *while delivering only*; the owner must confirm.
5. **Map provider and its cost**, when and if the live map is built.
