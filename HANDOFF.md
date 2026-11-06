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
ends with `590 | 0 | 590` and `RESULT: all assertions passed`, Expo prints a QR
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

### 2.1 Database (26 migrations)

- One store, 8 categories, 34 products, 4 delivery zones, 2 coupons, settings.
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

### 2.2 Customer app

- Catalogue with real photos where sourced (28 of 34 in development, via
  `supabase/demo-images.sql`) and a product emoji fallback.
- Search, category chips, product detail, favourites, "buy again", offers rail.
- Cart persisted on the device, quantity clamped to stock, basket bar.
- Addresses with a landmark (the town has no reliable house numbers), one default
  enforced by a partial unique index.
- Checkout with COD, coupon code (the app sends only the code; Postgres decides
  the discount), delivery fee from the zone, idempotent `place_order()`.
- Order history, detail, tracker, cancel-while-placed, reorder, invoice/transaction
  document, privacy notice in both languages.
- Rider name/photo and a **Call the rider** button on the order screen.
- Text-first delivery tracking: age, distance, ETA, and a fifth "Picked up" stop.
  **No map and no dot** — deliberate (`SCALE-AND-TRACKING.md` §6.2).
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
- One-time location consent in Kannada; foreground-only watcher; throttled writes
  (movement/interval rules in `src/lib/tracking-rules.ts`); one final fix when
  the app backgrounds, then the subscription stops. No background permission.

### 2.4 Owner app

- Live order board over Supabase Realtime (customer sockets are filtered to their
  own orders; a 60 s poll is the backstop for a dropped rural socket).
- Assign / reassign / unassign a rider.
- **Today** tab: takings, by-rider cash, refunds due — computed in Postgres.
- **Shelf** tab: price, stock, on/off-shelf from the phone, through
  `update_product_from_shop()` (a plain `.update()` silently matches zero rows
  for a non-admin, so the RPC raises instead). Product identity is frozen.
- **Add a product** in Kannada; a blank Kannada name or the English name copied
  across is refused.
- Team roles, coupons, product photos.

### 2.5 Shared engineering

- TypeScript everywhere; TanStack Query for server state; Zustand for device
  state; Expo Router with `Stack.Protected` role gates.
- 613 i18n keys in `en.json` and `kn.json`, parity enforced; every placeholder is
  single-brace `{name}`; plurals are `_one`/`_other`.
- 23 SQL test files + a two-session concurrency suite = **590 assertions**,
  against a real throwaway PostgreSQL, on every `npm run test:db`.
- Nine pure-JS guard scripts run inside `npm run lint`: i18n, order view,
  persistence allowlist, speech, packs, auth doors, storage, location, tracking.
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
| `npm run lint` | Clean, zero warnings | ESLint + all nine chained checks (i18n parity, view, persist, speech, packs, auth doors, storage, location, tracking) |
| `npm run test:db` | **590 passed / 0 failed** | Migrations apply in order; RLS, guards, money, stock race, coupons, deletion, totals, packs, product creation, names, rider positions all behave |
| `npx expo-doctor` | 20/21 checks pass; only the known Metro warning | SDK packages are internally consistent |
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
npm run test:db                       # 590 passed / 0 failed
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

**Option A — keep the existing hosted project (normal case).**
Copy its URL and publishable key into both `.env` files. Then check whether the
newest migrations are applied. The hosted project was set up before the pack,
in-product-creation, name and rider-position work, so assume it is behind. In the
Supabase SQL Editor:

```sql
-- Packs, in-app product creation, names, rider positions
select column_name
  from information_schema.columns
 where table_schema = 'public' and table_name = 'products'
   and column_name in ('sold_by', 'pack_size', 'pack_unit');

select proname
  from pg_proc
 where proname in ('create_product_from_shop', 'set_my_name',
                   'shop_day_totals', 'shop_day_by_rider',
                   'record_my_position');

select to_regclass('public.rider_positions') as rider_positions;
```

Anything missing means the corresponding migration has not run. Apply the
**missing** files from `supabase/migrations/` in filename order; never edit a
migration that has already been applied. The complete list is in `README.md` §4.
If you are unsure what state the project is in, the safest route is a fresh
project and a full ordered apply.

**Option B — a fresh Supabase project.** Create it, copy the keys, run every
migration in filename order, then `supabase/seed.sql`. Sign up once in the app,
then set the first role in the SQL Editor (README §4, "Choose your role"). After
that, the owner can set roles from the app's Team tab.

> The 28 demo photo URLs in `supabase/demo-images.sql` are **absolute URLs to the
> current hosted project's Storage bucket**. On a brand-new project, either copy
> the `product-images/seed/*` objects into the new bucket or skip that file;
> products without a photo fall back to their own emoji, and the app still reads
> correctly. Never point production at another project's bucket long-term.

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
SQL files plus the two-session race, and ends with the 590-assertion summary. It
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
   typecheck/lint/tests, not a screen. This is the first thing to do.
2. **Phone OTP + SMS provider + DLT registration** (C1). The only release
   sign-in; currently disabled on the hosted project.
3. **Apply the newest migrations to the hosted project** and remove demo
   accounts/data (C7).
4. **Play closed-test calendar** — 12 testers for 14 days (C6) — and the
   owner's Play/Apple accounts.
5. **Statutory numbers:** FSSAI licence, GST decision/cash-memo wording, Legal
   Metrology declarations, privacy-policy URL, LICENSE (C5, H6–H8).
6. **Kannada sign-off** by a Kunigal local, including the new consent/tracking
   strings (M7).
7. **Real product photographs** — 28 of 34 are development stock; 6 have none
   (M8).
8. **Backup / restore / rollback runbook** and a named on-call person (H13).
9. **iOS build path** — needs a Mac or a cloud build (M12).
10. **Confirm the app identifier** `in.kunigal.grocery` is really owned/desired
    before the first store upload; it becomes permanent.

### 6.2 Code work, in the intended order

1. **A real device pass** on the current build; fix what it finds.
2. **Push notifications** (Phase 4): `expo-notifications`, `device_tokens`, an
   Edge Function on order insert; rider gets "new order", customer gets "out for
   delivery". Needs an EAS development build.
3. **Razorpay** (Phase 5): online payment as a second method beside COD; the
   order is placed only after the server verifies the signature. Needs an EAS
   development build. COD stays the default.
4. **Live map / background location** (Phase 6), only after the text-first
   tracking has been used on a phone. Choose the map vendor last; keep the screen
   replaceable.
5. **P5 — post-delivery "was everything right?"** — **built 2026-11-06**
   (`order_feedback`, migration `20261106000001`, test 25, the card on
   `order/[id]`). The record exists; aggregating it for the owner is a later,
   smaller step. No client decision was needed.
6. **Refund visibility to the customer** — **built 2026-11-06**
   (`orders.refund_due_paise` as a generated column, migration
   `20261106000002`, test 26, `src/components/refund-due.tsx`). The owner's
   liability and the customer's screen now read the same number. Still not built:
   the loop 4 item in the agreed order below — **₹saved in the cart (B3)**,
   then the free-delivery "add ₹X more" nudge, then the cycling search
   placeholder (B4).
7. **P6 — partial fulfilment** (needs the owner's decision: short order or
   cancel?).
8. **P7 — scheduled delivery** (needs the owner's answer about rider days).
9. **Decide whether `apps/admin` earns its keep, or retire it.** It is *not*
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
- **A rider assigned to an order cannot delete their account.** Deleting the
  profile makes `orders.assigned_to` `on delete set null`, and that FK-driven
  UPDATE is then refused by `guard_order_update()` — by which point the caller's
  profile is gone, so `current_user_role()` reads `customer`. Found on
  2026-11-06 while proving the feedback cascade; **not fixed**, because it needs
  its own shape in the erasure path plus a test. Customers are unaffected.
- The feedback card is code-complete but has never been seen on a phone, like
  every other screen here.
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
  (no map, no dot), packs not fractions (integer paise), and money/RLS in
  Postgres.
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

**While waiting on a person, the next cheapest honest work** is B3 (show "₹40
saved" in the cart bar — a label over `discount_paise` that already exists) and
B4 (a search placeholder that cycles real shelf words), both from
`COMPETITOR-TEARDOWN.md` §7. Neither changes a promise or a price.

---

## 7. Next steps once the laptop is running

0. **Agent tooling is restored** (2026-11-03): `council`, `gstack` and
   `reverse-engineer-anything` are installed under `~/.config/opencode`; see
   `SKILLS.md`'s status note for the version differences and the two repointed
   council models. Independent of the steps below — the app builds without it.
1. `npm run typecheck && npm run lint && npm run test:db` — all green on Windows.
2. Open the app on a real Android phone with Expo Go; walk the customer flow
   end to end, then rider, then owner.
3. Fix the first-device findings (expect some; that is why C4 is a blocker).
4. The cheap pre-launch design gaps: **A5, A6, A3-card, A2, A7 and A8 are built**
   (2026-11-03, §6.4). What remains is **A1** when the owner supplies honest ETA
   numbers, **A4** after decision 5, and **A9/A10** which need the owner and a CA
   (§6.5). Each should ship with its own CHANGELOG entry; A1 changes a
   customer-visible promise, so confirm it first.
5. Apply the missing migrations to the hosted project and clean the demo data.
6. Set up OTP/SMS + DLT and prove one real sign-in.
7. Create an EAS development build; test location consent, a real rider fix,
   the customer's text tracker, and native crash reporting.
8. Then push notifications, then Razorpay, then the map.
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
  the Blinkit/Zepto teardown, the UI/perf pass, and the pack/name/product work.
- `git log --oneline` — 40+ focused commits; each commit message says what it
  proves.
- `PRODUCTION.md` §12 — the 41-item register, with current status.
- `ROADMAP.md` §14 — the current gap audit.
- `SCALE-AND-TRACKING.md` §8 — T0–T7 status.
- `FEATURE-PARITY.md` §5 — P1–P8 status.
- `COMPETITOR-TEARDOWN.md` §7–§8 — the measured A/B/C gap list and the five open
  decisions. It is a plan, not a build log: none of A1–A6 was built (§6.4).
- `.council/runs/20261019-1731-kunigal-production-review/` — the adversarial
  review that produced `PRODUCTION.md` (read-only history; not part of the app).

---

## 13. The one-sentence state

The software is built and proven at the database/type/lint level — **590 database
assertions, clean typecheck and lint, a 6.1 MB Android bundle** — and it has never
been seen on a phone; the move to Windows is a tooling step, and the first real
milestone on the other side is a device run, not more features. The Blinkit/Zepto
design gaps (A1–A10) are measured and prioritised but **not built** — see §6.4.
