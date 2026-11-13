# HANDOFF — moving Kunigal Grocery to the Windows laptop

**Repository:** <https://github.com/kr1shnac/eCommerce.git>
**Branch:** `master`
**Written:** 2026-10-30
**Verified on:** the Linux machine that built it (see §3). The Windows-specific
parts are written for Windows but were **not executed on Windows hardware in this
session** — §4.6 and §11 say exactly what to check first.
**Who this is for:** the next OpenCode session (or the next developer) on the
Windows laptop. Read this before changing code.

> This file is the map. `AGENTS.md` is the law (money in paise, two languages,
> RLS, the ten production rules). `CHANGELOG.md` is the evidence (newest first).
> `ROADMAP.md` is the plan. `PRODUCTION.md` is the route to a real release.
> `KUNIGAL.md` owns the Kannada voice and `DESIGN.md` owns the visuals. When this
> file and an older doc disagree, this file is newer; when this file and the code
> disagree, the code wins and this file gets fixed.
>
> **Moving the agent too?** This file moves the *project*. `SKILLS.md` moves the
> *OpenCode setup* — the `council` skill and its 8 subagents, the 57 `gstack-*`
> skills, `reverse-engineer-anything`, the Context7 MCP and the memory plugin.
> Those live in `~/.config/opencode/`, not in Git, so a clone alone will not
> bring them.

---

## 0. The ten-minute version

Do these in order on the Windows laptop. If all six pass, the move worked.

> These six move the **project**. They do not restore the agent's skills — see
> `SKILLS.md` for that, and do it once the gates below are green so you know a
> failure is a skill problem, not a code problem.

1. Install **Git**, **Node 22 LTS**, and **PostgreSQL 16** (binaries only; the
   tests start their own cluster). Install **Expo Go** on the Android phone.
2. Clone to a short path: `git clone https://github.com/kr1shnac/eCommerce.git C:\dev\eCommerce`
3. Copy the two **git-ignored** `.env` files from the old laptop (or recreate
   them from the Supabase dashboard). They are **not** in Git. See §5.
4. From `C:\dev\eCommerce`: `npm ci`
5. Run the gates: `npm run typecheck`, `npm run lint`, `npm run test:db`
6. Start the app: `npm run mobile`, scan the QR with Expo Go.

Expected: typecheck silent, lint finishes with every check passed, database suite
ends with `1001 | 0 | 1001` and `RESULT: all assertions passed`, Expo prints a QR
code.

If `npm run test:db` cannot find PostgreSQL, set `PGBIN` for that terminal:

```powershell
$env:PGBIN = "C:\Program Files\PostgreSQL\16\bin"
npm run test:db
```

---

## 1. What this project is

A grocery and essentials delivery app for **one shop in Kunigal, Karnataka** —
"Blinkit for one shop on one street". One Expo app carries three faces, chosen
after sign-in by `profiles.role`:

| Face | Role | What they do |
| --- | --- | --- |
| Customer | `customer` (or signed out for browsing) | Browse the shelf, cart, address, place a COD order, track it, call the rider/shop, reorder |
| Rider | `delivery` | Self-claim a waiting order, advance it, mark it picked up/delivered/failed/returned, share a foreground position while delivering |
| Owner | `admin` | Live order board, assign/reassign riders, Today's cash totals, edit the shelf, add a product in Kannada, manage the team, coupons, photos |

The database is Supabase/Postgres. The app may decide what to **show**; RLS and
guard triggers decide what is **allowed**. Money is integer paise everywhere.
Kannada is the default language, English is the switch, and no customer-facing
string is hard-coded in a component.

There is also an optional Next.js panel in `apps/admin`. It is a desk tool for
bulk catalogue edits, not the daily product. It has fallen behind the app's pack
fields — see §6.

---

## 2. What is actually built

Everything below is in `master` and passes the gates in §3.

### 2.1 Database (45 migrations; 42 on the hosted project, 3 local-only)

Migration `20261112000006_razorpay.sql` and
`20261112000007_refund_due_methods.sql` were pushed on 2026-11-12 (third
session). The three of 2026-11-13 (`20261113000001_rider_directory_window`,
`20261113000002_address_pin_gate`, `20261113000003_shortage_notice_refund`)
are **local-only** by owner directive: a staging project must exist and take
them first, and the owner must say yes before anything reaches production —
so `npm run check:hosted` now reports **42 applied, 3 missing** on the live
project, which is the expected state, not an incident. Locally,
`npm run test:db` proves all 45 (1115 assertions, 0 failures). The payment
path itself is still **dark**: no Razorpay keys, so the Edge Functions answer
`gateway_not_configured` and checkout greys the online methods.

- **Development** data: one store, 8 categories, 34 products, 4 delivery zones,
  2 coupons, settings (from `seed.sql`). **Production** is bootstrapped by
  `supabase/production-bootstrap.sql` instead: one store, settings, the Kunigal
  zone and the 8 categories — **no products**, because an empty shelf is honest.
- Every table has RLS and explicit policies. Customers read their own addresses
  and orders; staff read all orders; only the owner edits prices, stock and
  settings.
- Guard triggers enforce what a policy cannot express:
  - `profiles_guard_role` — nobody promotes themselves to admin.
  - `orders_guard_insert` — a customer order starts `placed` / `pending`.
  - `orders_guard_update` — customers may only cancel while `placed`; riders may
    only move status/payment/delivery fields; prices and totals are frozen.
  - `profiles_guard_deleted` — the account-deletion tombstone stays anonymous.
  - `order_items.line_total_paise` is generated, so a client cannot send a fake
    line total.
- `place_order()` recomputes every price, the delivery fee, the coupon discount
  and the stock decrement **server-side**, in one transaction, with an
  idempotency key. Stock is conditional (`stock_qty >= qty`) and never negative.
- `cancel_order()` puts stock back exactly once.
- Account deletion (`delete_my_account()`) erases the person and anonymises the
  shop's order history to a tombstone, as the DPDP Act and both stores require.
- Orders snapshot the delivery address and product names/prices, so later edits
  never rewrite history.
- Loose goods are sold as **structured packs** (`sold_by`, `pack_size`,
  `pack_unit`, `product_pack_options`), never fractional quantities. That keeps
  every line total an integer paise.
- Staff totals: `shop_day_totals()` and `shop_day_by_rider()` compute the day's
  takings in Postgres. Cancelled/failed/returned orders are not sales; COD money
  in a rider's pocket is reported separately from money the shop holds.
- Rider position: `rider_positions` + `record_my_position()` + the narrow
  `order_rider_position` view. Positions are deleted when the delivery closes,
  older than 10 minutes are never shown, and only the assigned rider can write.
- `rider_directory` exposes only the rider's name/photo/phone to that order's
  customer — never a whole profile row.
- **Delivery handover OTP** (`order_delivery_codes` + `my_delivery_code()` +
  `complete_delivery()`, migration `20261106000003`): a four-digit code exists
  only while an order is `out_for_delivery`, only the order's customer can read
  it, a rider can never read it, five wrong guesses lock it, and a rider moving
  an order to `delivered` without the matching proof is refused by a trigger.
  The admin keeps the documented direct-update escape hatch.
- **Post-delivery feedback** (`order_feedback`, migration `20261106000001`) and
  **refund due** as a generated stored column (`20261106000002`).
- **The door pin** (migration `20261107000001`): `place_order()` copies
  `addresses.lat/lng` into the order's own `delivery_address` snapshot — as two
  jsonb keys that are *absent, never null*, when the address has no pin —
  `is_usable_fix()` is the one SQL definition of "a coordinate that is a place",
  and `order_rider_position` measures the distance and ETA to the snapshot's
  door first and the saved address second. Until this migration, `distance_m`
  and `eta_minutes` were NULL for every order ever placed.
- **The shop reads its own answers.** `shop_feedback_totals()` and
  `shop_feedback_reasons()` (migration `20261108000001`, test 29): two counts
  and the six reasons that actually occurred, staff-only, over a window. Not a
  rating and not an average — a shop with a handful of deliveries a day has no
  average worth reading — and a reason that did not occur returns no row at all,
  never a zero.
- **The door** (migration `20261109000002`, test 31): `set_shop_open(p_is_open)`
  lets the owner close the shop from the phone. `place_order()` has refused a
  closed shop since migration 08; this is the write path that was missing.
  Non-admin → 42501, NULL → 22004, and the function returns the stored row.
- **The money desk** (migration `20261109000003`, test 32): `mark_cod_collected()`
  moves a delivered COD order from "cash in a rider's pocket" to "cash in the
  drawer"; `mark_refund_paid()` clears `refund_due_paise`. Both admin-only,
  state-checked, and safe to retry.
- **GST billing** (migrations `20261112000001`–`20261112000005`, tests 36–38):
  MRP-inclusive prices with the tax extracted per line, a discount allocated
  proportionally so the figures add up exactly, the delivery fee as its own 18%
  line, CGST+SGST or IGST by state, invoice numbers from a sequence in IST, and
  `order_invoice()` as the **single** arithmetic — no per-line tax columns, since
  `line_total_paise` is already generated and Postgres forbids generated-on-
  generated. No GSTIN on the store ⇒ **bill of supply**, with no tax lines at all.
- **Distance and express** (migration `20261112000004`): `distance_metres()`,
  `delivery_quote()` and `update_delivery_settings()`. When both pins exist the
  distance decides; otherwise the pincode zone decides exactly as before. Express
  has its own radius, ETA, fee and basket cap, and `place_order()` refuses it with
  a reason (`too_far`, `too_many_items`, `no_location`, `disabled`).
- **Online money** (migrations `20261112000002`/`0003`): `upi`, `card`,
  `netbanking`, `wallet` join the payment enum, `online_payments_enabled` defaults
  to **false**, and `mark_online_payment_paid()` is the admin-only manual path
  until a gateway exists.
- **Razorpay** (migration `20261112000006`, local only — not on the hosted
  project): `orders.payment_provider` + `payment_provider_order_id`,
  `set_order_payment_intent()` (the order's own customer, one gateway object per
  basket, same id = safe retry, different id = `23505`), `settle_online_payment()`
  (service_role only), and two flag-plus-shape branches in `guard_order_update()`.
  Three Edge functions in `supabase/functions/`.
- **The refund rule covers every non-cash method** (migration
  `20261112000007`, local only): `refund_due_paise` is now `payment_method <> 'cod'`,
  `shop_day_totals()` **sums that column** rather than re-deriving the rule, and
  `mark_refund_paid()` works on `upi`/`card`/`wallet` instead of raising "this
  order was cash on delivery".

### 2.2 Customer app

- Catalogue with real photos where sourced (28 of 34 in development, via
  `supabase/demo-images.sql`) and a product emoji fallback.
- Search, category chips, product detail, favourites, "buy again", offers rail.
- Cart persisted on the device, quantity clamped to stock, basket bar.
- **"Save for later"** beside Remove on every cart line (A13, measured on
  Flipkart's cart): a shelf on the phone — not the server, because a customer
  hesitates while offline — that keeps the quantity they wanted, feeds off the
  same product query as the bag, and cannot overlap it (`check:saved`).
- Addresses with a landmark (the town has no reliable house numbers), one default
  enforced by a partial unique index, and a **door pin** dropped on the same OSM
  map the tracking screen uses (long-press, or "use my current location").
- Checkout with **five payment methods** — cash, UPI (Google Pay / PhonePe /
  Paytm), card, net banking, wallet — where the online four are shown greyed with
  an honest reason until the shop can settle them
  (`store_settings.online_payments_enabled`, deliberately false and SQL-only).
  When online payment is on, the button reads **"Pay ₹XXX"**, the order is placed
  first and the Razorpay sheet opens over it; the signature is re-checked on the
  server before the money is recorded, and a dismissed sheet leaves the order
  payable from its own screen ("Payment not completed" + **Pay now**).
  Coupon code (the app sends only the code; Postgres decides the discount),
  delivery fee from the zone, idempotent `place_order()`.
- **The 30-minute promise, priced and explained.** Express is offered only inside
  its own radius and basket cap, says why when it is not, and shows its fee as
  its own line in the totals. A normal order states its own ETA.
- **The 10 km circle, before the tap.** The distance is computed on the phone
  from the shop pin and the door pin, so an out-of-range address is refused in a
  sentence ("Sorry, delivery is currently available only within a 10 KM radius.")
  rather than at the end of checkout; the database refuses it in the same words
  if the app was wrong.
- Order history, detail, tracker, cancel-while-placed, reorder, **a GST invoice
  the customer can keep** (native screen, plus a self-contained A4 PDF through
  `expo-print` — share or print), privacy notice in both languages.
- Rider name/photo and a **Call the rider** button on the order screen.
- Text-first delivery tracking: age, distance, ETA, and a fifth "Picked up" stop.
  The distance and ETA now work because the order carries a door pin
  (migration `20261107000001`). The tracking card stays text-first, and the map
  behind it is **OpenStreetMap tiles composited by the app itself** — no SDK, no
  API key, no billing account — with a road-snapped route from OSRM that falls
  back to a dashed line labelled "a direction, not a route" when the router does
  not answer (`SCALE-AND-TRACKING.md` §6.5.1).
- **The four-digit handover code** on the order screen while the order is out for
  delivery, read out to the rider. Only the order's own customer can read it.
- Kannada text-to-speech on product/cart, hidden when the phone has no Kannada
  voice, so it never reads Kannada text in an English voice.
- Light and dark themes (System / Light / Dark), persisted.
- Offline: the **public catalogue only** is persisted (allowlist), so last-known
  prices still render; no personal data is written to the device cache. A
  translated offline banner and retry states everywhere.
- Crash reporting: Sentry for JavaScript errors, with PII stripped. Inert when no
  DSN is set. Native crashes need a real build, not Expo Go.

### 2.3 Rider app

- Waiting pool, self-claim, my deliveries, one "next step" button, call button,
  today's delivered count.
- Honest terminal states: `failed` with a required translated reason and optional
  note, and `returned`. `failed` can never be reopened as `delivered`.
- "I have the bag" (`picked_up_at`).
- **The last rung is the customer's code, not a button.** For
  `out_for_delivery` the rider types the four digits the customer reads out
  (`components/delivery-code-entry.tsx`); `complete_delivery()` is the only door
  to `delivered`, and the every-refusal-is-actionable rule applies here too
  ("2 tries left", "this code is locked — call the shop").
- One-time location consent in Kannada; foreground-only watcher; throttled writes
  (movement/interval rules in `src/lib/tracking-rules.ts`); one final fix when
  the app backgrounds, then the subscription stops. No background permission.
- **The door on the map**, on "my deliveries": the order's snapshot pin, drawn
  on the same key-free OSM tiles, plus a directions link that now carries the
  coordinates when the order has them and the landmark sentence when it does not.

### 2.4 Owner app

- Live order board over Supabase Realtime (customer sockets are filtered to their
  own orders; a 60 s poll is the backstop for a dropped rural socket).
- Assign / reassign / unassign a rider.
- **Today** tab: takings, by-rider cash, refunds due — computed in Postgres —
  and **what customers said**: how many bags arrived right, and which of the six
  complaint reasons occurred (counts, never a rating, never a zero for a reason
  that did not happen).
- **Delivery area** card on Today: the radius (default 10 km), the express
  promise (radius, ETA, fee, basket cap) and the shop's own pin, all written in
  one transaction through `update_delivery_settings()`. **The pin is the step the
  owner must take before the distance rule can run** — stand in the shop, tap
  *Use my current location*.
- **Shelf** tab: price, stock, on/off-shelf from the phone, through
  `update_product_from_shop()` (a plain `.update()` silently matches zero rows
  for a non-admin, so the RPC raises instead). Product identity is frozen.
- **GST and HSN on each shelf row**: the rate is chosen from five chips
  (0/5/12/18/28%) so a typo cannot reach a tax invoice, and the HSN is 4–8 digits
  or blank, through `set_product_gst()`. A product starts at 0 = "not classified
  yet", printed as 0%, never as a guess.
- **Add a product** in Kannada; a blank Kannada name or the English name copied
  across is refused.
- Team roles, coupons, product photos.

### 2.5 Shared engineering

- TypeScript everywhere; TanStack Query for server state; Zustand for device
  state; Expo Router with `Stack.Protected` role gates.
- 702 i18n keys in `en.json` and `kn.json`, parity enforced; every placeholder is
  single-brace `{name}`; plurals are `_one`/`_other`.
- 29 SQL test files + a two-session concurrency suite = **732 assertions**,
  against a real throwaway PostgreSQL, on every `npm run test:db`.- Fifteen pure-JS guard scripts run inside `npm run lint`: i18n, order view,
  persistence allowlist, speech, packs, unit price, auth doors, storage,
  location, tracking, navigation, map tiles, route, saved-later.
- CI (`.github/workflows/checks.yml`) runs typecheck, lint, the session check,
  the database suite and `expo-doctor` on every push. The one `expo-doctor`
  exemption (Metro `disableHierarchicalLookup`) is argued in `PRODUCTION.md`.
- **The database suite is cross-platform now.** `scripts/run-db-tests.mjs` boots
  its own cluster on a free localhost port, finds PostgreSQL on Windows/macOS/
  Linux, forces UTF-8 for the Kannada seed, and deletes the cluster. The old
  `supabase/tests/run.sh` is a thin wrapper for macOS/Linux.

---

## 3. Verification record (2026-10-30)

Run on the Linux machine that built the project, from the repo root.

| Command | Result | What it proves |
| --- | --- | --- |
| `npm run typecheck` | Clean, both apps | Types agree with the database types and each other |
| `npm run lint` | Clean, zero warnings | ESLint + all sixteen chained checks (i18n parity, view, persist, speech, packs, auth doors, storage, location, tracking, delivery, navigation, map tiles, route, saved, metro) |
| `npm run test:db` | **850 passed / 0 failed** | Migrations apply in order; RLS, guards, money, stock race, coupons (global + per-customer), deletion, totals, packs, product creation, names, rider positions, shop door, money desk, admin order actions, offers scope all behave |
| `npx expo-doctor` | 21/21 checks pass | SDK packages are internally consistent |
| `npx expo export --platform android` | Built a 6.1 MB Hermes bundle | The app bundles for Android, fonts included |

### 3.1 A fresh clone is self-sufficient (re-checked 2026-10-31)

The move only works if `git clone` + `npm ci` is enough — i.e. nothing the gates
need is sitting in an untracked file on the old laptop. That was tested, not
assumed:

```
git clone https://github.com/kr1shnac/eCommerce.git <tmp>/clone-check
cd <tmp>/clone-check && npm ci        # succeeded, no manual step
npm run typecheck                     # clean
npm run lint                          # clean, all nine chained checks
npm run test:db                       # 850 passed / 0 failed
```

Only two things are deliberately **not** in Git: `apps/mobile/.env` and
`apps/admin/.env` (§4.4). Every other file the gates touch — the four Noto Sans
Kannada fonts, the OFL licence, `.gitattributes`, the SQL suites — is tracked.
So a failure on Windows is a *Windows* problem (Node version, PostgreSQL path,
firewall, line endings), not a missing file.

**What this does not prove — say it plainly:**

- **Nothing has run on a real phone or emulator.** No permission prompt, no
  location fix, no Kannada TTS voice, no screen has been seen. That is
  `PRODUCTION.md` C4 and the biggest open item.
- **The Windows runner has not been executed on Windows.** Its Windows discovery
  path (`C:\Program Files\PostgreSQL\*\bin`, `.exe` suffix, TCP instead of a Unix
  socket) is written deliberately, and the same code path passed 590/590 on Linux.
  The first Windows run is the proof; §11 says what to do if it fails.
- **The hosted Supabase project is not necessarily at this schema.** The newest
  migrations have only ever run against the throwaway test cluster. §4.4 has the
  check.
- **No EAS build has ever been produced.** `eas.json` and bundle identifiers
  exist; the build itself does not.

---

## 4. Move it to Windows, step by step

### 4.1 Install the tools

| Tool | What to install | Why |
| --- | --- | --- |
| Git for Windows | <https://git-scm.com/download/win> | Clone/push; includes Git Bash if you want the old shell scripts |
| Node.js | **22 LTS** from <https://nodejs.org> (or `nvm-windows`) | CI uses 22; the repo requires ≥ 20.19 |
| PostgreSQL | **16** from <https://www.postgresql.org/download/windows/> | Only for `npm run test:db`. The installer's service is not used by the tests |
| Expo Go | Play Store on the Android phone | Run the app without a native build |
| Android Studio | Optional | Only if you want an emulator; choose an AVD with API 34+ and enable hardware virtualisation |
| Windows Terminal / PowerShell | Built in | Commands below are PowerShell-friendly |

You do **not** need Docker, WSL, or a local Supabase stack to run the app or the
tests.

### 4.2 Clone

```powershell
git config --global core.autocrlf false
git clone https://github.com/kr1shnac/eCommerce.git C:\dev\eCommerce
cd C:\dev\eCommerce
```

`core.autocrlf false` plus the repo's `.gitattributes` keeps LF line endings.
Without it, Git for Windows may rewrite `run.sh` and SQL files to CRLF, and a
shell script fails with `bad interpreter: /usr/bin/env bash^M`. The Node test
runner does not care, but keep the checkout clean anyway.

Why `C:\dev\eCommerce`? Deep `node_modules` paths can hit the 260-character
Windows limit. A short root avoids it.

### 4.3 Install dependencies

```powershell
npm ci
```

Use `npm ci` on a fresh clone (it follows `package-lock.json` exactly). Use
`npm install` only when you are deliberately changing a dependency. Do **not**
run `npm install` inside `apps/mobile` or `apps/admin`; this is an npm workspace.

If PowerShell refuses to run `npm.ps1`:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

...or call `npm.cmd` instead of `npm`.

### 4.4 Restore the two `.env` files (they are not in Git)

The app needs `apps/mobile/.env`; the optional panel needs `apps/admin/.env`.
Both are git-ignored on purpose. Copy them from the old laptop over a private
channel (USB, password manager, AirDrop-equivalent); **never** paste them into
chat, a commit, an issue or a screenshot.

`apps/mobile/.env` currently has these names set (values are secret-ish; the
publishable key is safe to ship, the demo password is not):

```ini
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
EXPO_PUBLIC_DEMO_PASSWORD=
EXPO_PUBLIC_DEMO_CUSTOMER_EMAIL=
EXPO_PUBLIC_DEMO_DELIVERY_EMAIL=
EXPO_PUBLIC_DEMO_ADMIN_EMAIL=
```

Optional, only if you use them:

```ini
EXPO_PUBLIC_SENTRY_DSN=          # write-only ingest key; safe in the app
EXPO_PUBLIC_REVIEW_EMAIL=        # store-review build only
EXPO_PUBLIC_REVIEW_PASSWORD=
```

`apps/admin/.env`:

```ini
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

**If the old `.env` files are lost:**

- Supabase URL and publishable/anon key: Supabase dashboard → Project Settings →
  API. The publishable key starts `sb_publishable_…`; older projects call it the
  anon key.
- Demo accounts: run `supabase/demo-accounts.sql` again with a new password
  (`-v demo_password=...`), then put that password and the three emails in
  `apps/mobile/.env`. This is development-only. **Remove these accounts from the
  hosted project before a public build** (C7).
- Sentry DSN: Sentry → project → Settings → Client Keys. Optional.

Never put the Supabase `service_role` / `sb_secret_…` key in either `.env`. Both
`EXPO_PUBLIC_*` and `NEXT_PUBLIC_*` are compiled into the client and readable by
anyone.

### 4.5 Database: which Supabase project?

**The project is Kunigal Bazaar, `argahiagpywluxpqtnpp` (Mumbai, PostgreSQL
17.11).** Its URL is `https://argahiagpywluxpqtnpp.supabase.co`; both `.env`
files already point at it. As of **2026-11-09** it carries all **35** migrations
in filename order, and `supabase migration list --remote` reports 0 pending.
`npm run check:hosted` proves it from the repo (30 present, 0 missing, 5
RLS/publication/index-only).

The old project (`ncfjzbptbtvkjvnrwyyq`) was **out of order** — later migrations
present, earlier ones missing — and has been retired. Do not try to patch it.

**Production data is not `seed.sql`.** It is
`supabase/production-bootstrap.sql`: one store (working name `Kunigal Grocery`,
no phone/address), one settings row, the 572130 zone and the eight categories.
`seed.sql`, `demo.sql`, `demo-accounts.sql` and `demo-images.sql` are
**development only** and must never run on this project.

One thing still needs the dashboard, not this repo:

1. the phone OTP SMS provider (Auth → Providers → Phone) — without it nobody can
   sign in. The four `storage.objects` policies were created 2026-11-11 and
   proved (`docs/launch/STORAGE-POLICIES.md`); the dashboard wrote six rows
   because its *For full customization* flow pairs a `SELECT` with each `UPDATE`
   and `DELETE`, which is expected and harmless.

**A fresh project (only if this one is ever lost).** Create it, link it, then —
**only with the owner's explicit yes for the push, and staging first** (owner
directives, 2026-11-13: AGENTS.md §4.1):

```bash
supabase db push --remote --yes
supabase db query --remote --file supabase/production-bootstrap.sql
```

Then do the two dashboard steps above. Do **not** run `seed.sql` on it. Sign up
once in the app and set the first role in the SQL Editor (README §4, "Choose your
role"); after that the owner sets roles from the app's Team tab.

> The 28 demo photo URLs in `supabase/demo-images.sql` named the **old** hosted
> project (`ncfjzbptbtvkjvnrwyyq`), which was deleted on 2026-11-09 — its
> hostname no longer resolves, so those photographs no longer exist anywhere.
> The file refuses to run (`RAISE EXCEPTION`, 2026-11-12). On any project,
> photograph the shelf from the app's Photos tab; products without a photo fall
> back to their own emoji, and the app still reads correctly. Never point
> production at another project's bucket.

**Option C — local Supabase (Docker).** `supabase start`, then
`supabase db reset` applies every migration + seed. This needs Docker Desktop on
Windows and is optional.

`supabase/demo.sql`, `demo-images.sql` and `demo-accounts.sql` are **development
only**. Never run them on production.

### 4.6 First run and the gates

```powershell
npm run typecheck
npm run lint
npm run test:db
```

`npm run test:db` prints the PostgreSQL version and a temp cluster path, runs 23
SQL files plus the two-session race, and ends with the 732-assertion summary. It
starts its own server on a free localhost port and never touches the PostgreSQL
service from the installer. If it cannot find the binaries:

```powershell
$env:PGBIN = "C:\Program Files\PostgreSQL\16\bin"
npm run test:db
```

Then:

```powershell
npm run mobile
```

Scan the QR with Expo Go. If the phone cannot reach the laptop, see §10.

### 4.7 Phone testing

- **Expo Go** can exercise the catalogue, cart, checkout, orders, rider and owner
  screens, realtime (with a signed-in account), themes, Kannada, and the admin
  panel. It can **not** exercise the location consent/tracking screens,
  `expo-location` in this SDK setup, or native crash reporting. Those need an EAS
  development build (`npx eas build --profile preview --platform android`).
- Sign in with a demo account (buttons appear only in `__DEV__` when the
  `EXPO_PUBLIC_DEMO_*` values are set), or configure phone OTP (C1) — until an SMS
  provider/DLT is set up on the hosted project, OTP cannot work.
- To see the app in a browser fastest: `npm run mobile:web`. The Node prerender
  guards in `src/lib/storage.ts` and `src/lib/location.ts` exist exactly so this
  does not crash.
- The optional desk panel: `npm run admin` → <http://localhost:3000>. Sign in as
  an `admin` user; it uses the publishable key, so RLS still applies.

### 4.8 After the move, commit the state

The laptop move should not change code. If you had to change anything to make
Windows work, put it in a dated `CHANGELOG.md` entry with what you verified and
how, then commit. Do not leave a local-only fix on the new laptop — the next
machine will need it.

---

## 5. Secrets and accounts checklist

| What | Where it lives | How to carry it | Can it be committed? |
| --- | --- | --- | --- |
| Supabase URL + publishable/anon key | `apps/mobile/.env`, `apps/admin/.env` | Copy the files privately | No (URL is public; key is publishable, but `.env` stays out of Git by rule) |
| Supabase `service_role` / secret key | Nowhere in this repo | Only server-side / Edge Function secrets | **Never** |
| Demo account password + emails | `apps/mobile/.env` | Copy privately; or recreate via `demo-accounts.sql` | No |
| Sentry DSN | `.env` (`EXPO_PUBLIC_SENTRY_DSN`) | Copy privately or recreate | No (although it is a write-only key) |
| Expo/EAS account | <https://expo.dev> | Owner's login | No |
| GitHub push access | Git credential manager | Sign in on the new laptop | No |
| Play Console / Apple Developer | Owner's accounts | Owner's login / 2FA | No |
| FSSAI, GST, Legal Metrology numbers | Not in the repo | Owner supplies; they go into `store_settings` | No |

The app is allowed to contain only the Supabase URL and the publishable/anon
key. A `service_role` key in the app or panel turns off the entire permission
model.

---

## 6. What is not done

### 6.1 Owner / launch actions (code cannot finish these)

1. **Run it on a real phone** (C4). Every "verified" in this repo means
   typecheck/lint/tests, not a screen. **This is now the only thing standing
   between the project and a pilot** — and it is unblocked: sign-in works
   (`phone_provider_disabled` is gone; a test number issues a real session),
   the shelf has six demo products, and `docs/launch/DEVICE-RUN.md` is the whole
   run in order. Do this first.
2. **Real SMS for phone OTP** (C1). The **test-number route is DONE 2026-11-11
   and proved** — a session was issued against the live project, so sign-in
   works on a phone today. What remains is real SMS for real numbers: enable a
   paid provider and, in India, a TRAI DLT registration (entity, then a
   6-letter sender ID, then an approved template), because every commercial
   SMS to an Indian number must carry one. The template must match the wording
   in the Phone provider screen exactly, or the operator silently drops every
   message. Everything else is in `docs/launch/SMS-SETUP.md`.
   **Remove the three test numbers before launch.**
3. **CAPTCHA on the OTP endpoint — BUILT 2026-11-12 (fourth session), and
   proved by `check:captcha`.** The app-side gate is complete: a fresh token per
   attempt on all three OTP paths (send, resend, verify), the widget in a
   one-pixel WebView, `EXPO_PUBLIC_CAPTCHA_SITE_KEY` documented, both locales
   covered, and `scripts/check-captcha.mjs` in the lint chain.
   **What is left is the owner's, and the ORDER MATTERS:** create the Cloudflare
   Turnstile widget and paste its **public site key** into `.env` first; then,
   only once that is live, tick *enable CAPTCHA protection* under
   Authentication → Providers → Phone and paste the **secret**. Turning the
   switch on before the app can send a token makes GoTrue refuse every code
   request, which locks out every customer, not just the attackers. See
   `docs/launch/SMS-SETUP.md`.
   Not yet proved: that the widget renders on a real device — needs a site key
   and a build.
4. **Create the four `storage.objects` policies** in the dashboard — **DONE
   2026-11-11, and proved working** (see `docs/launch/STORAGE-POLICIES.md`). The
   dashboard wrote **six** rows because its *For full customization* flow
   pre-selects `SELECT` when you pick `UPDATE` or `DELETE`; both extras are
   harmless (SELECT policies union, so an admin-only SELECT next to the public
   one changes nothing) and should be left alone. The one thing still unproved is
   that an owner can *upload* — that needs an admin session.
5. **The rest of the shop identity.** The **name is now set: Kunigal Bazaar**
   (applied 2026-11-11, `supabase/production-shop-name.sql`). Phone, street
   address, FSSAI and GST are still NULL and still owner-side — an absent number
   shows nothing rather than a fake one (migration `20261020000002`).
   **Two new owner steps, both in the app:**
   - **Drop the shop pin.** Today tab → *Delivery area* → *Use my current
     location*, standing in the shop. Until that is done the 10 km rule cannot
     run and delivery falls back to the 572130 pincode zone. A guessed coordinate
     would refuse real addresses from the wrong point, so it is left to the owner.
   - **Set each product's GST rate and HSN** on the Shelf tab, once the
     accountant says what applies. Products start at 0 = "not classified yet" and
     print as 0% — never a guessed slab. With `stores.gstin` still NULL, every
     document is a **bill of supply**, which is correct for an unregistered shop.
   - **Do not turn on `store_settings.online_payments_enabled`** until a gateway
     can actually settle the money. There is no UI switch on purpose; it is SQL
     only (`PRODUCTION.md`).
   - **Razorpay, when the owner has an account.** Create a free Razorpay
     account (test mode needs no KYC), set three function secrets, deploy the
     three functions in `supabase/functions/`, point the webhook at
     `razorpay-webhook`, then flip `online_payments_enabled` to true. The
     operator steps are in `PRODUCTION.md` §15. **Until that, checkout greys the
     online methods and no payment path is live.**
6. **Play closed-test calendar** — 12 testers for 14 days (C6) — and the
   owner's Play/Apple accounts.
7. **Statutory numbers:** FSSAI licence, GST decision/cash-memo wording, Legal
   Metrology declarations, privacy-policy URL, LICENSE (C5, H6–H8).
8. **Kannada sign-off** by a Kunigal local, including the new consent/tracking,
   shop-door and money-desk strings (M7).
9. **The production shelf holds six DEMO products** (`supabase/demo-catalogue.sql`,
   added 2026-11-11 so the shelf is renderable for the device run). Remove them
   with `demo-catalogue-remove.sql` — one command, exact ids, cannot touch a real
   product. Real products are added by the owner from the Shelf tab, in Kannada,
   at real prices, with real photographs (M8).
10. **Backup / restore / rollback runbook** and a named on-call person (H13).
11. **iOS build path** — needs a Mac or a cloud build (M12).
12. **Confirm the app identifier** `in.kunigal.grocery` is really owned/desired
    before the first store upload; it becomes permanent.

`docs/launch/` holds the external-launch drafts written for the items above:
`LAUNCH-REGISTER.md` is the index (domain, accounts, assets, store
questionnaires), with `privacy-policy.md`, `terms.md`, `store-listing.md` and
`delete-account.md` as the hosted pages. They are **drafts with `TODO(CA)` and
`TODO(OWNER)` markers — nothing in them may be guessed**, and the privacy policy
mirrors the in-app `privacy.*` notice that already ships in both languages.
Added 2026-11-09; commit them separately from code, because a lawyer's sign-off
is what turns them from drafts into the shop's policy.

### 6.2 Code work, in the intended order

1. **A real device pass** on the current build; fix what it finds.
2. **Per-customer coupon limits — built 2026-11-09.** `coupons.per_customer_limit`
   and a `coupon_per_customer_limit` refusal in both `validate_coupon()` and
   `place_order()` (migration `20261109000004`, test 33, 26 assertions). The
   count excludes cancelled orders, the global cap is checked first, and the
   owner sets the cap in the coupon form.
3. **Admin cancel on a customer's behalf, and force-complete — built 2026-11-09.**
   `admin_cancel_order(p_order_id, p_reason)` and `admin_force_complete(p_order_id)`
   (migration `20261109000005`, test 34, 26 assertions). Cancel puts the stock
   back and stores the reason; force-complete sets `delivered_at` once and never
   touches stock or money. Both are admin-only, refuse a terminal order, and a
   `failed` delivery can still never be reopened as `delivered`. The component is
   `components/order-admin-actions.tsx` on the owner's order screen, and the
   customer sees the reason on theirs.
4. **Resend OTP with a visible cooldown — built 2026-11-11.** `login.tsx`'s code
   step now has a resend button with a 30-second countdown (Batch 6, §6.2 item
   4). Disabled while counting, re-enabled at zero, and a rate-limit refusal
   still lands in the translated error box. The countdown is a legible wait, not
   the limit — Supabase's own rate limit stays server-side.
   `scripts/check-resend-otp.mjs` (14 assertions) is in the lint chain.
5. **Push notifications** (Phase 4): `expo-notifications`, `device_tokens`, an
   Edge Function on order insert; rider gets "new order", customer gets "out for
   delivery". Needs an EAS development build.
6. **Razorpay** (Phase 5): online payment as a second method beside COD; the
   order is placed only after the server verifies the signature. Needs an EAS
   development build. COD stays the default.
7. **The map is built** (`df71cd5` + `433e611`): OSM raster tiles composited by
   the app, no SDK, no API key, no billing account, with an OSRM road route and
   an honest straight-line fallback. The door pin now exists, so the route and
   the ETA work. What remains of Phase 6 is the **live follow-the-rider view on
   the rider's own card** (T9) and **background location**, both of which wait on
   a device run rather than on a decision. The vendor is chosen and it is
   OpenStreetMap; the map is `components/rider-map.tsx` and is replaceable, as
   planned.
8. **P5 — post-delivery "was everything right?"** — **built 2026-11-06**
   (`order_feedback`, migration `20261106000001`, test 25, the card on
   `order/[id]`); **aggregated for the owner 2026-11-08**
   (`shop_feedback_totals()` / `shop_feedback_reasons()`, migration
   `20261108000001`, test 29, on the Today tab as counts, never a rating).
9. **Refund visibility to the customer** — **built 2026-11-06**
   (`orders.refund_due_paise` as a generated column, migration
   `20261106000002`, test 26, `src/components/refund-due.tsx`). The owner's
   liability and the customer's screen now read the same number.
10. **The shop's door** — **built 2026-11-09** (`set_shop_open()`, migration
    `20261109000002`, test 31, `components/shop-door-card.tsx` as the first card
    on Today). `place_order()` had refused a closed shop since migration 08; the
    write path was the missing half.
11. **The money desk** — **built 2026-11-09** (`mark_cod_collected()` and
    `mark_refund_paid()`, migration `20261109000003`, test 32,
    `components/order-money-actions.tsx` on the owner's order screen). Both
    numbers Today reports can now be settled, and a retry cannot count twice.
12. **B3 — ₹saved in the basket**, **the free-delivery "add ₹X more" nudge**,
    and **B4 — the cycling search placeholder** — **all three built 2026-11-06**
    (`useCart.mrpSavingsPaise` on the cart screen and in the Home basket bar; the
    nudge in `lib/delivery.ts` with `check:delivery`, under the cart total; the
    placeholder in `components/home-search.tsx`, rotating real in-stock shelf
    names in the customer's language). No migration and no new promise in any of
    them.
13. **P6 — partial fulfilment** (needs the owner's decision: short order or
    cancel?).
14. **P7 — scheduled delivery** (needs the owner's answer about rider days).
15. **Decide whether `apps/admin` earns its keep, or retire it.** It is *not*
    behind on packs — corrected 2026-11-03: it reads and writes `sold_by`,
    `pack_size` and `pack_unit` (grep-verified), so the old "two shelf tools
    disagree" worry is gone. The remaining question is whether a second shelf tool
    with no tests is worth maintaining when the phone already does the job.

### 6.3 Known limitations, stated so nobody rediscovers them

- No device has ever run this. Realtime, permissions, TTS, themes and Kannada
  rendering are all unproven on a screen.
- Native crashes are not captured in Expo Go; only a real build reports them.
- iOS location permission strings are English-only (Expo does not localise
  `InfoPlist.strings` for us); fix during the EAS-build work.
- A rider's phone dying mid-delivery means the customer sees no position after
  10 minutes and falls back to the status ladder + Call. That is the designed
  behaviour, not a bug.
- The 60 s order poll and the 30 s position poll are separate queries; they are
  a backstop, not a substitute for push.
- `apps/admin` has no tests.
- **A rider assigned to an order cannot delete their account.** ~~Deleting the
  profile makes `orders.assigned_to` `on delete set null`, and that FK-driven
  UPDATE is then refused by `guard_order_update()` — by which point the caller's
  profile is gone, so `current_user_role()` reads `customer`.~~ **FIXED
  2026-11-09** by migration `20261109000001_rider_erasure.sql` + test 30 (16
  assertions): `delete_my_account()` now hands the delivery back (with the
  erasure flag on, as the caller is still a rider) before the profile goes, so
  the cascade has nothing left to change — the same shape this file's own
  `address_id` comment already describes. The guard gained a second, narrower
  erasure shape, gated on `old.assigned_to = auth.uid()` so the flag alone
  unlocks nothing. The carried order keeps its customer, money and status; only
  the assignment is dropped, `assigned_at` with it. The trade-off, written down
  at the time: a deleted rider's past deliveries lose WHO carried them (never
  the money — `shop_day_totals()` ignores riders), and pointing a finished order
  at a "deleted rider" stand-in would instead put a stranger's name on a
  customer's order screen, which is what `rider_directory` exists to avoid.
- The feedback card is code-complete but has never been seen on a phone, like
  every other screen here.
- **The shop door and the money desk are also unseen on a phone** (2026-11-09).
  Both are proved by the database suite (14 and 25 assertions) and by typecheck,
  but no finger has pressed either button. They are also the two screens where a
  wrong label costs money, so put them first in the device pass.
- ~~**The owner cannot cancel a customer's order from the app, and cannot
  force-complete one.**~~ **DONE 2026-11-09** — `admin_cancel_order()` and
  `admin_force_complete()` (migration `20261109000005`, test 34). Both are
  admin-only, refuse a terminal order, and a `failed` delivery can never be
  reopened as `delivered`. Cancel puts the stock back; force-complete sets
  `delivered_at` once and touches neither stock nor money.
- ~~**A coupon has a shop-wide usage cap but no per-customer cap.** One customer
  can reuse a code until `usage_limit` runs out. Batch 4 in §6.2.~~
  **DONE 2026-11-09** — `coupons.per_customer_limit`, enforced by
  `validate_coupon()` and `place_order()` (migration `20261109000004`, test 33).
  Cancelled orders release the slot; the global cap is still checked first.
- **The map has never been rendered anywhere.** Tiles, pinch, the OSRM call, the
  door pin and the recentre button are all proved as code and as pure arithmetic
  (`check:map-tiles`, 55 assertions; `check:route`, 45; the DB suite, 39 new
  assertions for the pin), and none of it has been looked at by a person.
- **A pin is the customer's own claim about their own door.** The database
  guarantees a pin is *a place* (`is_usable_fix`: inside the earth, not the null
  island); it cannot guarantee it is the right place. The landmark text remains
  the rider's primary instruction, and the pin sits beside it, not instead of it.
- `common.off` is an unused i18n key and `expo-localization` is only a config
  plugin; both are deliberately left for a future "follow the device" option.

### 6.4 The post-teardown design plan (A1–A10) — decided, built, still open

`COMPETITOR-TEARDOWN.md` (2026-10-26, commit `c145ca2`) is the measured half of
`FEATURE-PARITY.md`: Blinkit and Zepto at 412×915, read from computed styles,
their CSS and the JSON their own pages fetched. No binaries were opened, and
logged-in screens (cart, checkout, tracking, order history) are marked
`[UNKNOWN]`, not described from memory. It produced the A/B/C gap list and five
decisions.

**It is a plan with a build log attached.** Audited against the working tree on
2026-11-03 (the session recorded at the top of `CHANGELOG.md`):

**What was finalised (and is already in the code or the rules):**

- The town is **trip-poor and information-poor, not time-poor**. The product is
  the shop's shelf (is it in stock?), its price (₹/kg), and its person (the
  shop's helper, in Kannada) — not a 10-minute delivery promise.
- **Refused, with reasons:** membership/subscription, the 10-minute theatre,
  Blinkit/Zepto density (12–13 px names), tiered `SUPER_SAVER` pricing, retail
  media/ads, server-driven UI/LMS widgets, `user-scalable=0`, dropping semantic
  headings, buying a commissioned typeface before trying the free Noto
  superfamily, and their five-service-tier model.
- **Kept and defended:** full dark mode (neither web app has one), the 12.5 px
  floor with 1.5× line height, Kannada-first voice, text-first rider tracking
  with a key-free OSM map behind it, packs not fractions (integer paise), and
  money/RLS in Postgres.
- **Agreed build order for the cheap six:** A5 → A6 → A4 → A3 → A2 → A1.
  **A5, A6, A3-card and A2 are built** (2026-11-03). A7–A10 come after that; A9
  needs the owner and a CA.

**What is actually built:**

| Item | Status on 2026-11-03 | Evidence |
| --- | --- | --- |
| A1 ETA as a function | **Not built — needs the owner's numbers** | `delivery_zones.eta_minutes` is still one number per zone. The only ETA function is `eta_minutes_for(distance)` for the rider tracker. |
| A2 ₹/kg, ₹/L | **Built** | `src/lib/unit-price.ts` (`unitRatePaise`, integer paise, no formatter), shown on the product page and on every pack chip. `scripts/check-unit-price.mjs` (38 assertions) runs in `npm run lint`. |
| A3 stock visible | **Built** | The shelf card (`product-card.tsx`) now shows `product.lowStock` when `0 < stock_qty ≤ 5`, and the product page keeps its badge. Same threshold on both, so they cannot disagree. |
| A4 status-bar / top brand | **Not built — needs decision 5** | `expo-status-bar` already switches light/dark in `_layout.tsx`; there is no marigold hairline and no tinted status-bar background. |
| A5 letter-spacing | **Built** | `Type` carries Latin-only tracking (−0.5 display → +0.2 caption); `themed-text.tsx` forces `letterSpacing: 0` for Kannada, because negative tracking collides conjuncts. |
| A6 spacing 12 | **Built** | `Spacing.twoHalf = 12`, used by the Home shelf grid for both row and column gaps. |
| A7 refresh-on-resume | **Built** | `hooks/use-refresh-on-resume.ts` bridges `AppState` into React Query's `focusManager`, and `refetchOnWindowFocus` is now `true`, so stale queries (shelf: 5 min) refresh when the app returns. Fresh ones do not. |
| A8 image priority | **Built** | `product-card.tsx` takes `priority`; the Home grid marks the first 4 cards (two rows) and each rail its first 2. Everything else loads at normal priority and caches `memory-disk`. |
| A9 pack facts | **Half built** | `products.net_quantity` and `products.packer_name` exist (shop identity, migration `20261020000002`). No brand, country of origin, ingredients or return window. |
| A10 two-level categories | **Not built** | `categories` has no `parent_id`. Matters at ~300 SKUs, not 34. |

**What the 2026-11-03 session changed:** A5, A6, A3-card, A2, A7 and A8 are
built and in the working tree — the agreed cheap four plus the two that needed no
decision. They are typechecked, linted (including the new `check:unit-price`) and
list-checked, but **not yet seen on a phone** — that remains true of the whole
app. A1 needs the owner's numbers; A4 needs decision 5; A9 needs the owner and a
CA; A10 waits for ~300 SKUs. §6.5 is the concrete plan for those four.

**Three corrections the audit found in the plan itself (all now acted on):**

1. **A2's file target was wrong for this repo — and the split is now the
   implementation.** The teardown says "derived in `src/lib/pack.ts`", but
   `scripts/check-packs.mjs` deliberately forbids money (any `paise`/`price`) in
   `pack.ts` — that rule is what stopped the M4 fractional-quantity mistake. The
   rate now lives in `src/lib/unit-price.ts`, with its own check, and `pack.ts`
   still passes its "no money" assertions.
2. **A3 is not "invisible until checkout fails".** The product page has shown
   `Only N left` at `≤ 5` since Phase 2.5. The real gap is the **card in the
   grid**, where a shopper decides before opening the product.
3. **A5 cannot copy Zepto's tracking blindly.** Negative `letterSpacing` on
   Kannada can collide conjuncts and detach matras. Tracking must be applied to
   Latin only (or held at 0 when language is `kn`); the Kannada cut keeps its
   natural spacing. This is a `KUNIGAL.md` rule, not a preference.

**The five decisions are still open** (nothing in the repo answers them):

1. **Typeface** — try the free Noto Sans superfamily (Latin + Kannada, already
   OFL-licensed for the Kannada cuts) before buying or commissioning anything.
   Five minutes of licence checking, not a purchase.
2. **Card density** — recommended: keep 16 px names and the 12.5 px floor;
   recover the third row with a 12 px gutter, the already-overlaid discount
   badge, and the ADD moved onto the price row. Any further contradicts
   `KUNIGAL.md`.
3. **ETA** — publish a function of (zone, order size, payment method), computed
   in Postgres, with an honest window (e.g. "20–25 min") rather than one number.
   The shop is COD-only today, so the payment dimension is future-proofing.
   This is the only A-item that changes a customer-visible promise, so the owner
   should confirm the numbers even if the code is built.
4. **Pack facts** — the owner types brand/net quantity/manufacturer/origin/
   ingredients/return window per product (34 products, one evening), or A9 stays
   empty. Empty is a legal exposure for prepacked goods; needs the CA.
5. **Top 16 px** — a marigold hairline + tinted status bar is the cheap,
   reversible default; the alternative is the shop's own colour. One opinion,
   not a design project.

Only A4 depends on decision 5. A5, A6, A3-card, A2, A7 and A8 are **built** and
needed none of the five; A1 needs the owner's numbers but not a design decision.
What remains needs a person, not a laptop: A1, A4, A9, A10.

**Added 2026-11-06 (REA, `COMPETITOR-TEARDOWN.md` §10) — A11–A13.** Blinkit,
Zepto, BigBasket, JioMart and Swiggy Instamart are **blocked from this network**
(Cloudflare challenge / 429 / Akamai Access Denied / "We'll be back shortly"), so
§1–§4 (2026-10-26) is still the only measured Blinkit/Zepto evidence. Flipkart
web is reachable to a signed-out guest, and §10 measures its shelf page, PDP,
add-to-cart and **cart** — the first cart in the file. It adds three rows to §7:
**A11** rating + count on the shelf card (only computable from `order_feedback`;
product page first, never invent a number), **A12** an itemised fee line *if and
only if the shop decides to charge one* (Flipkart's "Platform Fee ₹10" — permission
to itemise, never to fold a margin into prices, rule 9.1), **A13** "Save for
later" beside Remove in the cart. All three need an owner decision; A12 and A13
need no new migration shape beyond what already exists. No checkout, payment or
tracking screen was reached anywhere.

### 6.5 The plan for what remains — A1, A4, A9, A10

Written 2026-11-03 so the next session does not re-derive it. **Nothing here is
blocked on code.** Each item is blocked on a person answering a question, and
each answer is small.

**A1 — ETA as a function (needs the owner).**
Ask the owner three numbers, in his own words: (a) the honest minutes for a
normal order today (the zone's `eta_minutes` is already that), (b) how much longer
a *big* order takes, and what "big" means in rupees, (c) the worst honest case on
a Sunday. Then:
1. Migration `2026…_order_eta.sql`: add `eta_large_order_extra_minutes` and
   `eta_large_order_min_paise` to `store_settings` (nullable, so an absent answer
   changes nothing), plus `eta_window_minutes_for(store_id, subtotal_paise,
   payment_method)` returning `(min_minutes, max_minutes)` — the same shape as
   `eta_minutes_for(distance)` already used by the tracker.
2. Snapshot the window onto the order at placement — one `orders.eta_window_minutes`
   integer for the low end is enough. History must not change when the shop edits
   its settings.
3. Show it on the home hero, checkout, and the order screen; keep the existing
   single number as the fallback when the settings are null.
4. Test `supabase/tests/25_order_eta_test.sql`: at the threshold, below it, a
   null setting, a cancelled order, and a delivery order. **Do not invent the
   minutes**; an empty setting must render the old number, not a guess.

**A4 — top-of-screen brand (needs decision 5, one opinion).**
If the answer is "marigold hairline": a 4 px `theme.secondary` strip above the
navigator in `_layout.tsx`, `StatusBar` background matching `theme.background` on
Android, and the same tokens in both themes. If it is "the shop's own colour",
that colour must be added to `theme.ts` in light **and** dark and contrast-checked
against `DESIGN.md` §2 before it is used. Half a session either way; reversible.

**A9 — pack facts (needs the owner and the CA).**
The fields are: brand, net quantity (already exists), manufacturer, country of
origin, ingredients (en + kn), and the return/replacement window. One migration
adds nullable columns and one SQL test proves a product with them renders and
one without them shows nothing. The product screen gets a "On the pack" block and
the admin panel gets the inputs. **The Legal Metrology wording must come from the
CA**; until then the block stays absent, which is the current behaviour, not a
regression.

**A10 — two-level categories (wait for ~300 SKUs).**
`categories.parent_id` (self-FK, `on delete set null`), a `category_tree` view,
L1 chips on Home and L2 inside a category. At 34 products this adds navigation
for no gain, so it is deliberately last. One migration plus test when the shelf
grows.

**While waiting on a person, the next cheapest honest work** was B3 (show "₹40
saved" in the cart bar), B4 (a search placeholder that cycles real shelf words)
and the free-delivery nudge, all from `COMPETITOR-TEARDOWN.md` §7 and
`FEATURE-PARITY.md` §2.4. **All three are built (2026-11-06).** B3 is
`useCart.mrpSavingsPaise` — MRP against shelf price, not the coupon discount —
on the cart screen and in the Home basket bar. The nudge is
`lib/delivery.ts` with `check:delivery`: the cart says exactly how much more
buys free delivery, and says nothing when adding items would save nothing. B4 is
`components/home-search.tsx`: the placeholder rotates one real, in-stock shelf
name at a time, in the customer's own language. See the CHANGELOG entries for
the reasoning. None of them changes a promise or a price.

---

## 7. Next steps once the laptop is running

0. **Agent tooling is restored** (2026-11-03): `council`, `gstack` and
   `reverse-engineer-anything` are installed under `~/.config/opencode`; see
   `SKILLS.md`'s status note for the version differences and the two repointed
   council models. Independent of the steps below — the app builds without it.
1. `npm run typecheck && npm run lint && npm run test:db` — all green on Windows.
   (2026-11-11: **850 | 0 | 850**, typecheck clean, lint clean across seventeen
   chained checks, `expo-doctor` 21/21.)
2. Open the app on a real Android phone with Expo Go; walk the customer flow
   end to end, then rider, then owner.
3. Fix the first-device findings (expect some; that is why C4 is a blocker).
   Until a phone exists, the substitute that has actually been run (2026-11-09)
   is the **static web export served over HTTP and driven in headless Chrome via
   the DevTools protocol** — login, shop, cart, orders, account, checkout, admin
   board, admin Today, the rider pool with the OTP handover, and a customer order
   in `out_for_delivery` all rendered. It caught two bugs no gate could see
   (CHANGELOG 2026-11-09), but it is not a phone: the map's pinch, the door-pin
   long-press and GPS are still unproven.
4. The cheap pre-launch design gaps: **A5, A6, A3-card, A2, A7 and A8 are built**
   (2026-11-03, §6.4). What remains is **A1** when the owner supplies honest ETA
   numbers, **A4** after decision 5, and **A9/A10** which need the owner and a CA
   (§6.5). Each should ship with its own CHANGELOG entry; A1 changes a
   customer-visible promise, so confirm it first.
5. ~~**Rebuild the hosted project from all 32 migrations, in filename order.**~~
   **DONE 2026-11-09.** The fresh project is **Kunigal Bazaar**
   (`argahiagpywluxpqtnpp`, Mumbai, PostgreSQL 17.11); all **35** migrations are
   applied in filename order and `supabase migration list --remote` reports
   **0 pending**. The production bootstrap has run (1 store, 1 settings row, 1
   zone, 8 categories, **0 products**). `npm run check:hosted` reports **30
   present, 0 missing, 5 unproven** (RLS/publication/index-only files, proved by
   `test:db`). The old project was retired, not patched.
   **What is left of this step is dashboard-only:** the four `storage.objects`
   policies (`docs/launch/STORAGE-POLICIES.md`) and the SMS provider. Re-probe
   with `npm run check:hosted` after any push; never trust a migration count
   written in a doc.
6. Set up OTP/SMS + DLT and prove one real sign-in.
7. Create an EAS development build; test location consent, a real rider fix,
   the customer's text tracker, the map and the door pin, and native crash
   reporting.
8. Then push notifications, then Razorpay.
9. Only then start the Play closed test; the calendar is the launch gate.

---

## 8. Map of the repository

```
.
├── AGENTS.md                 rules: money, i18n, RLS, security, production standards
├── CHANGELOG.md              newest-first build log; read the top few entries
├── HANDOFF.md                this file
├── SKILLS.md                 moving the OpenCode skills/agents/MCP to a new laptop
├── SKILL.md                  the council skill body (also installed under ~/.config/opencode)
├── KUNIGAL.md                the town + the Kannada voice/style guide
├── DESIGN.md                 palette, contrast, type, light/dark rules
├── ROADMAP.md                phases and the current gap audit
├── PRODUCTION.md             route to a real release; the 41-item register
├── SCALE-AND-TRACKING.md     speed, concurrency, the rider-tracking design
├── FEATURE-PARITY.md         Blinkit/Zepto register and the build order
├── COMPETITOR-TEARDOWN.md    measured evidence from Blinkit/Zepto
├── apps/mobile/
│   ├── src/app/              routes only (Expo Router): (tabs), rider, admin, order, product, checkout…
│   ├── src/components/       reusable UI, design-system primitives, skeletons
│   ├── src/hooks/            TanStack Query hooks (catalog, orders, staff, tracking)
│   ├── src/lib/              supabase, money, localized, storage, location, pack, tracking-rules
│   ├── src/store/            Zustand (cart, theme)
│   ├── src/i18n/locales/     en.json, kn.json — 613 keys each
│   └── src/types/database.ts hand-maintained mirror of the migrations
├── apps/admin/               optional Next.js desk panel
├── scripts/                  nine check scripts + run-db-tests.mjs + db-tests/
└── supabase/
    ├── migrations/           26 ordered, append-only .sql files
    ├── seed.sql              1 store, 8 categories, 34 products
    ├── demo*.sql             development-only data, images, accounts
    └── tests/                23 SQL suites + support; the JS runner lives in scripts/
```

Start reading code at:
- `apps/mobile/src/app/_layout.tsx` — providers and the role gate.
- `apps/mobile/src/lib/supabase.ts` — the client and session storage.
- `apps/mobile/src/hooks/use-catalog.ts` / `use-orders.ts` — server state.
- `supabase/migrations/20261002000008_place_order.sql` — the money path.
- `supabase/migrations/20261021000001_order_tracker.sql` — statuses and the rider view.
- `supabase/migrations/20261026000001_rider_positions.sql` — tracking data path.
- `supabase/tests/02_place_order_test.sql` — how the money rules are proved.

---

## 9. The rules that must not be broken

These are in `AGENTS.md` in full; this is the short list for a new session.

1. **Money is integer paise.** Columns are `*_paise`, integers. Never a float,
   never rupees. Format only at the UI edge with `formatPaise()`. The server
   recomputes every price, fee, discount and total; the client never sends them.
2. **Two languages, no hard-coded customer text.** Every UI string is a key in
   both `en.json` and `kn.json`; every DB text column has `name_en` and
   `name_kn`; components use `t()` and `localizedName()`. Placeholders are
   `{word}`, plurals are `_one`/`_other`.
3. **Security is in Postgres.** RLS on every table; new tables get policies and a
   test that proves the forbidden case fails. Never use `service_role` in a
   client. Roles are read through `is_admin()` / `is_staff()`.
4. **Never trust the client for money or identity.** Guard triggers enforce
   column-level rules; generated columns make derivable values impossible to
   forge.
5. **Every schema change = migration + test + `database.ts` update + CHANGELOG.**
   Migrations are append-only and applied in filename order.
6. **A step is not done until** typecheck, lint, database tests and a dated
   CHANGELOG entry all pass (`AGENTS.md` §9.10). If a gate cannot be run, say so
   in the entry instead of claiming it.
7. **Never commit a `.env` or a secret.** The app may hold only the Supabase URL
   and publishable/anon key.

---

## 10. Windows traps (and the fix)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `npm.ps1 cannot be loaded because running scripts is disabled` | PowerShell execution policy | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or use `npm.cmd` |
| `bad interpreter: /usr/bin/env bash^M` | Git rewrote a shell script to CRLF | `git config --global core.autocrlf false`; re-clone (or `git add --renormalize .`) |
| `npm run test:db` says no PostgreSQL found | Binaries not on PATH | Install PostgreSQL 16; the runner searches `C:\Program Files\PostgreSQL\*\bin`; else set `$env:PGBIN` |
| `initdb` fails in a temp folder | Running as Administrator, or antivirus locking the folder | Use a normal terminal; allow PostgreSQL/Node through Defender; retry |
| Phone shows "Something went wrong" / cannot reach Metro | Windows Firewall blocking Node on the private network | Allow Node.js on private networks; phone and laptop on the same Wi-Fi; or `npx expo start --tunnel` |
| Metro crashes with `ReferenceError: window is not defined` | A module imported AsyncStorage or expo-location at top level | Only `src/lib/storage.ts` may touch AsyncStorage and only `src/lib/location.ts` may touch expo-location; `npm run check:storage` / `check:location` catch it |
| `expo-doctor` fails one Metro check | Known, deliberate monorepo config | It is the single argued exemption; see `PRODUCTION.md`. Do not "fix" it by removing `disableHierarchicalLookup` |
| Deep path errors during `npm ci` | 260-character path limit | Clone to `C:\dev\eCommerce`; enable Win32 long paths if needed |
| Admin panel typecheck trips on `.next/types` | Stale Next output | Delete `apps/admin/.next` and `apps/admin/tsconfig.tsbuildinfo`, rerun |
| Kannada appears as `????` in the test output | Console code page | The runner forces `PGCLIENTENCODING=UTF8`; the data and assertions are still correct. Use Windows Terminal for readable output |
| `npm run mobile` dies with `FATAL ERROR: Ineffective mark-compacts near heap limit — JavaScript heap out of memory` | Node caps V8's old-space at ~2 GB by default; the Metro **dev server** (module graph, watching, source maps, and the web bundle) needs more | **Already fixed in the repo**: `npm run mobile` now runs `scripts/start-mobile.mjs`, which spawns Node with `--max-old-space-size=6144`. Raise or lower it with `KUNIGAL_MOBILE_HEAP_MB`. Do not reach for `expo start --android` — that makes Expo look for adb and fails with *"Failed to resolve the Android SDK path"* on a machine that has Expo Go and no SDK, a different and misleading error. Scan the QR with Expo Go instead |
| `npm run mobile` starts but web export fails | Node prerender | Should not happen; the storage/location guards are tested. Run `npm run check:storage` and `npm run check:location` |

---

## 11. If something breaks on the new laptop

Do this in order; it isolates almost everything.

1. **`node -v` and `npm -v`.** Must be Node 22 (or ≥ 20.19). A Node 18 install is
   the most common first-day problem.
2. **`npm ci` from the repo root.** If it fails, delete `node_modules` and retry;
   do not install inside `apps/`.
3. **`npm run typecheck`.** A failure here is a code/dependency problem, not a
   database or phone problem.
4. **`npm run test:db`.** If it cannot find PostgreSQL, set `PGBIN`. If it starts
   but assertions fail, the database is not the throwaway one — check that
   `PGHOST`/`PGPORT` are not set in your shell to a real project.
5. **`npm run mobile`.** If the QR cannot connect, it is the firewall/tunnel, not
   the app.
6. **`npx expo-doctor`.** Only the known Metro warning is acceptable; any other
   complaint is real.
7. **Read the newest `CHANGELOG.md` entry.** It records the exact commands and
   results of the last session, including what was *not* verified.

When asking a future session for help, paste the failing command and the first
20 lines of output, not a screenshot of a phone. And say which of the four gates
(typecheck / lint / test:db / device) it is.

---

## 12. Where the history is

- `CHANGELOG.md` — newest first. The top entries cover the rider position work,
  the Blinkit/Zepto teardown, the UI/perf pass, the pack/name/product work, and
  the three 2026-11-12 sessions: screenshots/PDF, GST + five methods + radius,
  and Razorpay.
- `git log --oneline` — 40+ focused commits; each commit message says what it
  proves.
- `PRODUCTION.md` §12 — the 41-item register, with current status.
- `ROADMAP.md` §14 — the current gap audit.
- `SCALE-AND-TRACKING.md` §8 — T0–T7 status.
- `FEATURE-PARITY.md` §5 — P1–P8 status.
- `COMPETITOR-TEARDOWN.md` §7–§8 — the measured A/B/C gap list and the five open
  decisions. A2, A3-card, A5, A6, A7 and A8 are built; A1, A4, A9 and A10 are
  not (§6.4).
- `.council/runs/20261019-1731-kunigal-production-review/` — the adversarial
  review that produced `PRODUCTION.md` (read-only history; not part of the app).

---

## 13. The one-sentence state

The software is built and proven at the database/type/lint level — **957 database
assertions, clean typecheck and lint, a working web export and a Metro bundle that
serves** — and it has never been seen on a phone; the first real milestone is a
device run, not more features. **The hosted Supabase project is real now**: all
**43** migrations are applied in filename order (0 pending), the production
bootstrap has run, and `check:hosted` reports 38 present / 0 missing / 5
RLS-only. From the phone the owner can close the shop, settle cash and refunds,
cancel an order for a customer who asked by phone, and complete a delivery the
rider's phone never reported; the customer can now resend a code, see an offer's
own scope, ask the shop for something the shelf does not carry, and read the
order they just placed on the confirmation itself. **The shop now issues GST
documents** — tax extracted from MRP-inclusive prices, CGST/SGST or IGST, a
sequence-numbered invoice, and a PDF the customer can keep — offers five payment
methods (online ones honestly greyed until a gateway exists), promises 30-minute
express inside its own circle, and refuses an address outside the owner's 10 km
radius in a sentence that names the distance. The radius, the express promise and
the shop's own pin are editable from the owner's phone; the pin itself is the one
step still waiting for the owner to stand in the shop. The shop is called
**Kunigal Bazaar** now. **Sign-in works** — a phone OTP was issued and verified
against the live project and a real session came back, with the `profiles` trigger
creating the customer row; that door is open, so the device run is unblocked and
`docs/launch/DEVICE-RUN.md` is the whole run in order. What is left is real SMS
for real numbers (a paid provider plus India's TRAI DLT registration) and a
**CAPTCHA gate**, which is not built and must not launch without it. The four
`storage.objects` policies were created and proved on 2026-11-11
(`docs/launch/STORAGE-POLICIES.md`), so photo upload is no longer broken — only
the upload-by-an-actual-owner is unproved, because that needs a sign-in. Blinkit
is now measured in depth (`COMPETITOR-TEARDOWN.md` §11) and the five courtesies
it does better are built; what it does that we do not want — server-driven
merchandising, a wallet, pharmacy — is recorded as refused, with reasons.
