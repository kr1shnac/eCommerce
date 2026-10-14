# ROADMAP — Kunigal Grocery

**Status:** living document. The CHANGELOG is the record of what was actually
done; this file is the plan and the reasons behind it. When they disagree, the
CHANGELOG is right and this file is stale.

**Last written:** 2026-10-13. See the CHANGELOG for progress against these phases.

---

## 0. The one-paragraph summary

One Expo app, three faces. The same app the customer installs is the app the
rider uses and the app the shop owner uses. Which face you get is decided after
sign-in by `profiles.role`. Kannada and English from the first tap. Cash on
delivery first, Razorpay later. Everything that touches money is decided in
Postgres, never in the app. This is a client project for one shop in one town,
so "works on a ₹8,000 Android phone on a patchy 4G connection" beats "clever".

---

## 1. Why the app, not a website — and the decision, stated plainly

The question was: should the rider and the shop owner use a web page, or should
everything live in the phone app?

**Decision: the app is the product. All three roles live in one mobile app.**

Reasons, in order of weight:

1. **The riders are villagers with Android phones, already in place.** They are
   not sitting at a desk. A rider needs to see "3 orders waiting", tap one, and
   tap "picked up" while standing outside the shop, often with one bar of signal.
   A mobile web page would mean opening Chrome, finding the URL, logging in
   again, and fighting a browser UI. The app keeps them signed in and one tap
   away.

2. **Blinks/Zepto-style features need native modules, not web.** Live rider
   position, a buzz/vibration when a new order lands, and later push
   notifications all need `expo-location`, `expo-notifications` and a background
   task. A web page cannot vibrate reliably, cannot run in the background, and
   cannot draw a live map as smoothly. If we build the rider on the web now we
   throw that work away later.

3. **One codebase, one language switch, one design system.** The theme, the
   Kannada strings, the money formatting and the Supabase client already exist
   `apps/mobile`. Copying them into a web panel doubles every future change.

4. **The customer already trusts the app.** A rider who says "same app, I have
   the rider login" is understood immediately. A separate URL is not.

**What happens to `apps/admin` (the Next.js panel)?**
Keep it, but demote it. It stays as an **optional desktop power-tool** for the
one job a phone is genuinely bad at: mass-editing the catalogue (pasting 200
product rows, bulk price changes, uploading photos). Day-to-day operations —
orders, assigning riders, moving an order along, looking up a customer — happen
**in the app**. The panel is not on the critical path and is not where the owner
will actually live.

This also settles the "one app or three" question: one app. Blinkit and Zepto run
separate rider apps because they have thousands of riders, a dispatcher team, and
a native shell. At 5–6 riders supporting one shop, one app with a role gate is
strictly less to build, less to install, and less to explain.

---

## 2. Who uses this, and how

| Role | Who | Device | What they need most |
| ---- | --- | ------ | ------------------- |
| `customer` | Villagers in and around Kunigal | Their own phone | Order milk/rice in under a minute, in Kannada, pay cash |
| `delivery` | The 5–6 existing riders | Their own phone | See what to pick up, claim it, mark it delivered, call the customer |
| `admin` | The shop owner (+ maybe one helper) | Their own phone, sometimes a PC | Watch orders arrive, assign riders, fix a price/stock, add a product |

**Rule of the whole design: the app decides what to *show*, the database decides
what is *allowed*.** Every screen is a courtesy. The permission is RLS plus guard
triggers in Postgres.

---

## 3. Designing for a village customer (this is the part that decides success)

The single biggest risk on this project is not technology — it is that a customer
opens the app, gets confused, and never opens it again. Concrete rules, not
aspirations:

### 3.1 Kannada is not a translation, it is the default path
- If the phone's language is Kannada, the app starts in Kannada. English is the
  fallback, not the default.
- **Every** customer-visible string is written in Kannada as Kannada — not copied
  from English, not a word-for-word rendering. This is **done** as of 2026-10-13:
  all 251 keys have real Kannada values (rule 9.5 and §10). The *voice* is
  specified separately in **`KUNIGAL.md`**, which is the source of truth for any
  wording argument.
- The voice is **the shop's own helper in Kunigal**: spoken plain old-Mysuru
  Kannada, respectful `ನೀವು`, the town's own loanwords kept (`ಆರ್ಡರ್`, `ಬಿಲ್`,
  `ಡೆಲಿವರಿ`, `ರೈಡರ್`) and the shop words kept (`ಸಾಮಾನು`, `ಬುಟ್ಟಿ`, `ಸಂತೆ`), not
  Sanskritised calques nobody says out loud. `KUNIGAL.md` §4 is the glossary the
  build obeys.
- Product and category names already carry `name_kn` in the database; the app
  always reads through `localizedName()`.
- No English-only strings in any `.tsx`. A machine check enforces this (§10.4).

### 3.1a Designing for Kunigal specifically (facts, not vibes)
`KUNIGAL.md` documents the town from the public record and turns each fact into a
design rule. The load-bearing ones:
- **Literacy ≈ 69%** (women 64%). Roughly one adult in three cannot comfortably
  read a full sentence, so **icons and numbers must carry meaning** on their own;
  text is short; Kannada is never rendered smaller than English.
- **Kannada-first, not a language toggle we tolerate.** Kannada is the default
  path for this town.
- **Cash economy, low order values.** COD is the primary method; UPI next; a card
  is never assumed.
- **Farming / market life.** `ಸಾಮಾನು`, `ಸಂತೆ`, `ಕೆರೆ` are familiar words;
  `ಉತ್ಪನ್ನ`, `ವರ್ಗೀಕರಣ` are not.
- **One shop, one town, 5–6 riders.** The phone *is* support, so "Call the shop"
  is a real feature, not a dead end.
- **Patchy 4G** on the Bengaluru–Mangaluru highway and in the hoblis: offline
  reading and safe retries matter more than a clever animation.

### 3.2 One-thumb, big-target UI
- Minimum tap target **48×48 dp** (project rule says 44; use 48 for the village
  build because hands are big, phones are cheap, and screens are small).
- Primary action is always a **big labelled button at the bottom**, not a small
  icon in a corner. "Add", "Checkout", "Place order", "Picked up", "Delivered".
- Icons never stand alone without a Kannada label underneath.

### 3.3 The fewest possible steps to a first order
- Home → tap item → tap "Add" → cart → checkout → done. No sign-in wall before
  browsing. Sign-in is only asked for at checkout, and only once.
- Remember the last delivery address per phone so repeat orders are two taps.
- **Reorder**: from the Orders tab, one tap puts a past order back in the cart.
  This is the highest-value feature for repeat customers and is cheap to build on
  top of the snapshot data we already keep.

### 3.4 Money must never surprise anybody
- Prices, delivery fee, minimum order and stock are shown plainly and in the
  customer's language.
- Cash on delivery is the default and is explained in one line at checkout
  ("You will pay cash when your order is delivered" — already translated).
- Custom Kannada numerals are **not** used (everyone reads Arabic numerals on
  price tags and phones); but Indian digit grouping `₹1,23,456` is kept.

### 3.5 Work on a bad connection
- Offline banner: **built** (`@react-native-community/netinfo` → `use-network.ts`
  → `components/offline-banner.tsx`, one translated banner, not a modal per
  request). Safe retries: **built** (idempotency keys, rule 9.4).
- **Not built:** a *persisted* catalogue. Right now the TanStack Query cache is
  in-memory only, so a cold start with no signal renders the loading/error state,
  not last-known prices. To finish this rule the query client needs an
  async-storage persister. Tracked in the gap audit (§14).
- Never a white screen. Every screen has loading / empty / error-with-Retry
  (rule 9.2).

### 3.6 Trust and help, in the customer's language
- **Built:** a "Call the shop" button (`support.call`) on the Order screen and the
  Account screen, reading `store_settings.support_phone` and opening `tel:`
  (`components/call-shop.tsx`). For a one-street shop the phone is the support
  desk, so this is a first-class action, not a mailto link.
- **Built:** a 4-step order tracker a non-reader can follow by icon, with a
  spoken-status Kannada label under each step: `ಆರ್ಡರ್ ಆಗಿದೆ → ಸಿದ್ಧವಾಗಿದೆ →
  ದಾರಿಯಲ್ಲಿ → ಮನೆ ಸೇರಿದೆ` (Placed → Packed → On the way → Delivered).

---

## 4. The three faces of the app

### 4.1 Customer face — `src/app/(tabs)/`
Already largely built: Home (catalogue), Cart, Orders, Account.

| Feature | State | Phase |
| --- | --- | --- |
| Browse categories + products, EN/KN | Built | — |
| Add/remove cart, live price + stock check | Built | — |
| Checkout with address, COD, note | Built | — |
| Order placed + order detail + cancel | Built | — |
| Live order updates (Realtime) | Built | 3 |
| Order tracker (icons, 4 steps) | Built | 2 |
| Reorder a past order | Built | 2 |
| Search on Home (name + category, in memory) | Built | 2 |
| Cart tab badge (item count) | Built | 2 |
| "Call the shop" button (order + account) | Built | 2 |
| Store-closed notice on Home | Built | 2 |
| Address-aware "delivering to" pill | Built | 2 |
| `expo-image` for product photos | Built | 2 |
| Sign-in with phone OTP | Built | — |
| Saved addresses list + default + edit/delete | Built | 2.5 |
| Product detail page (tap a card) | Built | 2.5 |
| Favourites ("Saved for later" rail) | Built | 2.5 |
| "Buy again" rail from order history | Built | 2.5 |
| Offers rail on Home + coupon at checkout | Built | 2.5 |
| Razorpay (online payment) | **Missing** | 5 |
| Push notifications ("order out for delivery") | **Missing** | 4 |
| Live rider position on a map | **Missing** | 6 |

### 4.2 Rider face — `src/app/(rider)/` (new)
The rider sees a **work list**, not a shop.

- **Waiting** — orders placed and not yet claimed. Big cards, sorted oldest
  first, with pincode + area, item count, total to collect in cash, and a
  **Claim** button.
- **My deliveries** — orders claimed by me, grouped by status.
- **Order detail** — address (with a **Call** button and a **Copy of address**),
  the item list, the cash to collect, and **one** next-step button
  ("Start packing" → "Out for delivery" → "Delivered").
- **Delivered today** — a simple count + list, so a rider can see their day.
- Self-claim is the default (fastest for a small team). The owner can reassign
  or unassign from the admin face (see §5). No rider may touch an order assigned
  to somebody else — enforced by a trigger, tested against real Postgres.

### 4.3 Admin face — `src/app/(admin)/` (new)
Owner-first, phone-first. The web panel is not required for any of this.

- **Board** — every order as a column/list by status, newest first, with a
  coloured "waiting too long" hint (e.g. placed > 20 min with no rider).
- **Assign / reassign rider** — pick a rider from a list; also "unassign".
- **Order detail** — everything the customer sees, plus status controls and the
  ability to cancel.
- **Team** — list of profiles; change a person's role between customer / rider /
  admin (guarded by `profiles_guard_role`). This is how the owner turns a new
  phone number into a rider account without touching SQL.
- **Today** — orders count, collected-cash total, most-ordered items.

### 4.4 The role gate
`src/app/_layout.tsx` asks the database for the signed-in user's `profiles.role`
and routes:
- not signed in → the shop is still browsable; face = customer.
- `customer` → `(tabs)`.
- `delivery` → `(rider)`.
- `admin` → `(admin)` (with a link to switch to the customer view for testing).

Role is **never** stored in the app as an authority. It is read from
`profiles`, and RLS/triggers enforce it. If the app lies about the role, the
database refuses anyway.

---

## 5. Order lifecycle (the heart of the app)

```
placed ──► confirmed ──► packing ──► out_for_delivery ──► delivered
  │
  └──► cancelled   (customer, only while still `placed`; or admin, any time before delivered)
```

Rider assignment rides alongside the status, not inside it:

- `orders.assigned_to` (uuid → `auth.users`) and `orders.assigned_at`.
- A rider **claims** an unassigned `placed`/`confirmed` order: set
  `assigned_to = me`, `assigned_at = now()`.
- A rider may only advance **their own** order, and only forward.
- The owner may assign, reassign or unassign at any time.

This is enforced in `orders_guard_update` (a trigger), because RLS can say
"which rows" but not "which columns, in which direction". A test proves a rider
cannot touch another rider's order.

**Notifications:** the moment an order is `placed`, the waiting-list of every
rider must update. This is **built** (Phase 3): **Supabase Realtime** (a
websocket — no native module, works in Expo Go) pushes the change, and a
signed-in rider's phone also buzzes and shows a banner. Realtime enforces RLS, so
each subscriber is delivered only the order rows their policies allow. Phase 4
adds a real push notification (`expo-notifications`) for when the app is closed.

---

## 6. Technology — the stack stays, and here is why

**Keep: Expo + React Native + TypeScript + Supabase (Postgres + Auth + RLS +
Realtime + Storage).**

- Blinkit is built on React Native. Zepto is built on React Native (Kotlin/Swift
  native shell + RN screens). The stack is not the limitation at this scale; the
  distance from the shop is.
- Expo gives us OTA updates (fix a bug without asking anyone to reinstall),
  one codebase for Android + iOS, and the free tier is plenty.
- Supabase gives us Auth (phone OTP), Postgres, RLS (the permission model),
  Realtime (the live rider feed) and Storage (product photos) with no servers to
  run.

**Where the app must leave Expo Go and use an EAS development build:**
push notifications, the Razorpay SDK, maps, and background location. Phases 1–3
(all of the order + rider workflow + Realtime) work in Expo Go; phases 4–6 need
a dev build. This is scheduled, not accidental.

**Rejected:** Kotlin-only (Android only — we need iOS too, and the customer base
is not guaranteed Android-only forever); Flutter (rewrite for no gain); KMP
(two UI toolkits for one app); a separate rider app (see §1).

---

## 7. Data model additions (each is a migration + a test, rule 9.7)

Already present: `stores, profiles, categories, products, addresses,
delivery_zones, store_settings, orders, order_items`.

Additions, in build order:

1. **Rider assignment** (Phase 1)
   - `orders.assigned_to uuid references auth.users(id) on delete set null`
   - `orders.assigned_at timestamptz`
   - index `(assigned_to, status)` and `(status, placed_at)`.
   - New guard rules in `orders_guard_update`.
2. **Push tokens** (Phase 4)
   - `device_tokens (user_id, expo_token, platform, updated_at)`.
3. **Rider location** (Phase 6)
   - `rider_locations` (latest position + `updated_at`) or Postgres Realtime
     broadcast; a history table only if we later need routes.
4. **Payments** (Phase 5)
   - `payments (order_id, provider, provider_order_id, provider_payment_id,
     amount_paise, status, created_at)`; `orders.payment_method = 'online'` is
     already allowed by the enum.

Nothing in this list changes an existing column's meaning, so it is all
append-only migrations.

---

## 8. Phase plan

Each phase ends the way rule 9.10 demands: `npm run typecheck` clean, `npm run
lint` clean, DB tests re-run and passing, and a dated CHANGELOG entry. A phase is
not "done" because code was written; it is done when it is proven.

### Phase 0 — Housekeeping (do first, cheap, unblocks everything)
- Lint green (admin `no-explicit-any` + `set-state-in-effect`; mobile warnings).
- All missing i18n keys added (there are already **live bugs** where the app
  shows a raw key like `orders.noItems` to a customer).
- i18n parity + usage checker wired into the repo so this can never regress.
- Docs told the truth (AGENTS.md §7, README).

### Phase 1 — Order engine + rider + in-app admin
- Migration: rider assignment columns, index, guard rules; test file.
- Role gate in the root layout.
- `(rider)` group: waiting list, claim, my deliveries, order detail, advance
  status.
- `(admin)` group: board, assign/reassign, team roles.
- `rider.*` / `admin.*` strings in EN + KN.
- Deliverable: an order can go placed → delivered entirely inside the app.

### Phase 2 — Customer polish — **mostly DONE (2026-10-13)**
- Order tracker (icons, 4 steps): **built** (`order/[id].tsx`, `order.step.*`).
- Reorder a past order: **built** (order detail + Orders list, via
  `cartStore.replaceAll` — prices are re-read live and stock re-checked, never
  copied from the old order). A repeat customer can now reorder in two taps.
- Home search: **built** (name + category filtered in memory over the active
  catalogue, `useProducts(null)`).
- Cart tab badge: **built** (`selectCartCount`, `tabBarBadge`).
- Also built while here: "Call the shop", store-closed notice, address-aware
  "delivering to" pill, `expo-image` for product photos.
- **Still open:** nothing blocking. Saved-address management is now **built**
  (see Phase 2.5).

### Phase 2.5 — Customer depth — **DONE (2026-10-14)**
- **Product detail** (`src/app/product/[id].tsx`): tap any card to open a page
  with the large image, unit, price/MRP, discount and Add to cart. Kept
  deliberately short — no DB `description` column, because a thin machine
  translation would be worse than none (KUNIGAL.md).
- **Favourites** (`20261014000002_favourites.sql`, `use-favourites.ts`): a
  `(user_id, product_id)` heart, own-rows RLS, optimistic toggle with rollback.
  Feeds a "Saved for later" rail on Home.
- **"Buy again" rail**: derived from the customer's order history at render time,
  no new table, so it can never drift from what they actually bought.
- **Address management** (`20261014000003_address_one_default.sql`): list, edit,
  delete and choose-default. One default per user is enforced by a partial unique
  index plus `set_default_address(uuid)`, not by the app.
- **Offers + coupons** (`20261014000004_coupons.sql`): `coupons` table,
  `coupon_discount()` (the single copy of the arithmetic), `validate_coupon()`
  for the checkout preview, `active_offers()` for the Home rail, and a 6th
  `p_coupon_code` argument on `place_order()`. The app sends only the **code**;
  the discount, floor, cap and minimum all come from Postgres (rule 9.1). Uses
  are counted once, after the order row is written, with the coupon row locked
  `for update` — a replayed request never counts twice.
- Tests: `13_favourites`, `14_address_default`, `15_coupons` (all against real
  PostgreSQL).

### Phase 3 — Realtime — **DONE (2026-10-13)**
- Supabase Realtime subscription: rider waiting list updates live; customer
  order screen updates live; admin board updates live.
- In-app vibration + banner on a new order (rider only).
- Works in Expo Go. No native module.
- Shipped as: `supabase/migrations/20261013000002_realtime_orders.sql`
  (`orders` added to the `supabase_realtime` publication),
  `supabase/tests/10_realtime_publication_test.sql`, and
  `apps/mobile/src/hooks/use-realtime-orders.tsx` (one channel per signed-in
  user; invalidates the shared `['orders', ...]` query prefix). A 60-second poll
  remains only as a safety net for a dropped socket.

### Phase 4 — Push notifications
- `expo-notifications` + `device_tokens` + an Edge Function on order insert.
- Requires an EAS development build. Customer gets "out for delivery"; riders
  get "new order".

### Phase 5 — Razorpay
- Online payment as a second method beside COD. Order is only placed after the
  server verifies the signature; `payments` table; `payment_status` transitions.
- Requires an EAS development build (Razorpay RN SDK).
- COD stays the default — most Kunigal customers will use it.

### Phase 6 — Live tracking
- `expo-location` background updates from the rider, a map on the customer's
  order screen, ETA from the delivery zone.
- Requires an EAS development build and a maps API key.

---

## 9. Performance (the "like Blinkit/Zepto" ask)

- **Lists**: `FlatList` with a stable `keyExtractor` (the row `id`). The
  catalogue and rider list get `FlashList` once the item counts justify it.
- **Images**: `expo-image` (already a dependency) with explicit `width`/`height`
  or `aspectRatio`, memory+disk cache, and a low-cost placeholder. The app
  currently uses React Native `<Image>` in places — migrate to `expo-image`.
- **Data**: TanStack Query everywhere, with sensible `staleTime`; the catalogue
  is cached so a bad connection still renders.
- **Queries**: never `select('*')` on a big table without a limit; the rider
  board is one query with a covering index.
- **Re-renders**: select only the Zustand fields a component needs (already the
  pattern); stabilise callbacks; `extraData` when list output depends on
  something outside `data`.
- **Bundle**: nothing heavy ships until its phase. No maps SDK until Phase 6.

---

## 10. Language (Kannada + English), concretely

1. **The raw-key bugs are fixed** (Phase 0, 2026-10-13): every literal the app
   renders exists in both locale files, so no screen shows `orders.noItems` or a
   similar raw key any more.
2. **The Kannada is real Kannada** (2026-10-13): all 251 keys have genuine Kannada
   values, written to the voice in **`KUNIGAL.md`** — the shop's own helper, plain
   spoken Kannada, the town's loanwords kept. The values are deliberately **not**
   mirror images of the English; where the English was clumsy the Kannada reads
   better (and, in one case, the English was fixed to match: `home.errorHint` no
   longer says "Supabase" to a customer).
3. **Key parity is a build gate.** `scripts/check-i18n.mjs` asserts `en.json` and
   `kn.json` have exactly the same key set, that every `t('...')` key used in
   `src/` exists in both, that dynamic families are covered, that no Kannada value
   is a copy of the English, and that every placeholder is single-brace word form.
   It runs as part of `npm run lint` (and standalone as `npm run check:i18n`).
4. **No hard-coded customer text.** Enforced by the same script (it scans for
   obvious English string literals in JSX).
5. **DB text** always goes through `localizedName()` / `localizedItemName()`.
6. **Voice is a rule, not a preference.** A new string is written by finding the
   situation in `KUNIGAL.md` §4 and saying it out loud as the shop assistant; a
   new situation adds a row there **with its reason** before the string ships.

---

## 11. Security (unchanged, restated because it is easy to break)

- The app holds only `EXPO_PUBLIC_SUPABASE_URL` and the publishable/anon key.
- Never the `service_role` key, anywhere in the app or the repo.
- RLS is enabled on every table; a new table with no policy is invisible, which
  is the safe default.
- Role is enforced by `profiles_guard_role`; money by generated columns, CHECK
  constraints and `place_order()`; order mutations by guards. The app's job is
  to explain, not to decide.
- Every new policy ships with a test that proves the **forbidden** case fails.

---

## 12. Open decisions, with the default chosen (no more asking)

1. **Web panel: keep or drop?** → **Keep as an optional desktop tool, demoted.**
   The app is where daily work happens.
2. **Rider claim: self-claim or admin-assign?** → **Self-claim, with admin
   override.** Fastest for a small team; the owner can always take over.
3. **COD or online first?** → **COD only until Phase 5.** It removes an entire
   class of failure from the launch.
4. **One app or three?** → **One app, three faces.** Decided in §1.
5. **Numerals in Kannada?** → **Arabic numerals** (matches price tags in the
   shop). Indian digit grouping stays.

---

## 13. Definition of done (per phase, per §9.10 of AGENTS.md)

1. `npm run typecheck` — zero errors, both apps.
2. `npm run lint` — zero errors, zero warnings.
3. `npm run check:i18n` — parity + no raw keys.
4. `npm run test:db` — all assertions pass against real PostgreSQL; new
   policies/guards have new tests.
5. A dated CHANGELOG entry: what changed (by path), what was **verified and
   how**, decisions + reasons, bugs found, open gaps.

If any of these cannot be run, the CHANGELOG says so explicitly instead of
claiming the phase is done.

---

## 14. Gap audit — things known to be missing or unproven

This is the honest list, so a future session does not have to rediscover it. It
is *maintenance*, not a wish list: each row is either a real customer-facing gap,
a claimed-but-not-built feature, or a launch blocker.

### 14.1 Launch blockers (must be done before a real store build)
- **`android.package` / `ios.bundleIdentifier` are not set** in
  `apps/mobile/app.json`. An EAS build (needed for Phases 4–6) cannot be created
  without them.
- **Nothing has ever run on a device or emulator.** Every claim in the CHANGELOG
  is type-checked, linted, or tested against PostgreSQL — *none* has been seen on
  a screen. The first device run must exercise: sign-in (OTP), browse → cart →
  checkout → place order, the rider claim → advance flow, the Realtime update + a
  buzz, search, reorder, and the Kannada rendering. Until then "works" means
  "compiles and is unit-tested".
- **No error monitoring / crash reporting.** There is no Sentry (or equivalent)
  and no analytics. In a shop where the owner cannot read a stack trace, a silent
  crash is invisible. The pasted "SKF System Bot" logs earlier in this project's
  history are exactly the kind of thing a real crash reporter would surface; the
  app currently has no equivalent. Candidate for a small Phase 0.5.

### 14.2 Features the ROADMAP claims but that are not built
- **Persisted offline catalogue.** §3.5 used to claim last-known prices render
  offline; corrected. The query cache is in-memory only — needs an async-storage
  persister.
- **Saved-address management.** Built in Phase 2.5 (list, edit, delete,
  choose-default; `supabase/migrations/20261014000003_address_one_default.sql`).
- **Admin "Today" totals.** §4.3 lists an orders count, collected-cash total and
  most-ordered items. The board and team screens exist; **the money/today summary
  does not.** For a cash business the "how much did I collect today" number is
  arguably the owner's most-wanted screen.
- **Admin product/category edit in-app.** §4.3 implies the owner can fix a price
  or stock in the app. Today that is only possible in the demoted Next.js panel,
  not on the phone the owner actually carries.

### 14.3 Product features deliberately not built (and where they are planned)
- **Product detail screen.** Built in Phase 2.5 (`src/app/product/[id].tsx`).
  Deliberately omits a long description: there is no DB column for one, because a
  thin machine-translated Kannada paragraph would read worse than none.
- **Sign-in wall timing.** Browsing is open; sign-in is asked at checkout only —
  as planned (§3.3), listed here so it is not mistaken for a gap.
- **Razorpay (Phase 5), push notifications (Phase 4), live rider map / background
  location (Phase 6)** — all require an EAS development build; none is started.

### 14.4 Accessibility / Kunigal-specific gaps (see `KUNIGAL.md` §8)
- **No text-to-speech / voice.** With literacy ≈ 69%, voice guidance is the
  single biggest unfilled accessibility gap for *this* town. Not built, not
  scheduled. This is the strongest candidate for a Kunigal-specific differentiator.
- **The Kannada voice has not been reviewed by a Kunigal local.** It is written in
  plain old-Mysuru Kannada by the build; a native read-through should happen
  before launch (wording may shift with zero code change, since every string is a
  key).

### 14.5 Housekeeping / correctness
- `apps/mobile/src/components/placeholder-screen.tsx` appears unused after the
  real screens landed — verify and delete if dead.
- `common.off` (`"{percent}% off"` / `"{percent}% ರಿಯಾಯಿತಿ"`) is currently unused;
  the product card renders its own `"{off}%"` badge. Either wire it up or delete
  it.
- `expo-localization` is now imported nowhere (Kannada is the hard default, §3.1a).
  Leave it for a future "follow the device" option, or drop it with
  `npx expo install --fix`.
- `apps/admin` is a skeleton kept only for bulk catalogue edits; it has no tests.
  Its typecheck can trip on stale `.next/types` output (delete `apps/admin/.next`
  and `tsconfig.tsbuildinfo` if so).
