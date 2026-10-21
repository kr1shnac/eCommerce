# AGENTS.md — context for future sessions

Read this file first. It is the single source of truth for how this repo works.
If you change a rule here, change it here — not just in the code.

## 1. What this project is

A grocery / essentials delivery app for Kunigal, Karnataka. Think "Blinkit, but
for one shop on one street". Small town means: short delivery radius, low order
values, phone-based support, and **Kannada matters as much as English**.

- `apps/mobile` — customer app (Android + iOS), Expo + React Native + TypeScript
- `apps/admin` — shop owner's web panel, Next.js + TypeScript (currently empty)
- `supabase` — Postgres database, Auth, RLS policies, seed data

Deliberately **not built yet**: payments (Razorpay), push notifications, maps.
Do not add them unless asked.

## 2. The two rules that must never be broken

### Rule 1 — Money is always integer paise

- 1 rupee = 100 paise.
- Every money column is named `*_paise` and is an **integer**.
- Never store a float, never store rupees, never use `parseFloat` on money.
- Never do arithmetic on a formatted string like `"₹49.99"`.
- Convert to a display string only at the very edge of the UI, using
  `src/lib/money.ts`:
  - `formatPaise(paise)` → `"₹49.99"`
  - `formatPaiseShort(paise)` → `"₹50"` (whole rupees)
  - `discountPercent(pricePaise, mrpPaise)` → `36` or `null`

`formatPaise` hand-rolls Indian digit grouping (`₹12,34,567.89`) instead of
using `Intl`, because `Intl` output is not identical across Hermes/Android/iOS.
Do not "simplify" it to `Intl.NumberFormat`.

Adding to a cart means summing paise integers: `total = a + b`. Rounding happens
once, at display time, and only via `formatPaise`.

### Rule 2 — Two languages from day one, no hard-coded strings

- Every customer-visible **text in the database** has `name_en` and `name_kn`.
  Adding a language means adding a column, not rewriting the app.
- Every customer-visible **string in the app code** lives in
  `src/i18n/locales/en.json` and `src/i18n/locales/kn.json`.
- Never write user-facing English directly in a `.tsx` file. Use `t('key')`.
- Never read `row.name_en` directly in a component. Use
  `localizedName(row)` from `src/lib/localized.ts`, which follows the language
  currently chosen in the app.
- Placeholders are **single-brace and word-only**: `"{count} items"`,
  `"{amount}"`, `"{name}"`. `src/i18n/index.ts` declares
  `interpolation: { prefix: '{', suffix: '}' }` because i18next's own default is
  `{{...}}` — with the default, every placeholder is shown to the customer
  exactly as written. Plural keys use `_one` / `_other`
  (`orders.moreItems_one` / `orders.moreItems_other`) and are chosen by passing
  `count`. `scripts/check-i18n.mjs` rejects any other brace form.

Both `en.json` and `kn.json` must have identical key sets. When you add a key,
add it to both or the app shows a raw key like `home.newThing` to the customer.

Kannada is **not** a word-for-word translation of the English. It is written in
the voice of the shop's own helper in Kunigal, so it feels native rather than
translated. **`KUNIGAL.md` is the source of truth for that voice** — it documents
the town (literacy, livelihoods, how people speak) and holds the glossary of
chosen words with the reason for each. Read it before writing or changing any
customer-visible string; if the wording is argued about, `KUNIGAL.md` decides.
The English is held to the same warmth, so it reads like a kind shop too — the
two languages are written side by side, not translated one from the other.

## 3. Folder structure

```
.
├── AGENTS.md                  ← you are here
├── CHANGELOG.md               ← running build log, append after each session
├── KUNIGAL.md                 ← who we build for + the Kannada voice/style guide
├── DESIGN.md                  ← palette, contrast, type/spacing, light+dark rules
├── README.md                  ← setup + run commands
├── package.json               ← npm workspaces root, "dev" runs both apps
├── apps/
│   ├── mobile/
│   │   ├── app.json           ← Expo config
│   │   ├── metro.config.js    ← monorepo Metro setup, do not delete
│   │   ├── .env               ← your Supabase keys, git-ignored
│   │   ├── .env.example       ← committed template
│   │   └── src/
│   │       ├── app/           ← ROUTES ONLY (Expo Router)
│   │       │   ├── _layout.tsx        root: providers + the role gate
│   │       │   ├── (tabs)/            customer face: the 4 tab screens
│   │       │   ├── rider/             delivery face (profiles.role = delivery)
│   │       │   └── admin/            shop-owner face (profiles.role = admin)
│   │       ├── components/    ← reusable UI (product-card, chips, ...)
│   │       ├── constants/     ← theme colours, spacing
│   │       ├── hooks/         ← TanStack Query hooks (use-catalog.ts)
│   │       ├── i18n/          ← i18next setup + locales/en.json, kn.json
│   │       ├── lib/           ← supabase client, money, localized helpers
│   │       ├── store/         ← Zustand stores
│   │       └── types/         ← database.ts (mirror of the migrations)
│   └── admin/                 ← Next.js shop panel
└── supabase/
    ├── migrations/            ← numbered .sql, applied in filename order
    ├── seed.sql               ← 1 store, 8 categories, 34 products
    ├── demo.sql               ← dev-only: orders, favourites, addresses for demos
    └── tests/                 ← run.sh boots a throwaway PostgreSQL and runs these
```

### Mobile conventions

- Routes live in `src/app/`. **Every file there is a screen.** `_layout.tsx`
  files are navigators. Components, hooks and utils go *outside* `src/app/`.
- Use the **classic `Tabs`** navigator from `expo-router`. The Expo template
  ships an experimental `NativeTabs` API; it was deliberately not used because
  it needs newer native runtimes than a small-town test phone will have.
- Server state → **TanStack Query** (`useQuery` in `src/hooks/`). Never
  `useEffect` + `setState` for fetching.
- UI/client state → **Zustand** (`src/store/`).
- Path alias `@/` → `src/` (see `tsconfig.json`).
- Theme via `useTheme()` and `ThemedText` / `ThemedView`. Do not hard-code
  colours; add a token to `src/constants/theme.ts` (light **and** dark).
- Add dependencies with `npx expo install <pkg>`, never `npm install`, so the
  version matches the Expo SDK.
- Everything is designed in **light and dark**. Colours come from `useTheme()`
  and the tokens in `src/constants/theme.ts` — never a hard-coded hex. Text on a
  `*Soft` background uses the matching `*Ink` token, not the bright brand colour
  (see `DESIGN.md`). `DESIGN.md` is the design source of truth, the way
  `KUNIGAL.md` is for the language; read it before building or restyling a
  screen.
- `ios/` and `android/` folders are generated. Never create or edit them.
- **Device storage goes through `src/lib/storage.ts`.** It is the only module
  that may import `@react-native-async-storage/async-storage`, because it is the
  module that decides — by `typeof window`, not by build type — whether a device
  store exists. Importing the package directly anywhere else crashes
  `npm run mobile`: `app.json` sets `"web": { "output": "static" }`, so
  `expo start` prerenders the app under Node, where the package's web build
  touches `window` and throws `ReferenceError: window is not defined`. Enforced
  by `npm run check:storage`.

### Database conventions

- Migrations are append-only, numbered `YYYYMMDDHHMMSS_name.sql`, applied in
  filename order. **Never edit a migration that has already been applied** —
  write a new one.
- RLS is enabled on every table. A new table with no policies is invisible to
  the app, which is the safe default. Grants alone are not security.
- Money columns are `integer ... check (>= 0)`, named `*_paise`.
- Anything derivable is a `generated always as (...) stored` column, not
  something the client sends (see `order_items.line_total_paise`).
- Orders snapshot customer-visible facts (`delivery_address`, product name and
  price) so later edits never rewrite history.
- After changing a table, update `apps/mobile/src/types/database.ts` by hand.
- `supabase/seed.sql` fills the shelves; `supabase/demo.sql` fills the **orders**
  (25 of them: every status, one carrying a coupon discount, some assigned to a
  rider), plus a shortlist (favourites) and a second address, so all three faces
  can be looked at without tapping through the app by hand. `demo.sql` is
  **development only** — never run it on production. It is safe to re-run: it
  deletes its own orders first (they are marked `order_number KNG-D%` /
  `idempotency_key demo-order-%`) and rewrites the shortlist. It briefly disables
  two guard triggers within a single sub-block that restores them even on
  failure; it is the only place in the project that turns a guard off, and test
  12 proves they come back on.

## 4. Security rules (non-negotiable)

- The mobile app may contain **only** `EXPO_PUBLIC_SUPABASE_URL` and
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Anything prefixed `EXPO_PUBLIC_` is compiled
  into the shipped app and is readable by the user.
- **Never** put the `service_role` key in the app or in the admin panel. It
  bypasses every RLS policy, so it turns the whole permission model off. It
  belongs only in server-side code, and even then only when unavoidable.
- The admin panel should sign in as a real user whose `profiles.role = 'admin'`
  and use the anon key, so that RLS still applies.
- New tables need an `alter table ... enable row level security;` line and
  explicit policies before they are useful.

## 5. Roles

`profiles.role` is one of `customer`, `admin`, `delivery`. Read it through the
helper functions `public.is_admin()`, `public.is_staff()` — never by selecting
from `profiles` inside a policy, which recurses.

RLS summary (details and rationale live as SQL comments in
`supabase/migrations/20261002000006_row_level_security.sql`):

| Can do                                   | customer | delivery | admin |
| ---------------------------------------- | -------- | -------- | ----- |
| Read active categories / products         | yes      | yes      | yes   |
| Read inactive products                    | no       | no       | yes   |
| Edit products / categories / settings     | no       | no       | yes   |
| Read + write **own** addresses            | yes      | no       | yes   |
| Read **own** orders                       | yes      | all      | all   |
| Cancel own order (only while `placed`)    | yes      | no       | yes   |
| Change order status                       | no       | yes      | yes   |
| Change prices / totals                    | no       | no       | yes   |

Row-level access (RLS) is enforced by triggers too, because a policy cannot
express "this column may change, that one may not":

- `profiles_guard_role` — nobody can promote themselves to `admin`.
- `orders_guard_insert` — customer orders are always created as
  `placed` / `pending`.
- `orders_guard_update` — customers may only cancel; delivery may only move
  `status`, `payment_status`, `delivered_at`. The one other update it accepts is
  the exact shape `delete_my_account()` produces, and only while that function
  has set its transaction-local erasure flag (migration `20261020000001`).
- `profiles_guard_deleted` — the deleted-customer tombstone stays anonymous, a
  plain `customer`, and cannot be deleted.
- `order_items.line_total_paise` is generated, so a fake total cannot be sent.

## 6. Commands

```bash
npm install                       # once, from the repo root

npm run mobile                    # Expo dev server
npm run mobile:android            # ... and open on a connected Android device
npm run admin                     # Next.js on http://localhost:3000
npm run dev                       # both at once

npm run typecheck                 # tsc --noEmit in both apps
npm run lint                      # eslint in both apps, then the i18n key check
npm run check:i18n                # en/kn key parity + every key used in code exists
npm run check:session             # the signed-in session survives an app restart
npm run check:auth-doors          # a release build has no dev login; the review build has one
npm run check:view                # the address/time helpers all three faces share
npm run check:persist             # only public shop data is written to the device
npm run check:speech              # the Kannada speech rules and spoken-price formatter
npm run check:packs               # pack sizes, and the arithmetic that must never round money
npm run check:storage             # only one module may touch AsyncStorage (the expo-start crash)
npm run check:my-name               # one phone, several adults
npm run test:db                   # all database tests against real PostgreSQL
```

After changing `.env`, restart with `npm run mobile -- -c` (the `-c` clears the
Metro cache, because env vars are inlined at bundle time).

## 7. Current state

As of this build, the app is a working end-to-end flow on one shop:

- **Done**: monorepo; Supabase schema + RLS + guard triggers + seed; the shop
  catalogue (Home); phone one-time-code sign-in; addresses; cart; checkout with
  `place_order()`; order history and order detail with `cancel_order()`; both
  languages everywhere; money helpers; the admin panel skeleton.
- **The UI is a design system now.** Light **and** dark themes (System / Light /
  Dark, persisted on the device), a palette with honest contrast (`*Ink` tokens
  for text on `*Soft`), shared primitives in `src/components/ui/`, and every
  customer and staff screen rebuilt on it. `DESIGN.md` is the source of truth.
  `supabase/demo.sql` loads dev-only orders, favourites and a second address so
  all three faces look alive.
- **Three faces, one app.** After sign-in the root `_layout.tsx` routes by
  `profiles.role` through `Stack.Protected`: `(tabs)/` for customers and guests,
  `rider/` for `delivery`, `admin/` for the shop owner. The app only decides what
  to *show*; RLS and the guard triggers decide what is *allowed* (ROADMAP §2).
- **Rider assignment is live.** A rider self-claims a waiting order; the owner
  can assign, reassign or unassign. Backed by
  `supabase/migrations/20261013000001_rider_assignment.sql` and proved by
  `supabase/tests/09_rider_assignment_test.sql`.
- **Realtime is live.** A signed-in user's socket hears order changes over
  Supabase Realtime; the app invalidates its order queries, so the rider pool,
  the owner's board and the customer's order screen update without a refresh. A
  new unclaimed order buzzes the rider's phone and shows a banner. Backed by
  `supabase/migrations/20261013000002_realtime_orders.sql` and proved by
  `supabase/tests/10_realtime_publication_test.sql`. A slow 60-second poll stays
  only as a backstop for a dropped socket on patchy rural 4G.
- **The account can be deleted from inside the app.** `delete_my_account()`
  (migration `20261020000001`) erases the person — profile, addresses,
  favourites, auth user — and keeps the shop's books by anonymising the order
  history to a tombstone profile. Both stores require this, and so does the DPDP
  Act. Proved by `supabase/tests/16_account_deletion_test.sql`.
- **The legal notice lives in the app, in both languages.** `src/app/privacy.tsx`
  plus `privacy.*` in `en.json`/`kn.json`; the order screen doubles as the
  e-commerce transaction document and carries the shop's identity and, when the
  shop supplies them, its FSSAI and GST numbers (migration
  `20261020000002_shop_identity.sql`, test 17). No licence number is invented
  anywhere: an absent number shows nothing rather than a placeholder.
- **`apps/admin` is optional.** It is now only a desk tool for bulk catalogue
  edits. Orders, deliveries and day-to-day shopkeeping happen in the app.
- **The order screen names the rider and can call them.** The assigned rider's
  name and photo sit on the customer's order screen with a *Call the rider*
  button, read through the four-column `rider_directory` view (migration
  `20261021000001`) — a customer sees the rider without the app ever exposing
  another profile row. A rider can also close an order **honestly**: `failed`
  (with a required reason and an optional note) and `returned` are real terminal
  statuses, never a soft cancel, and `failed` can never be reopened as
  `delivered`. Proved by `supabase/tests/18_order_tracker_test.sql`.
- **The owner can close the shop with a number, not a guess.** A **Today** tab in
  the owner's face reports the day's takings. `shop_day_totals()` and
  `shop_day_by_rider()` (migration `20261021000002`) compute it **in Postgres** —
  the board only fetches 100 orders, so summing those in the app would report a
  confident, wrong total on a busy day. The rules live in one place: cancelled,
  failed and returned orders are not sales; COD delivered-but-unpaid is cash in a
  rider's pocket; money paid online for an order that never arrived is
  `refund_due_paise`, a liability kept apart from takings. Staff only, refused
  before a row is read. Proved by `supabase/tests/19_shop_totals_test.sql`.
- **The owner can change the shelf from the counter.** A **Shelf** tab edits price,
  stock and on/off-shelf state from the phone — the web panel is a desk tool and
  the owner runs the shop standing up. Writes go through
  `update_product_from_shop()` (migration `20261021000003`), **not** a plain
  `.update()`: a non-admin's direct update matches *zero rows and raises nothing*,
  so a save button built on it could report success while saving nothing. The RPC
  raises instead, and returns the stored row. `guard_product_update()` freezes
  product identity (notably `store_id`, even for the admin) so a mis-tap cannot
  move a product to another shop. The stock movement that `place_order()` and
  `cancel_order()` perform is exempted by a transaction-local flag **plus** a shape
  check that only `stock_qty` may differ — a flag alone would be a hole any
  customer could borrow. Proved by `supabase/tests/20_product_guard_test.sql`.
- **Loose goods are sold as packs, not fractions.** Register M4 looked like "make
  `quantity` a numeric so 500 g can be ordered". That was **rejected**: `quantity`
  stays an integer and counts *packs*, because a fractional quantity makes
  `order_items.line_total_paise` fractional, and the two roundings (line totals and
  the order total) could disagree by one paisa intermittently. Instead the pack is
  structured data — `products.sold_by` (`piece`/`measure`), `pack_size`, `pack_unit`,
  plus the `product_pack_options` view that normalises g/ml onto one scale
  (migration `20261021000004`, test 21). The product screen offers "also in 1 kg"
  chips at **each product's own price**; the guard freezes the pack as identity, so a
  price edit cannot turn a 1 kg bag into a 5 kg one. `src/lib/pack.ts` is pure and
  covered by `npm run check:packs`.
- **The owner adds a product from the phone, in Kannada.** Register M6. The web
  panel could always create a product; the app could not, which contradicted the
  phone-first premise of the Shelf tab. `create_product_from_shop()`
  (migration `20261021000005`, test 22) refuses a blank Kannada name and the English
  name copied across — `products.name_kn` was `not null` but an empty string
  satisfied it, and one in three adults here cannot read the English name. It takes
  no `store_id` (the server picks the active shop) and derives the customer-facing
  pack text from the structured pack. The screen is
  `src/components/add-product-panel.tsx`.
- **Crash reporting and CI are in.** Sentry (`src/lib/crash-reporting.ts`, started
  in the root layout) reports JavaScript errors from real phones; its DSN is a
  **write-only ingest key** and belongs in the app, unlike the Supabase keys, but it
  still lives in `.env`. It sends **no** personal data — `sendDefaultPii: false`
  plus a `beforeSend` that strips the user block, cookies and query strings — and it
  is inert when no DSN is set. **Native crashes need a real build; Expo Go does not
  capture them.** `.github/workflows/checks.yml` runs typecheck, lint (i18n parity +
  auth doors), the session check, the database suite and `expo-doctor` on every push,
  using the same commands a developer runs. See `PRODUCTION.md` for the one argued
  `expo-doctor` exemption.
- **Not built yet**, in the intended order: push notifications → Razorpay → live
  rider tracking/maps. Everything so far runs in Expo Go; push notifications and
  Razorpay need an EAS development build.

`ROADMAP.md` is the detailed phase-by-phase plan; read it alongside this file.
`SCALE-AND-TRACKING.md` is where the app goes *after* it works: the UI
improvement list, the perceived-speed and concurrency work, and the detailed
design for rider location tracking (data path, throttling, privacy rules, and
the deliberately-vendor-free map decision). It is the newest of these files;
where it disagrees with an older fact, check its date.

## 8. Keep the build log honest

After each working session, prepend a dated section to `CHANGELOG.md`. Record:

- what was created or changed, by path
- what you **verified** and how (not just "typecheck passes" — say *what* was
  tested, e.g. "RLS tested against real PostgreSQL, ~20 assertions")
- **decisions and their reasons**, so nobody relitigates them next month
- bugs found, and the open gaps you know about

Do not write a session as "all done". If something is unverified or was a guess,
say so in that file — it is the first thing a future session reads.

## 9. Production standards

These ten rules are non-negotiable and override convenience. They apply to every
change from this point on.

### 9.1 Never trust the client for money

Prices, totals, delivery fee, discount and stock are **always** computed and
validated in the database or on the server — never accepted as sent by the app.
The app may compute values to display them, but the authoritative number comes
from Postgres.

- Read prices from `products` at write time; do not accept `price_paise` from
  the client into `order_items` without recomputing it server-side.
- `order_items.line_total_paise` is `generated always as (...) stored` — keep it
  that way, and add generated/checks for anything new that is derivable.
- `orders.total_paise = subtotal_paise + delivery_fee_paise - discount_paise` is
  enforced by a CHECK constraint. Keep it enforced.
- Delivery fee must come from `store_settings` / `delivery_zones`, never from a
  number the app supplies.
- Stock is decremented server-side in a transaction, and the decrement must be
  conditional (`where stock_qty >= qty`) so it cannot go negative.

### 9.2 Three states on every data-loading screen

Loading, empty, and error-with-Retry. Never a blank screen, and never a raw
error string shown to a customer.

- Loading: a spinner or skeleton, never an empty void.
- Empty: a friendly, translated message explaining what will appear here.
- Error: a translated message plus a **Retry** button that refetches.
- Technical error text (`error.message`, Postgres codes, stack traces) goes to
  the console only — never into the UI.

### 9.3 Handle no / slow internet

Never crash. Show an offline banner, queue nothing silently, and make retries
safe.

- A failed request is an ordinary state, not an exception to guard everywhere.
- Retries must be idempotent (see 9.4) and must not double-charge or
  double-insert.
- Detect offline with `@react-native-community/netinfo` (or a fetch timeout)
  and show one translated banner, not a modal per request.

### 9.4 Mutations are safe against double taps and repeats

Placing an order, saving an address, or anything else that writes must be
safe if the user taps twice or the request is retried.

- Disable the control while the request is in flight.
- Send an idempotency key for anything that creates a row or moves money
  (orders, payments). The server must ignore a repeat of the same key.
- Never let an optimistic update apply twice; roll back cleanly on error.

### 9.5 All user-facing text goes through i18n

English **and** Kannada, always. No hardcoded strings in a `.tsx` file.

- Use `t('key')`; DB text goes through `localizedName(row)`.
- Add every new key to **both** `en.json` and `kn.json` in the same commit.
- Keys are grouped by screen (`home.*`, `cart.*`, `orders.*`, `account.*`).
- Assert key parity in CI or as part of the lint step; a missing Kannada key
  shows a raw key string to a real customer.
- Placeholders are single-brace (`{count}`), never `{{count}}`, and a plural is
  `key_one` / `key_other`, chosen by passing `count`. `scripts/check-i18n.mjs`
  fails on any other brace form, because an un-interpolated placeholder is shown
  to the customer verbatim (`"{count} items"`, `"more item{count,s}"`).

### 9.6 No secrets in the app or the repo

The app may contain only the Supabase project URL and the **publishable/anon**
key. Nothing else.

- Never commit a `.env`, and never paste a key into source, docs or this file.
- `service_role` / `sb_secret_` keys and Razorpay secrets live **only** in
  Supabase Edge Function secrets or server-side environment variables.
- The admin panel signs in as a real `admin` user and uses the publishable key,
  so RLS still applies. Do not "fix" a permissions bug with a secret key.
- Anything prefixed `EXPO_PUBLIC_` is in the shipped binary and public.

### 9.7 Every schema change ships with a migration AND a test

No table, policy or database function is complete until both exist.

- Migration in `supabase/migrations/`, append-only, named `YYYYMMDDHHMMSS_*.sql`.
- A test in `supabase/tests/` that runs against real PostgreSQL and asserts the
  policy actually blocks/allows what 9.1–9.6 claim.
- A new RLS policy is not done until a test proves the forbidden case fails.

### 9.8 List and image performance

- Large lists use `FlatList`/`FlashList` with a **stable** `keyExtractor` (the
  row `id`, never the array index).
- Size images explicitly (`width`/`height` or `aspectRatio`) so layout does not
  jump, and let the image layer cache (`expo-image`).
- Avoid unnecessary re-renders: stabilise callbacks and objects, select only the
  Zustand/Query fields a component needs, and set `extraData` when a list's
  rendered output depends on something outside `data`.

### 9.9 Basic accessibility

- Tap targets are at least **44×44 px**, even if the icon inside is smaller.
- Font sizes stay readable; do not shrink text to make something fit.
- Sufficient colour contrast in **both** light and dark theme, using tokens from
  `src/constants/theme.ts` rather than hard-coded hex values.
- Every icon-only button has an `accessibilityLabel`. Use the right
  `accessibilityRole` and `accessibilityState` (`selected`, `disabled`, …).

### 9.10 Every step ends the same way

No step is finished until all four are done:

1. `npm run typecheck` — passes with zero errors, both apps.
2. `npm run lint` — passes with zero errors *and* zero warnings.
3. Database tests pass — `supabase/tests/` against real PostgreSQL. Any change
   to a policy, table or function requires re-running them (9.7).
4. A dated entry is prepended to `CHANGELOG.md`, including what was verified
   and how, decisions with reasons, bugs found, and open gaps.

If one of these cannot be run, say so explicitly in the log entry rather than
reporting the step as done.