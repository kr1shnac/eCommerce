# Build log

Newest first. Append a dated section after each working session, and be honest in
it: what was verified and *how*, decisions with their reasons, bugs found, and
the gaps you know about. A future session reads this file first.

---

## 2026-10-14 — Phase 2.5: customer depth (product page, favourites, addresses, offers + coupons)

*(second session of the day; the entrance below is the morning's design-system work)*

### What changed and why

Phase 2.5 was the "make the customer face feel complete" pass: five small
features, each built so the **database stays the authority** and both languages
ship together. No new native module, so everything still runs in Expo Go.

**Product detail** (`apps/mobile/src/app/product/[id].tsx`)
- Tap any card to open a page with the large image, unit, price/MRP, discount
  and Add to cart; a heart sits in the corner. `useProduct` + `catalogKeys.product`
  added to `use-catalog.ts`; `product-card.tsx` rewritten so the card opens the
  page and the Add pill stays its own tap target.
- Deliberately **no long description**: there is no DB `description` column,
  because a thin machine-translated Kannada paragraph would read worse than none
  (KUNIGAL.md is the voice authority).

**Favourites** (`20261014000002_favourites.sql`, `use-favourites.ts`,
`components/favourite-button.tsx`)
- A `(user_id, product_id)` heart, own-rows RLS — the same shape as `addresses`.
  `useToggleFavourite` is optimistic and rolls back cleanly on error. The ids
  feed a **"Saved for later"** rail on Home.

**"Buy again" rail** (`(tabs)/index.tsx`)
- Built from the customer's own order history at render time, newest first,
  still-on-the-shelf only. **No new table**, so it can never drift from what they
  actually bought.

**Address management** (`20261014000003_address_one_default.sql`, `addresses.tsx`,
`address.tsx`)
- List, edit, delete and choose-default. "One default per user" is enforced by a
  **partial unique index** plus `set_default_address(uuid)` (security-invoker,
  ownership checked before clearing the old default) — not by the app. Deleting
  the default promotes another address.

**Offers + coupons** (`20261014000004_coupons.sql`, seed coupons, checkout UI)
- `coupons` table (codes matched case-insensitively, money in paise, descriptions
  in both languages). Three verbs, each one source of truth:
  - `coupon_discount(coupon, subtotal)` — the **only** copy of the arithmetic:
    percent floored, capped by `max_discount_paise`, never more than the subtotal;
    flat = its value.
  - `validate_coupon(store, code, subtotal)` — read-only preview for checkout,
    returning `{ok, code, discount_paise, descriptions}` or a typed refusal
    (`coupon_not_found`, `coupon_inactive`, `coupon_not_started`,
    `coupon_expired`, `coupon_used_up`, `coupon_min_order`, `empty_code`,
    `not_logged_in`).
  - `active_offers(store)` — marketing-safe live codes for the Home rail, granted
    to `anon` too, so a visitor sees the deal before signing in.
- RLS: admin-only policy on `coupons`; customers reach codes **only** through the
  functions, never by selecting the table.
- `place_order` re-created with a 6th `p_coupon_code text default null` (the old
  5-arg signature is dropped first so PostgREST cannot pick the wrong overload).
  The app sends **only the code**; the discount is recomputed in the database. Use
  is counted once, **after** the order row is written, with the coupon row locked
  `for update`, so a replayed request never counts twice. `orders.coupon_code` is
  added, and `guard_order_update()` now freezes it for riders and cancelling
  customers.
- Checkout: `useValidateCoupon`, apply/remove UI, and the discount shown in the
  totals. A code is bound to the basket it was checked against — if the basket
  changes the code is treated as **stale** and dropped with a translated note.
  That is **derived state, not an effect** (see the lint note below). Home gets an
  offers rail driven by `active_offers`.

**i18n.** New `favourite.*`, `product.*`, `address.*` management, `home.buyAgainTitle`,
`home.savedTitle`, `home.offersTitle`, `home.offerMin`, and the whole
`checkout.coupon*` family were added to **both** `en.json` and `kn.json`.
`localizedDescription()` joins `localizedName()` / `localizedItemName` so a coupon's
`description_en`/`description_kn` follows the language switch like every other DB
string.

### Verified, and how
- `npm run typecheck` — both apps, exit 0.
- `npm run lint` — eslint in both apps, **0 problems**.
- `npm run check:i18n` — **336 keys in both languages**, 232 used literals, 7
  dynamic families; no missing plural or brace form.
- `npm run test:db` — throwaway PostgreSQL 16, **332 assertions, 0 failures**,
  including three new files:
  - `13_favourites_test.sql` — own-rows RLS (a second user cannot see or delete
    another's heart), PK prevents duplicates.
  - `14_address_default_test.sql` — the partial unique index refuses a second
    default; `set_default_address` moves it; deleting the default leaves exactly
    one.
  - `15_coupons_test.sql` — the floor, the cap, the minimum, the case-insensitive
    match; a signed-out visitor cannot validate; a customer cannot `select` the
    codes; an order placed with a code stores it and the discount; **replaying the
    same idempotency key does not count a second use**; an unknown or used-up code
    writes no order; a flat coupon never discounts more than the basket.

### Decisions and their reasons
- **Coupon arithmetic lives in one SQL function.** The checkout preview and the
  order total call the same code, so the number shown can never disagree with the
  number charged (rule 9.1).
- **A coupon is a code + a store, not a client-supplied discount.** `orders`
  stores the code and the resolved paise; neither is accepted from the app.
- **Stale coupon is derived, not an effect.** The first version cleared an
  applied code in a `useEffect`, which the repo's `react-hooks` config rejects
  ("setState synchronously within an effect"). The fix stores the subtotal the
  code was checked at and computes staleness during render — no cascading render,
  and no dependence on effect ordering.
- **Buy again is derived** from order history rather than a new table, so there is
  nothing to keep in sync.
- **One default address is a database rule** (partial unique index + function),
  not a convention the app must remember.

### Bugs found (and fixed) while building this
- The re-created `place_order` in the coupons migration had **simplified** the
  `items_unavailable` payload to `product_id` + `reason`. The existing
  `02_place_order_test.sql` asserts the richer payload (`name_en`, `name_kn`,
  `unit`, `requested`, `available`); restored the exact shape.
- The re-created `guard_order_update()` was first written from memory and **broke
  rider assignment** (test 09). Replaced with a verbatim copy of the definition
  from `20261013000001_rider_assignment.sql`, adding only the two `coupon_code`
  freeze lines. Lesson: never re-derive a long guard by hand; copy it and diff.
- Test 15: two idempotency keys did not match, so the "replay" case created a real
  second order and exhausted stock; and a boolean was passed to
  `test_result.eq` (only `text`/`bigint` overloads exist) — switched to
  `test_result.ok`.

### Open gaps
- **Product photos are still emoji.** The `expo-image` slots exist, but there is
  no Storage bucket or admin upload yet; that is a later phase.
- **No admin UI for coupons.** Codes are created in SQL/seed today; the owner
  cannot add one from the app.
- **Noto Sans Kannada is still not bundled**, so Kannada uses the device font.
- `apps/admin` remains an optional bulk-edit skeleton.
- Nothing in this session was run on a physical device; verification is
  typecheck + lint + i18n + 332 database assertions against real PostgreSQL.

---

## 2026-10-14 — The UI/UX overhaul: a design system, light + dark, and data so every face looks alive

*(first session of the day)*

### What changed and why

The brief was blunt: the app worked but looked "basic". This session rebuilt the
**look** without touching the architecture (Expo + Supabase + RLS stay exactly as
they were), and then loaded enough **fake data** that the customer, rider and
owner faces can all be seen *working* instead of showing empty states. Three
things drove every decision: a small town where **one in three adults cannot
comfortably read**, a real **light/dark** need, and a shop that should feel warm
rather than corporate.

**A real design system, not a coat of paint.**
- `apps/mobile/src/constants/theme.ts` — rewritten as the single source of truth:
  a **light** palette (cream page `#FFFBF3`, white cards, leaf-green `#0F7B3E`,
  marigold `#E8890C`, ink `#221B12`) and a **dark** palette (charcoal `#14110C`,
  cards `#1E1A13`, green `#4ED08A`, marigold `#F4B24A`). Added `Type`, `Radii`
  and `Elevation` scales so screens stop hard-coding numbers.
- Contrast audit (WCAG AA, done by hand against every real pair) found three
  **soft-tint failures** — a bright fill used as text on its own pale tint. Fixed
  by adding honest `*Ink` tokens meant only for text: `secondaryInk #9A5A00`,
  `successInk #0F6B3A`, `warningInk #8A5200`, `dangerInk #9E2B20` (dark themes use
  the bright tone as ink). **The rule, now written in DESIGN.md: a bright colour
  is only ever a solid fill; `*Ink` is for text on a `*Soft` background.**
  Marigold is never used as text on cream — it only reaches 2.55:1.
- `DESIGN.md` (new) documents the palette with its contrast table, the type and
  spacing scales, the light/dark rules, the accessibility floor, and the
  performance rules. It is the reference the next screen is built against.

**Modern, but the *right* modern.** Chose a **Material Design 3 (Material You)
foundation** — tonal surfaces, big rounded shapes, clear elevation — combined
with an **Indian quick-commerce layout** (sticky basket bar, category rails, a
two-column product grid, one-tap Add). Rejected glassmorphism/blur and
neo-brutalism: both read as "tech demo" and both fight low-literacy readability.
Green means *you can act*; marigold means *offer*.

**Light and dark, the customer's choice.**
- `apps/mobile/src/store/theme-store.ts` (new) — a persisted Zustand store for
  **System / Light / Dark**, default **System**, saved on the device with
  AsyncStorage, and `isReady` so the first paint is never the wrong theme.
- `apps/mobile/src/hooks/use-theme.ts` — now exports `useResolvedScheme()` (what
  System currently *is*) and `useTheme()` (the palette to draw with).
- `apps/mobile/src/app/_layout.tsx` — builds the navigation theme from the
  palette, holds the splash until `authReady && themeReady`, and keeps the
  `Stack.Protected` role gate untouched.
- `apps/mobile/src/components/ui/theme-switch.tsx` (new) — a three-way control in
  Account and a one-tap `ThemeToggle` for the Home header.

**New primitives so screens share one language.**
- `apps/mobile/src/components/ui/` (new): `button.tsx` (variant/size/busy), 
  `card.tsx` (`flat`/tone), `badge.tsx`, `section-header.tsx`, `icon-button.tsx`,
  `theme-switch.tsx`. Redrawn: `product-card.tsx`, `category-chip.tsx`,
  `quantity-stepper.tsx`, `add-to-cart.tsx`, `state-message.tsx`,
  `offline-banner.tsx`, `language-switch.tsx`, `call-shop.tsx`, `themed-text.tsx`.

**Every screen rebuilt on the new system.**
- Customer: `(tabs)/index.tsx` (Home — brand bar + theme toggle, search, rails,
  2-col grid, **sticky basket bar** showing "N items · ₹X → View basket"),
  `(tabs)/cart.tsx`, `(tabs)/orders.tsx` (status badges + All/Active/Done
  filters + Reorder), `order/[id].tsx` (badge header + tracker + Card sections),
  `(tabs)/account.tsx` (profile card, Appearance, Language, Call shop),
  `checkout.tsx`, `login.tsx`, `address.tsx`.
- Staff: `rider/index.tsx` (three stat tiles: waiting / mine / done today, status
  badges, Call + one "next step" button), `admin/index.tsx` (Live / Waiting /
  Delivered tiles, rider assignment chips, status badges), `admin/team.tsx`
  (per-person role segmented control).
- Tab bars restyled: `(tabs)/_layout.tsx`, `admin/_layout.tsx`.

**Fake data, so the faces are judged full.**
- `supabase/demo.sql` (new, dev-only, re-runnable) — creates **8 orders** across
  every status (2 waiting, 1 confirmed, 1 packing, 1 out for delivery, 2
  delivered, 1 cancelled) with 24 real line items, assigns some to the **first
  `delivery` profile**, and gives the customer a Kunigal address (PIN **572130**)
  only if they had none. Totals are computed by Postgres from the real product
  prices — nothing is typed in by hand (rule 9.1).
- Demo orders are identifiable on purpose: `order_number` is `KNG-D0001…` and
  `idempotency_key` is `demo-order-N`, so the file can delete its own last run
  and never touch a real order.
- `supabase/seed.sql` — per-product `emoji` (migration
  `20261014000001_product_emoji.sql`), zone-1 PIN corrected to Kunigal's real
  `572130`, and ~15 Kannada names fixed. `products.emoji` added to
  `apps/mobile/src/types/database.ts`.

**Dead code removed.** `apps/mobile/src/components/placeholder-screen.tsx` and
`themed-view.tsx` were unreferenced after the rebuild (nothing imported them),
and the empty `components/product/` directory is gone.

### Verified, and how

- `npm run typecheck` — **clean**, zero errors, both apps.
- `npm run lint` — **clean, zero warnings** (a fresh
  `react-hooks/exhaustive-deps` warning in `(tabs)/orders.tsx` was found and
  fixed by memoising the derived `all` list).
- `npm run check:i18n` — **278 keys in both languages**, parity OK, every used
  key exists.
- `npm run test:db` — **276 assertions, 0 failed** (was 259). The 17 new ones are
  `supabase/tests/12_demo_data_test.sql`, which runs `demo.sql` against the
  throwaway PostgreSQL 16 the harness boots and asserts: 8 orders / 24 lines;
  2 waiting, 3 in progress, 2 delivered, 1 cancelled; every
  `total = subtotal + fee − discount`; every order's subtotal equals the sum of
  its line totals; every order snapshots the 572130 address; the fee is the zone
  fee; the loader **reused** the existing address rather than inventing one; and
  — the one that matters most — **`orders_guard_insert` and
  `order_items_guard_insert` are both enabled again afterwards**, and the guard
  still forces a customer's born-delivered order back to `placed`.
- `npx expo export --platform web` — bundles cleanly, **17 routes**.

**Not verified:** nothing was exercised against the user's real Supabase. This
sandbox cannot resolve `iuynzrqqiokkdoscncyj.supabase.co`, so the live sign-in,
Realtime and Storage paths are unchanged-but-unrechecked from here; everything
database-shaped was verified against real PostgreSQL via the test harness, which
is the closest honest substitute.

### Decisions, with reasons (so they are not relitigated)

- **`demo.sql` briefly disables two guard triggers.** `orders_guard_insert` and
  `order_items_guard_insert` fire for anyone who looks like a `customer`, and the
  SQL Editor has no signed-in user — so every demo order would be forced back to
  `placed`/`pending` with no lines allowed on a delivered order. The disables and
  the inserts sit in one `begin … exception … end` sub-block, so the triggers are
  restored even if a statement fails. This is the only place in the project that
  turns a guard off, and a test now proves the triggers come back **on**.
- **`order_number` = `KNG-D0001…`.** A deliberate marker, not the sequence's own
  format, so demo rows are obvious in the table editor and safe to delete.
- **Emoji, not photos.** One in three adults here cannot comfortably read a
  product name; a picture is the accessible label. Real photos still win when
  present (`image_url`), the category icon is the last fallback.
- **Theme default is System**, persisted per device, because most people already
  have their phone the way they like it; the explicit switch is there for the
  ones who do not.
- **`*Ink` tokens instead of "just use the bright colour".** A bright brand colour
  reads beautifully as a fill and fails as text on its own tint; naming that
  distinction in tokens makes the failure impossible to reintroduce by accident.

### Bugs found while building this

1. `demo.sql` needed an explicit `::public.payment_status` cast — a `case`
   expression is `text`, and Postgres will not silently narrow it to an enum.
2. The idempotency key check requires **8–200 characters**; the first draft's
   `'demo-1'` was too short, so keys are now `'demo-order-N'`.
3. It was not enough to disable `orders_guard_insert`: `order_items_guard_insert`
   also had to come off, or the delivered/cancelled orders could have no lines.
4. The "the guard still bites" check could not insert as a signed-in customer —
   migration `20261002000008_place_order.sql` **drops** the direct-insert policy,
   so `place_order()` is the only door (RLS refuses before the trigger is
   reached). The test now runs as the table owner, exactly like
   `03_cancel_and_guards_test.sql`.

### Open gaps

- **Noto Sans Kannada is not bundled yet.** The UI still renders Kannada in the
  platform font. `@expo-google-fonts/noto-sans-kannada` is reachable and
  `expo-font` is already a dependency; loading it in the root layout is the next
  small piece of work. Kannada *looks* correct today but is not identical across
  Android and iOS.
- **The `apps/admin` Next.js panel is still the old skeleton.** AGENTS.md calls it
  optional (a desk tool for bulk catalogue edits), so it was left alone; it does
  not yet share this design system.
- **Catalogue not expanded.** Still 34 products (one per emoji tile is enough to
  look full); the earlier plan to grow it to ~48 was dropped as unnecessary, and
  `01_baseline_rls_test.sql`'s 35-product count is therefore unchanged.
- Not built, in the intended order: push notifications → Razorpay → live rider
  tracking/maps. All still deliberate.

---

## 2026-10-13 — Phase 2 customer polish, and Kannada that sounds like Kunigal

*(third session of the same day)*

### What changed and why

Two things: finish the customer-facing polish the roadmap called Phase 2, and
make the Kannada feel like it was written **in** Kunigal rather than translated
**into** it. The brief was explicit — "it should feel like it's our app, our kind
of thing" — so this session treated the language as a product decision, not a
translation pass.

**Kannada as Kannada (the headline change).**
- `apps/mobile/src/i18n/locales/kn.json` — fully re-authored. All 251 keys now
  have genuine Kannada: spoken plain old-Mysuru Kannada, respectful `ನೀವು`, the
  town's own loanwords kept (`ಆರ್ಡರ್`, `ಬಿಲ್`, `ಡೆಲಿವರಿ`, `ರೈಡರ್`) and the real
  shop words kept (`ಸಾಮಾನು`, `ಬುಟ್ಟಿ`, `ಸಂತೆ`), instead of Sanskritised calques
  nobody says out loud. Examples of the voice: Home tab is **ಅಂಗಡಿ** ("the shop"),
  the cart is **ಬುಟ್ಟಿ** ("the basket"), delivered is **ಮನೆ ಸೇರಿದೆ** ("it reached
  home"), placed is **ಆರ್ಡರ್ ಆಗಿದೆ** ("the order is done").
- `apps/mobile/src/i18n/locales/en.json` — one customer-facing leak fixed:
  `home.errorHint` no longer tells a customer to check their "Supabase setup"; it
  says "check your internet connection and try again". (The developer-only
  `home.setupTitle` / `setupHint` keep their technical text — they only ever show
  on a misconfigured dev build.) New keys added for the Phase 2 screens:
  `home.searchPlaceholder`, `home.clearSearch`, `home.noResults`,
  `home.closedTitle`, `home.closedHint`, `order.reorder`, `order.step.*`,
  `support.call` (240 → 251 keys).

**Why a whole document for a language.** `KUNIGAL.md` (new) is the source of
truth for the voice. It records the town from the public record — literacy ≈ 69%
(women 64%), livelihoods (ragi, coconut, **sericulture**, **beedi rolling**, the
horse stud farm), the weekly **ಸಂತೆ**, PIN 572130 — and turns each fact into a
design rule, then gives the glossary of chosen words **with the reason for each**
and a checklist for writing the next string. The point is that the *next* person
argues about wording against facts and reasons, not taste.

**Phase 2 customer polish.**
- `apps/mobile/src/app/(tabs)/index.tsx` — Home rewritten: search box (filters
  name + category in memory over the active catalogue, fetched once with
  `useProducts(null)`), a translate-able store-closed notice, and a "delivering
  to" pill that names the customer's own default address area + pincode.
- `apps/mobile/src/app/order/[id].tsx` — 4-step icon order tracker with a spoken
  Kannada status under each step, a Reorder button, and Call-the-shop.
- `apps/mobile/src/app/(tabs)/orders.tsx` — Reorder on each order card.
- `apps/mobile/src/components/call-shop.tsx` (new) — reads
  `store_settings.support_phone` and opens `tel:`; placed on the order screen and
  the Account screen.
- `apps/mobile/src/store/cart-store.ts` — `replaceAll(items)` for Reorder;
  `selectCartCount` for the badge.
- `apps/mobile/src/app/(tabs)/_layout.tsx` — cart tab badge (`tabBarBadge`).
- `apps/mobile/src/components/product-card.tsx`, `(tabs)/cart.tsx` — product
  images moved from RN `<Image>` to `expo-image`.
- `apps/mobile/src/hooks/use-orders.ts` — `useAddresses({ enabled })` so the
  address query can be held back until needed.

**Kannada is now the default, not a setting.** `apps/mobile/src/i18n/index.ts` had
`DEFAULT_LANGUAGE = 'en'` and started in Kannada only when the *phone* was set to
Kannada. In Kunigal most phones are left on the manufacturer's English default
while the person holding the phone reads Kannada, so the app opened in English for
exactly the people it exists for. `DEFAULT_LANGUAGE` is now `'kn'`, a fresh
install starts in Kannada, and English is one tap away in Account and remembered.
The device-locale check was removed, and `expo-localization` (now unused) is left
in `package.json` but imports nothing.

### A pre-existing bug found, and fixed

`supabase/tests/02_place_order_test.sql` had a **time-of-day-dependent** failure
that predates this session and was invisible all day. The "flag says open, clock
says closed" test built its closed window as `[now+30m, now+90m]`. Between 22:30
and 23:30 IST that window runs through midnight, so `open_time > close_time` and
the `store_settings_open_before_close` CHECK rejected the UPDATE — the test erred
instead of asserting. This run happened at 22:57 IST, so it surfaced now. The test
comment even claimed midnight was "handled by the overnight branch in
`place_order`", but the CHECK forbids an overnight window, so the test contradicted
itself.

Fix: the window is now chosen from the **opposite half of the day** (an early
morning window when it is afternoon/evening now, and vice versa), so it is always
same-day, always `open < close`, and always excludes "now" — at any hour. Verified
by running the suite at 22:57 IST, the exact window that failed before.

### Docs brought back to the truth

- `ROADMAP.md` — §3.1 and §10 no longer claim `kn.json` is "mostly English
  placeholders" (it is now genuinely Kannada); §3.5's offline claim corrected (the
  banner is built, the *persisted* catalogue is not); §3.6 marks Call-the-shop and
  the tracker built; §4.1 table updated; Phase 2 marked mostly done. Added a new
  **§14 gap audit** — launch blockers, claimed-but-unbuilt features, deliberately
  deferred features, accessibility gaps, and housekeeping, each with a reason.
- `AGENTS.md` — Rule 2 now points at `KUNIGAL.md` as the authority on Kannada
  voice, and the folder map lists it.

### Decisions and their reasons

- **The Kannada leads, the English follows.** Where the two diverged, the Kannada
  was written to the situation and the English was nudged to match — not the other
  way round. The customer base reads Kannada; the English is the fallback.
- **Kannada is the default language, and that is a judgement call.** The device
  locale was deliberately ignored: a factory-English phone in Kunigal usually
  belongs to a Kannada reader, so honouring the locale would show English to the
  wrong people. The cost is that a genuine English reader (perhaps the owner's
  helper, or a tester) sees Kannada until they tap English once. Reversing the
  decision is one constant: `DEFAULT_LANGUAGE` in `src/i18n/index.ts`.
- **Loanwords stay.** `ಆರ್ಡರ್`/`ಬಿಲ್`/`ಡೆಲಿವರಿ`/`ರೈಡರ್` are what Kunigal says out
  loud; "purifying" them into formal substitutes would make the app sound like a
  government form, which is exactly what the brief said to avoid.
- **Reorder re-reads live prices.** `replaceAll` stores only `{productId,
  quantity}`; the cart then re-reads current prices and stock. A reorder is a
  fresh order, never a replay of an old price — rule 9.1.
- **Search is client-side over one fetched catalogue.** One shop, tens of
  products: fetching all active products once and filtering in memory is faster
  and works on a weak connection, versus a server round-trip per keystroke.

### Verified — and how

- `npm run typecheck` — 0 errors, both apps.
- `npm run lint` — 0 errors, 0 warnings, both apps (includes `check:i18n`).
- `npm run check:i18n` — **251 keys in both languages**, 177 used literals, 6
  dynamic families; parity holds; the new keys exist in both files.
- `npm run test:db` — **251 passed / 0 failed** against real PostgreSQL 16,
  including the repaired clock test, run at 22:57 IST (the previously failing
  window).

### Open gaps (honest)

- **Still nothing has run on a device or emulator.** The Kannada now *reads*
  right on disk and passes the checker, but it has not been seen rendered on a
  phone. Same for search, reorder and the tracker. This remains the single most
  important next verification.
- **The Kannada voice has not been reviewed by a Kunigal local.** It is written
  in plain old-Mysuru Kannada by the build; a native read-through is needed before
  launch (`KUNIGAL.md` §8). Wording may change with no code change, since every
  string is a key.
- **No voice / text-to-speech**, with literacy ≈ 69% the biggest unfilled
  Kunigal-specific gap (`ROADMAP.md` §14.4). Not scheduled yet.
- The gap audit in `ROADMAP.md` §14 records the rest: missing
  `android.package`/`ios.bundleIdentifier`, no crash reporting, no address
  edit/delete, no admin "today" money totals, no in-app product edit, no product
  detail screen.

---

*(second session of the same day)*

### What changed and why

Phase 1 shipped the rider and owner screens, but they only refreshed on a
20-second poll, so a rider could sit looking at a stale list while an order
waited. Phase 3 replaces that with a websocket (Supabase Realtime), which works
in Expo Go and needs no native module.

- `supabase/migrations/20261013000002_realtime_orders.sql` — adds `public.orders`
  to the `supabase_realtime` publication. Both the publication creation and the
  `add table` are guarded by existence checks, because on a real Supabase project
  the publication is platform-created and already exists, while in the throwaway
  PostgreSQL the DB tests use it does not. `order_items` was deliberately **not**
  added: the lines are written with the order by `place_order()` and never change
  afterwards, so one stream on `orders` is enough and it is one fewer thing to
  keep an eye on.
- `supabase/tests/10_realtime_publication_test.sql` — 4 assertions: the
  publication exists, `orders` is published, `orders` still has RLS enabled, and
  `orders` has a primary key (a replica identity Realtime needs).
- `apps/mobile/src/hooks/use-realtime-orders.tsx` — `RealtimeOrdersProvider` (one
  channel per signed-in user, torn down on sign-out) that invalidates the shared
  `['orders', ...]` query prefix on any change, plus `useOrderEventListener` for
  screens that want the raw event.
- `apps/mobile/src/app/_layout.tsx` — the provider is mounted inside
  `QueryClientProvider`, around the root navigator.
- `apps/mobile/src/app/rider/index.tsx` — on an `INSERT` for an unassigned
  `placed` order, `Vibration.vibrate(400)` and a dismissible banner for 20s.
- `apps/mobile/src/i18n/locales/{en,kn}.json` — new `rider.newOrderAlert` key in
  both languages, and the placeholder corrections below (238 → 240 keys).

### Two pre-existing i18n bugs, found on the way

Wiring the new key surfaced a bug that predates this session, and it was worth
stopping for because it is invisible in every gate and visible to every customer.

- **Placeholders were not being swapped at all.** Every locale value uses
  single braces — `"{count} items"`, `"Hello {name}"`, `"{amount}"` — but
  i18next's default delimiters are `{{ }}`. With the default, `t('rider.greeting',
  { name })` renders the literal text `Hello {name}`. This was proved directly
  against the installed `i18next@26.4.2` and was already present at `HEAD`, so it
  was not introduced by the rider work. Fix: `src/i18n/index.ts` now declares
  `interpolation: { prefix: '{', suffix: '}' }`, which makes all ~20
  placeholder-bearing keys work as written and keeps the files readable.
- **`orders.moreItems` was mangled** — `"more item{count,s}"`, a broken ICU
  plural, and the caller also prepended the count, so Kannada would have
  double-counted (`+ 2 ಇನ್ನೂ 3 ವಸ್ತು`). Replaced with a proper i18next plural
  (`orders.moreItems_one` / `orders.moreItems_other`) chosen by `count`, with the
  caller no longer prepending the number — which also fixes word order, since
  Kannada wants the number *after* "more".
- `common.off` used `{{percent}}` (the one key that did work) while everything
  else used `{percent}`; it is now consistent. It is also **unused** — the
  product-card discount badge renders `"{off}%"` directly, so this key was dead.
  Left in place (now correct) rather than deleted, as a Phase 2 badge is likely to
  want it.
- `scripts/check-i18n.mjs` gained a fifth check: every placeholder must be
  single-brace word form. It also now accepts a plural base key (`orders.moreItems`)
  when `_one` and `_other` both exist. Negative-tested: reintroducing
  `{{percent}}` and `{count,s}` makes the checker exit 1 with both named.

### Decisions and their reasons

- **An event is a doorbell, not data.** The channel is used only to
  `invalidateQueries({ queryKey: ['orders'] })`; the screen is then re-rendered
  from an ordinary, RLS-protected REST read. The event payload is never rendered,
  so no app bug can leak another customer's row on screen. It also means the data
  shown is always a fresh read, not a socket frame that arrived out of order.
- **RLS is left to do the filtering.** Realtime Postgres Changes enforces the
  subscriber's own policies, and supabase-js sends the signed-in user's JWT via
  the Realtime client's `accessToken` callback (verified in the installed
  `@supabase/supabase-js@2.117.2`), so a customer hears only their own orders and
  a signed-out socket hears nothing. The app relaxes nothing here.
- **The poll stays, slower.** The roadmap said Phase 3 *replaces* the 20s poll.
  It was moved to a 60-second backstop instead of being deleted: a websocket can
  die silently on patchy rural 4G, and a slow poll is a cheap way for the list to
  recover on its own. This is a deliberate deviation from the plan text.
- **`Vibration`, not a sound and not `expo-haptics`.** Vibrate is built into
  React Native (no new dependency, still Expo Go), and a sound in a shop or on a
  bike is worse than a buzz. A real push notification for a closed app is Phase 4.
- **One channel, not one per screen.** All three faces share the same channel and
  the same `['orders', ...]` prefix, so a customer watching their order, a rider's
  pool and the owner's board all update from a single subscription.

### Verified — and how

- `npm run test:db` — **251 passed / 0 failed** against real PostgreSQL 16
  (was 247; the 4 new realtime assertions pass). `orders` is confirmed present in
  `pg_publication_tables` for `supabase_realtime`.
- `npm run typecheck` — 0 errors in both apps.
- `npm run lint` — 0 errors, 0 warnings in both apps.
- `npm run check:i18n` — 240 keys in both languages, 169 used literals, 6 dynamic
  families; parity holds. The new placeholder check was negative-tested (see
  above), so it genuinely fails on a malformed placeholder rather than passing
  vacuously.

### Open gaps (honest)

- **Nothing has been run on a device or emulator.** This session, like the last,
  is type-checked, linted and tested at the database and unit level only. The
  websocket path — sign in, place an order from a second account, watch the rider
  screen update and buzz — is **unverified in practice**. That is the first thing
  to try in the next session.
- The 20-second → 60-second poll change is a real behaviour change if Realtime
  turns out to be blocked on a given network; the fallback then feels slower.
- Realtime RLS enforcement is relied upon from documented behaviour and the
  installed client's token wiring; it is not something the local PostgreSQL tests
  can exercise, since the test DB has no Realtime server.
- The placeholder fix is proved at the library level (a direct i18next call), not
  on screen. Worth eyeballing once on a device: the cart line `"{count} items"`,
  `rider.greeting` and the admin summary chips are the easiest places to see
  whether interpolation now visibly works.

---

## 2026-10-13 — One app, three faces: in-app rider and shop-owner roles; Phase 1 rider assignment

### The question, and the answer

Set out to judge whether Expo + React Native + TypeScript + Supabase fit a
Blinkit/Zepto-style quick-commerce app for one shop in Kunigal, and then to build
the missing parts so the owner, the rider and the customer are all served from
the same app. The reasoning and the phase plan are written up in `ROADMAP.md`.

Decision: **keep the stack**, and **put every role inside one app**.

- Kotlin-only was rejected — it is Android-only, and the customer app must also
  reach iPhone.
- Flutter / KMP / a second native app cost more to build and maintain than a team
  of this size gains.
- A separate rider app and a rider web page were rejected in favour of one Expo
  app with three role-based faces, routed after sign-in by `profiles.role`. The
  web panel `apps/admin` is demoted to an optional desk tool for bulk catalogue
  work.
- The principle, repeated throughout: **the app decides what to *show*; Postgres
  decides what is *allowed*.** RLS plus the guard triggers stay the authority.

### Routing: how the faces are separated

`apps/mobile/src/app/_layout.tsx` wraps the root `Stack` in `Stack.Protected`
guards evaluated from `useProfile()`: `rider/` only when `role === 'delivery'`,
`admin/` only when `role === 'admin'`, and `(tabs)/` for a guest, a customer, or
the owner (who keeps a "customer view"). Real path segments were used instead of
route groups because two groups cannot both resolve to `/`. While a signed-in
person's role is still loading, the layout shows a spinner rather than flashing
the shop and then jumping.

### New files

- `ROADMAP.md` — the plan: village-first UX, the three faces, phases 0–6, i18n,
  performance, security, definition of done.
- `supabase/migrations/20261013000001_rider_assignment.sql` — `orders.assigned_to`
  / `assigned_at` (kept consistent by a CHECK and a `set_assigned_at` trigger),
  the waiting/assigned indexes, and a rewritten `guard_order_update` giving riders
  forward-only, own-order control and the owner full control.
- `supabase/tests/09_rider_assignment_test.sql` — ~35 assertions proving the
  claim/ownership/reassign rules.
- `apps/mobile/src/hooks/use-profile.ts` — `useProfile`, `useTeam`, `useSetRole`.
- `apps/mobile/src/hooks/use-staff-orders.ts` — rider/owner order queries and the
  claim / advance / assign mutations.
- `apps/mobile/src/lib/order-view.ts` — reads the snapshot address and formats
  times once, for both staff faces.
- `apps/mobile/src/app/rider/index.tsx` — waiting pool, my deliveries, today count.
- `apps/mobile/src/app/admin/{_layout,index,team}.tsx` — the shop board with rider
  assignment, and the team role list.
- `scripts/check-i18n.mjs` — key-parity and key-usage guard (see below).

### Changed files

- `apps/mobile/src/i18n/locales/en.json`, `kn.json` — rewritten; parity restored,
  missing literals added, wrong status keys fixed, Kannada genuinely translated.
- `apps/mobile/src/types/database.ts` — `Order.assigned_to`/`assigned_at`, plus a
  `Table<>` helper and `order_items -> orders` relationship (see bugs below).
- `apps/mobile/src/hooks/use-orders.ts` — the typed client let the `as any`
  escapes be deleted from `insert` and both `rpc` calls.
- `apps/mobile/src/hooks/use-cart.ts` — adjustment names now go through
  `localizedName` with the language as a cache key (was reading `name_en`).
- `apps/mobile/src/app/(tabs)/cart.tsx` — the mirror-into-state effect removed.
- `supabase/tests/03_cancel_and_guards_test.sql` — rider block now claims and
  advances instead of editing by hand.
- `apps/admin/src/app/(app)/{categories,products,settings}/page.tsx` and
  `layout.tsx`, `apps/admin/src/components/ui.tsx` — lint fixes and typed rows.
- `package.json` — added `check:i18n` and folded it into `lint`.
- `AGENTS.md` §3/§6/§7 and `README.md` §4/§6/§7 — now match the code.
- **Deleted** `apps/admin/src/app/rider/` — a 3-line stub that contradicted the
  decision that deliveries happen in the app.

### Verified

- `npm run typecheck` — 0 errors, both apps.
- `npm run lint` — **0 errors and 0 warnings**, both apps (it started at 15 errors
  + 7 warnings), followed by the i18n check.
- `npm run check:i18n` — 238 keys in both languages, 168 used literals and 6
  dynamic families all resolve.
- `npm run test:db` — **247 passed / 0 failed** against a throwaway PostgreSQL 16
  (was 215 before this session's new rider tests).
- The i18n checker was given a **negative test on purpose**: deleting
  `orders.status.confirmed` from `en.json` made it fail with exactly the two
  expected errors; the file was restored and it passed again.

### Not verified — say so plainly

- **Nothing was run on a device or emulator this session.** No Expo dev server,
  emulator or phone was available here, so the rider and admin screens are
  type-checked and linted but were never rendered against a live Supabase. Smoke
  test them on a phone before trusting them.
- Realtime and push notifications do not exist yet (Phases 2–3). The staff lists
  currently poll every 20 s via TanStack Query `refetchInterval`.

### Bugs found and fixed

- **Kannada was missing text, and two status keys were wrong.** The locale files
  were rewritten, and `scripts/check-i18n.mjs` (wired into `npm run lint`) now
  fails the build if en/kn drift, if code uses a key that does not exist, or if a
  dynamic family (`orders.status.*`, `order.pay.*`, `order.payStatus.*`,
  `auth.error.*`, `checkout.error.*`) is missing a value its enum allows. It also
  flags a Kannada value identical to its English one.
- **The typed Supabase client refused every write.** `Database`'s tables lacked
  the `Relationships` field supabase-js requires, so `.update({...})` resolved its
  argument to `never` and the new staff hooks would not compile. Fixed in
  `types/database.ts`; the embedded `select('*, order_items(*)')` is typed too.
- **The admin web panel did not lint.** Real row types and an effect that awaits
  before setting state (the new `react-hooks/set-state-in-effect` rule), typed
  `cn()`, a dead `/orders` link (404) and the `/rider` stub removed.
- **The cart mirrored adjustments into `useState` from an effect** only to smooth
  a re-render; it tripped `set-state-in-effect`. Removed — `cart.adjustments` is
  read directly against the same dismissal signature.

### Open gaps / next

- Phase 2 next: a Supabase Realtime feed plus in-app order alerts for the 5–6
  riders. Works in Expo Go.
- Push notifications and Razorpay need an EAS development build, not Expo Go.
- No map on the rider screen yet (Phase 6); address + Call is the intended UX
  until then.

---

## 2026-10-03 — Fixed 02_place_order_test.sql; rebuilt the permissions test set

### The bug that was reported

`supabase/tests/02_place_order_test.sql` failed under `./supabase/tests/run.sh`.
Earlier notes in this repo guessed at the cause. This session did not guess; it
read the bytes and bisected the migrations.

**Root cause: the file was not SQL at all.** All 198 bytes of it were the stderr
output of a botched `git checkout`, saved over the test file:

```
fatal: path 'supabase/tests/02_place_order_test.sql' exists, but not '02_place_order_test.sql'
hint: Did you mean 'HEAD:supabase/tests/02_place_order_test.sql' aka 'HEAD:./02_place_order_test.sql'?
```

`od -c` confirmed there is not one byte of SQL in the file. Two stray artifacts
from that same session, `02_place_order_test.sql.clean` and
`02_place_order_test.sql.fixed`, held identical copies of the same garbage — the
".fixed" file was byte-identical to the committed version, so the previous fix
attempt had changed nothing. Both were deleted.

### Migration 20261003000002 was NOT the cause of this failure

Proved by moving the migration out of the way and re-running:

```
$ mv supabase/migrations/20261003000002_db_constraints.sql /tmp/
$ ./supabase/tests/run.sh
--- test 02_place_order_test.sql
    psql:.../02_place_order_test.sql:2: ERROR:  syntax error at or near "fatal"
    LINE 1: fatal: path 'supabase/tests/02_place_order_test.sql' exists,...
            ^
!!! test 02_place_order_test.sql failed
```

Byte-identical failure with the migration absent. The migration was moved back
immediately and `git status supabase/migrations/` was empty afterwards.

### The real second bug: a deleted block, committed broken

`git checkout HEAD -- ...` restored the 550-line file, which then failed with a
*genuine* syntax error at line 34. The cause was visible in the committed
history — `bfa7cc0` and `3569ec4` both contain the damage, so it predates this
session's work:

```
23: (blank)
24: (blank)
25: ;
26: $$;
```

Section 1 of the file had been deleted, leaving an orphan `;` and an orphan
`$$;`. Proof it was exactly one block: 16 `do $$` openers against 17 `$$;`
closers, and exactly one bare `;` line in the file.

Section 1 was reconstructed, not guessed at. Two things in the surviving file
proved what it must have contained:

1. Section 2 (`public.place_order(...)` at line 32 of the damaged file) has no
   `set role authenticated` and no `sign_in` of its own. It was relying on
   section 1 having left the session signed in, so section 1 held the role setup.
2. After restoring it, the first run failed with
   `null value in column "suite" of relation "assertions"`. `psql` gives each
   file a fresh session, so the suite name does not carry over from the fixtures
   file. Section 1 therefore also held
   `select test_result.begin_suite('02 place_order')`.

The reconstructed section 1 is the happy path: 2 x Tomato (1800) + 3 x Onion
(2600) = 11400 paise, over the 10000 minimum, into Asha's Kunigal address
(pincode 571915, zone fee 1500), total 12900. Eight assertions covering the
subtotal, the zone fee, the total, the order landing as `placed`, two line items
being written, and both stock decrements (40 -> 38, 60 -> 57). All eight pass.

**Honest caveat:** the *original* wording of section 1's assertions is
unrecoverable — it was deleted before the first commit. These are new assertions
written to match the file's style, not recovered text. They are not the original
happy-path test; they are a replacement for it.

### The real third bug: a test the new constraint silently broke

Once 02 ran, four failures appeared in `04_concurrency_test.sh` — all
`below_minimum`. That one *was* caused by migration 20261003000002, but not in
the way the first bug was:

```
$ psql -c "update public.products set stock_qty = 1, is_active = true, price_paise = 12000 where id = '...ffff';"
ERROR:  new row for relation "products" violates check constraint "products_mrp_paise_ge_price"
DETAIL:  Failing row contains (..., 12000, 1200, 1 kg, 1, ...)
```

The script raises the contested mango to 12000 paise so a single packet clears
the Rs 100 minimum, but the fixture mango is seeded at `mrp_paise = 1200`. The
new constraint requires `mrp_paise >= price_paise`, so the whole setup UPDATE was
refused — and the script runs `set -uo pipefail` with **no `-e`**, so it carried
on regardless. The price stayed at 1000, every caller was refused with
`below_minimum`, and the race under test never started. Four confusing assertion
failures a long way from a one-line setup problem.

**Fixed by changing the test data, not the constraint** (authorised): the setup
now sets `mrp_paise = 15000` alongside `price_paise = 12000`. No constraint was
dropped or weakened.

Also added a setup guard to that script, so this class of failure is loud next
time instead of surfacing four misleading assertion failures:

```
setup_price="$(psql_q -t -A -c "select price_paise from public.products where id = '$MANGO';")"
if [ "$setup_price" != "12000" ]; then ... exit 1; fi
assert 1 "race: the contested mango was really priced above the shop minimum"
```

### Tests re-created

The four `05_*` files from `bfa7cc0` / `3569ec4` were scaffolds, not tests. They
called `ASSERT(...)`, which is not a PL/pgSQL function anywhere in this project
(the harness provides `test_result.ok` / `eq` / `refused` / `touches`), so each
one aborted on its first statement. They also granted themselves admin by writing
`raw_user_meta_data.role`, which is not where roles live — `profiles.role` is,
and only an admin may change that (`profiles_guard_role`). They recorded nothing
into `test_result.assertions`, so even if they had run they would not have
counted. They were replaced, not merely deleted:

- `05_admin_writes_test.sql` — 27 assertions. Only the shop owner may write
  `products`, `categories`, `store_settings`, `delivery_zones`. For each table:
  customer refused, rider refused, owner allowed *and proved by row count*, then
  a final owner-level re-read proving nothing slipped in.
- `06_db_constraints_test.sql` — 16 assertions. `price_paise > 0`,
  `mrp_paise >= price_paise`, `stock_qty >= 0`, on INSERT and on UPDATE, plus a
  whole group proving the **shop owner cannot get past them either**. A CHECK
  constraint is not a permission; if the only thing stopping a negative price
  were the admin panel's input validation, one bad deploy would put one on the
  shelf.
- `07_settings_pincode_test.sql` — 25 assertions. Negative minimum order,
  delivery fee, free-delivery threshold and low-stock threshold; backwards
  opening hours; and pincode shape — 5 digits, 7 digits, letters, leading space,
  trailing space, empty, all rejected, 6 digits accepted.
- `08_product_images_storage_test.sql` — 22 assertions. The four
  `product-images` policies: public read, admin-only write/update/delete, and
  `bucket_id` checked so being an admin is not a pass into every bucket in the
  project.

Every refusal is pinned to a sqlstate (`23514` check_violation, `42501`
insufficient_privilege) so a test cannot pass on an unrelated error. Every
"this is allowed" case uses `test_result.inserted()` so the files cannot pass by
rejecting everything.

### Harness changes needed to make the storage tests real

`20261003000001_images_and_history.sql` wraps its entire body in
`if exists (storage schema) and exists (storage.buckets)`. On a throwaway
PostgreSQL neither exists, so **the migration did nothing and none of the
`product-images` policies were ever created.** Any storage test written against
it would have been theatre.

`support/00_auth_stub.sql` now provides a minimal `storage.buckets` and
`storage.objects` plus grants, alongside the existing `auth` stub, so the
migration's guarded block actually fires. The grants matter as much as the
tables: the stub grants insert/update/delete to `authenticated`, and 08's
"the shop owner really can upload a photo" assertion is what proves the
customers' refusals are policy refusals rather than missing-GRANT refusals.

Also added `test_result.inserted(label, sql)` to the harness — the counterpart to
`touches()` for the other direction. "This INSERT was allowed" and "this INSERT
worked" are different claims.

### A rule worth writing down for the next session

`refused()` is for statements that **raise**. `touches()` is for statements that
**quietly change nothing**. Getting this backwards produces a test that reports
"it was ALLOWED but should have been refused" for a perfectly well-locked-down
table: an `UPDATE` that RLS hides is not an error, it is a statement that matched
zero rows. Three assertions in 05 were wrong this way on the first run.

### Verification

All against real PostgreSQL 16, booted throwaway by `run.sh` every time.

- `npm run test:db` — **215 passed, 0 failed** (was 125 at the start of this
  session, and 4 failing before that).
- Two mutation checks, to prove the new tests can actually fail:
  - Removing `public.is_admin()` from `product_images_admin_write` →
    08 fails on `a customer cannot upload a photo`, `the rider cannot upload a
    photo`, and the cleanup assertion.
  - Removing `products_mrp_paise_ge_price` from 20261003000002 → 06 fails on
    exactly the three MRP assertions plus the "nothing invalid got in" check.
  - Both migrations were restored; `git diff supabase/migrations/` is empty.
- `npm run typecheck` — passes, zero errors, both apps.

### Not done, and why

- **`npm run lint` does not pass, and I did not fix it** — out of scope for this
  task by instruction. It fails with 15 errors and 4 warnings in `apps/admin`
  (`no-explicit-any` and `react-hooks/set-state-in-effect` in the categories and
  products pages) and 3 warnings in `apps/mobile/src/app/(tabs)/cart.tsx`. These
  are **pre-existing**: this session changed no file under `apps/` at all
  (`git status --short apps/` returns nothing). Rule 9.10 wants lint green; it
  is not, and the next session should treat that as outstanding.
- **No CHANGELOG.md existed** before this session, despite AGENTS.md §8
  requiring one. This file is its first entry, so the history before today is
  genuinely lost rather than merely misplaced.
- **Order flow, the admin panel's behaviour and all UI were not touched**, by
  instruction. The two `no-explicit-any` / `set-state-in-effect` clusters in the
  admin panel are the obvious next piece of work.
- `05_admin_writes_test.sql` leaves products 1800-3 and category 10000000-...-001
  at their seeded values by overwriting them with the same values. If a future
  migration changes those seeds, that file will fight it.
