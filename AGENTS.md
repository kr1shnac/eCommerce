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

Both `en.json` and `kn.json` must have identical key sets. When you add a key,
add it to both or the app shows a raw key like `home.newThing` to the customer.

## 3. Folder structure

```
.
├── AGENTS.md                  ← you are here
├── CHANGELOG.md               ← running build log, append after each session
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
│   │       │   ├── _layout.tsx        root: QueryClient, theme, i18n hydration
│   │       │   └── (tabs)/            the 4 tab screens
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
    └── seed.sql               ← 1 store, 8 categories, 34 products
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
- `ios/` and `android/` folders are generated. Never create or edit them.

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
  `status`, `payment_status`, `delivered_at`.
- `order_items.line_total_paise` is generated, so a fake total cannot be sent.

## 6. Commands

```bash
npm install                       # once, from the repo root

npm run mobile                    # Expo dev server
npm run mobile:android            # ... and open on a connected Android device
npm run admin                     # Next.js on http://localhost:3000
npm run dev                       # both at once

npm run typecheck                 # tsc --noEmit in both apps
npm run lint                      # eslint in both apps
```

After changing `.env`, restart with `npm run mobile -- -c` (the `-c` clears the
Metro cache, because env vars are inlined at bundle time).

## 7. Current state (as of the first working build)

- Done: monorepo, Supabase schema + RLS + seed, catalogue Home screen,
  English/Kannada switcher, money helpers, admin panel skeleton.
- Placeholder screens: Cart, Orders, Account (Account has the language switcher).
- Not built: auth screens, cart, checkout, Razorpay, notifications, maps,
  product images, delivery tracking.

Next logical steps, in order: auth → addresses → cart → checkout → Razorpay →
admin panel CRUD.

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