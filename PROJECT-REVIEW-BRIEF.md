# PROJECT-REVIEW-BRIEF.md — Kunigal Bazaar, for an outside reviewer (e.g. Claude)

**Written:** 2026-11-12, after a full read of the working tree.
**Purpose:** a single self-contained brief you can hand to a reviewer who does not
have this repo's context, so it can answer: *is this production-ready? What is
genuinely good? What is genuinely wrong or risky? What should happen next?*
Every number here was re-read from the repo on the date above; the commands that
re-verify them are in Appendix A. Nothing in this brief is marketing.

**How to use it:** give Claude this file plus repo access (or point it at
`AGENTS.md` → `PRODUCTION.md` → `CHANGELOG.md` in that order). §10 lists the
exact questions the project owner wants answered. §11 is the reading map.

---

## 1. What this product is, and for whom

A grocery/essentials **delivery app for one shop in Kunigal, Karnataka** (pop.
~34,000; ~69% literacy, so roughly one adult in three cannot comfortably read a
sentence). The product replaces a phone call to the shop: browse shelf → cart →
address with a **landmark** (the town has no reliable house numbering) → cash (or
UPI) → live order tracking → a rider you can call.

Three faces ship in **one Expo binary**, chosen after sign-in by `profiles.role`:

| Face | Role | What they do |
| --- | --- | --- |
| Customer | `customer` (guests browse) | Catalogue, search, favourites, cart, save-for-later, checkout (5 payment methods), order tracking with a rider's live position, GST invoice, feedback |
| Rider | `delivery` | Self-claim orders, advance status, "picked up", share a foreground GPS position, close honestly (`failed`/`returned` with a reason) |
| Owner | `admin` | Live order board (realtime), rider assignment, Today's takings, feedback counts, shelf/price/stock edits, add a product in Kannada, coupons, team roles, photos, delivery-area settings, shop open/close |

An optional **Next.js panel** (`apps/admin`) exists as a desk tool for bulk
catalogue edits. Money is integer paise everywhere. Kannada is the default
language; English is a one-tap switch.

---

## 2. Technology stack (exact versions, from `package.json` on 2026-11-12)

**Mobile app (`apps/mobile`)** — Expo **SDK 57.0.32**, React Native **0.86.3**,
React **19.2.3**, expo-router **57.0.30**, TypeScript ~6.0.

- State: **TanStack Query** v5 (server state, persisted to device) + **Zustand** v5 (client state)
- Backend client: **@supabase/supabase-js** 2.117.2 (auth session persisted via AsyncStorage through `src/lib/storage.ts`)
- i18n: **i18next** 26 + react-i18next 17, locales at `src/i18n/locales/{en,kn}.json`
- Styling: custom design system, tokens in `src/constants/theme.ts`, light + dark, no CSS framework
- Maps: **OpenStreetMap raster tiles composited in-app** (`react-native-svg` + gesture stack) + **OSRM** public router — deliberately **no Google/Mapbox SDK, no API key, no billing account**
- Payments: **react-native-razorpay** 3.0.0, imported lazily behind `Platform.OS` so it never enters the web/entry bundle
- Location: `expo-location` (foreground only, consent-gated, single module `src/lib/location.ts`)
- Speech: `expo-speech` (Kannada TTS, hidden if the phone has no Kannada voice)
- PDF/print: `expo-print` + `expo-sharing` (offline, self-contained HTML)
- Crash reporting: **@sentry/react-native** ~7.11 (PII stripped; inert without a DSN)
- CAPTCHA: Cloudflare Turnstile inside a 1-pixel `react-native-webview` 13.16.1
- Fonts: Noto Sans Kannada (`@expo-google-fonts`), OFL-licensed, bundled

**Admin panel (`apps/admin`)** — **Next.js 16.4.6**, React 19.2.3, Tailwind v4, `@supabase/ssr`, anon/publishable key only (RLS still applies).

**Backend — Supabase** (hosted: Postgres 17.11, project `argahiagpywluxpqtnpp`,
Mumbai):

- **45 migrations** (`supabase/migrations/`, append-only, `YYYYMMDDHHMMSS_*`)
- Row Level Security on every table + guard triggers
- Postgres RPCs for every money write (`place_order`, `cancel_order`, ...)
- Realtime on `orders` (publication migration)
- **3 Edge Functions** (`supabase/functions/`): `razorpay-order`, `razorpay-verify`, `razorpay-webhook` (+ `_shared/razorpay.ts`) — built and proved, **not deployed, no keys**
- Storage bucket with 4 `storage.objects` policies (created via dashboard)

**Tooling:** npm workspaces; GitHub Actions CI (`typecheck`, `lint` with 22
chained checks, `check:session`, `test:db`, `expo-doctor`, admin `next build`,
web + Android exports); a Node-based PostgreSQL bootstrapper so `npm run test:db`
runs anywhere with no service and no Docker.

---

## 3. Architecture and every screen

`apps/mobile/src/` (from the working tree): **24 route files** under `src/app/`,
**39 components** (incl. 8 primitives in `components/ui/`), **37 hooks**,
**26 lib modules**, **5 Zustand stores**, i18n (2 locales).

**Customer routes:** `(tabs)/index` (Home: location pill with ETA, category
chips, offers rail, 2-col product grid, basket bar), `(tabs)/cart` (save-for-
later, MRP savings, free-delivery nudge), `(tabs)/orders`, `(tabs)/account`
(profile, appearance System/Light/Dark, language, delete account, call shop),
`product/[id]` (pack chips, ₹/kg unit price, TTS), `checkout` (address picker,
coupon, delivery fee + express line, payment methods), `order/[id]` (tracker,
rider name/photo/call, handover OTP card, feedback, refund-due, cancel),
`invoice/[id]` (native invoice + shareable A4 PDF), `addresses`, `address`
(door pin on the OSM map), `login` (phone OTP + CAPTCHA gate), `privacy`.
**Rider:** `rider/index` (pool, my deliveries, delivery-code entry, map).
**Owner (admin):** `today` (shop door, takings, by-rider cash, refunds due,
feedback counts, delivery-area card), `shelf` (price/stock/GST/HSN, add product),
`coupons`, `team`, `photos`.

**Key architectural decisions worth a reviewer's attention:**

1. **The app decides what to *show*; the database decides what is *allowed*.**
   Every privileged write is a `security definer` RPC that raises on refusal —
   never a plain `.update()`/`.insert()`, because RLS makes a forbidden write
   match *zero rows and raise nothing*, i.e. a save button that lies.
2. **Money is integer paise** end to end; one formatter (`src/lib/money.ts`)
   hand-rolled because `Intl` output differs across Hermes/Android/iOS.
3. **Everything derivable is derived server-side**: `order_items.line_total_paise`
   is `generated always as (...) stored`; GST tax, invoice totals, day totals,
   refund liability are Postgres computations, not app arithmetic.
4. **Pure logic is extracted so it can be checked off-device** (`lib/pack.ts`,
   `lib/geo.ts`, `lib/map-tiles.ts`, `lib/route.ts`, `lib/order-view.ts`, ...).
5. **Native-only modules are lazy + `Platform.OS`-guarded** so the static web
   export (a real gate in CI) works.
6. **Offline**: only the *public* catalogue is persisted to device (allowlist —
   fails closed); no personal data in the device cache.

---

## 4. Database and security — the strongest part of the project

- **RLS enabled on every table** with explicit policies; staff checks use helper
  functions (`public.is_admin()`, `is_staff()`) to avoid policy recursion.
- **Guard triggers** express what a policy cannot: `profiles_guard_role` (no
  self-promotion to admin), `orders_guard_insert` (customers create orders as
  `placed`/`pending` only), `orders_guard_update` (customers may only cancel;
  riders may only move status/payment/delivery fields; the Razorpay branches are
  gated by a transaction-local flag **plus** a column-shape check),
  `profiles_guard_deleted` (tombstone stays anonymous), `guard_product_update`
  (freezes product identity, incl. `store_id` and the pack fields).
- **`place_order()`** recomputes every price, the delivery fee, express rules,
  the coupon discount and the stock decrement server-side in one transaction,
  with an idempotency key; stock decrements conditionally (`stock_qty >= qty`).
- **Money-adjacent rules live in Postgres**: `order_invoice()` is the single GST
  arithmetic (MRP-inclusive prices, tax extracted, coupon discount allocated
  proportionally with the remainder on the last line so figures add up exactly),
  `shop_day_totals()`/`shop_day_by_rider()` compute the day's takings, cash in
  riders' pockets and refund liability; `orders.refund_due_paise` is a generated
  stored column (`payment_method <> 'cod'`), un-writable by any client.
- **Privacy engineering**: `rider_directory` exposes exactly four rider columns
  to the order's customer; `delete_my_account()` erases the person and
  anonymises order history to a tombstone (DPDP + both store policies);
  `order_delivery_codes` handover OTP (rider can never read it; 5 guesses lock).
- **Narrow views** (`order_rider_position`) instead of raw table reads; a fix
  older than 10 minutes is never shown.

**Test suites:** 38 SQL test files (`supabase/tests/`, note: there is **no file
`04_*`** — see §8) plus a two-session concurrency suite (row-lock race on the
last unit of stock, proving exactly one customer wins and the loser is told
`items_unavailable`, and that a blocked customer waits rather than guesses).
Run it yourself: `npm run test:db` — it boots a throwaway PostgreSQL in the temp
dir (Windows/macOS/Linux), applies all 45 migrations, and deletes the cluster.

---

## 5. Feature inventory (what is actually built)

**Customer:** catalogue with photos (emoji fallback), search (matches Kannada),
favourites/saved rail, offers rail with usage limits shown ("2 times per
person"), cart with stock clamping, save-for-later shelf (on-device, cannot
overlap the bag), free-delivery nudge ("add ₹X more"), 5 payment methods (COD
live; UPI/card/netbanking/wallet greyed with the reason until a gateway exists),
coupon codes, checkout with local delivery-radius verdict (10 km, GPS-measured,
refusals name the real numbers), express (5 km / 30 min / own fee / 40-unit cap,
refused with a reason), order tracker (text-first + OSM map + OSRM route behind
a tap), rider name/photo/call, handover OTP, honest terminal statuses, feedback
(`was_ok` + one of six reasons), refund-due card, GST invoice (native + PDF),
privacy notice in both languages, Kannada TTS, themes, offline banner, English
"we don't have this — ring the shop" search miss, reorder, account deletion.

**Rider:** waiting pool + self-claim, one "next step" button, call button,
today's delivered count, consent-gated foreground location with throttled writes,
door pin on a map, delivery-code entry, `failed` (required reason) / `returned`.

**Owner:** realtime board (own-orders filtered, 60 s poll backstop), assign/
reassign/unassign, Today (takings, per-rider cash, refunds due, complaint-reason
counts — computed in Postgres), shop open/close, COD-collected and refund-paid
settlement, shelf edits (price/stock/on-off), GST rate chips (0/5/12/18/28%) +
HSN, add a product in Kannada (blank/copied English name refused), coupons with
per-customer limits, team roles, photos, delivery-area settings (radius, express,
shop pin), admin cancel-for-customer and force-complete with reasons.

**Shared engineering:** 916 i18n keys in parity (`npm run check:i18n` just now:
916 keys both languages, 680 used literals, 16 dynamic families), single-brace
placeholders enforced, `_one/_other` plurals, 29 Node guard scripts wired into
`npm run lint` (22 chained checks: i18n, session, auth-doors, phone-field,
order-view, delivery, geo, persistence, speech, packs, unit-price, storage,
location, tracking, navigation, map-tiles, route, saved, metro, payments,
captcha), CI on every push, screenshot tooling (`scripts/screenshot-pages.mjs`,
`screenshot-pdf.mjs` — headless Chrome CDP, 412×915 phone viewport, light+dark).

---

## 6. What has actually been verified (and how)

| Claim | Evidence | What it does NOT prove |
| --- | --- | --- |
| DB schema + policies + money | `npm run test:db` → **1001 assertions, 0 failed** (re-run on Windows 2026-11-12), incl. a two-session concurrency race | Nothing about UI |
| Types & lint | `npm run typecheck` clean (both apps); `npm run lint` 0 errors/0 warnings, 22 chained checks | Lint checks are source-pattern assertions, not behaviour tests |
| i18n | `check:i18n`: 916 keys, parity, all used keys exist | Not a Kannada quality review (needs a local, M7) |
| Buildability | `expo export --platform web` (25 routes) and `--platform android` in CI; admin `next build` | Not installability, not rendering |
| Look of the app | 17 screenshots via headless Chrome (9 routes × light/dark, signed-out) + a PDF contact sheet | Only public routes, signed-out, desktop Chrome — not a phone |
| Sign-in path | A phone OTP was issued+verified against the live project (test numbers), a real session returned — with Expo Go **before** the SDK-57 wall | Only via Supabase *test numbers*, on a project with test numbers configured |
| Hosted schema | `npm run check:hosted`: 45 applied, 0 missing (5 files have no REST-visible object, proved by `test:db`) | Live SMS/DLT, live Razorpay — both absent by design |
| Expo SDK consistency | `expo-doctor` 21/21 | — |

**The sentence that matters most: nothing has ever run on a physical phone.**
Expo Go cannot load this project (SDK 57 vs Expo Go's SDK 58 — a hard version
wall), so even a cheap device run now needs an EAS **development build** (free,
~15 min cloud build) with an Expo account the owner must create.

---

## 7. Where the project is RIGHT (the honest strengths)

1. **Security is layered and tested, not declared.** RLS + guard triggers +
   generated columns + CHECK constraints + `security definer` RPCs + narrow
   views + staff-check-before-read. The forbidden cases are *tested* (e.g. a
   customer's direct update of `payment_status` touches zero rows; a forged
   transaction-local flag cannot change a total or a status).
2. **Money discipline is real, not stylistic.** Integer paise, one formatter,
   server-authoritative prices, generated line totals, a CHECK that
   `total = subtotal + fee − discount`. The one place a float could sneak in
   (fractional quantities for loose goods) was **rejected with a written
   reason** and replaced by structured packs, with `quantity is still an
   integer` as the first assertion of test 21.
3. **Idempotency and double-tap safety are designed in** (order idempotency
   keys, safe-retry settlement RPCs, disabled controls in flight).
4. **A genuine, deep test culture where it matters.** 1001 SQL assertions
   against real PostgreSQL including a concurrency race — that is the part of
   this system that holds money, and it is the best-tested part by far.
5. **Self-correcting engineering culture.** The `expo-doctor` Metro exemption
   was reversed with a post-mortem when the doctor turned out to be right; four
   register rows that were "not done" while the code existed were corrected by
   grep; the register now carries a rule: *set status by grepping the code,
   never from memory*. Two of their own lint checks were found wrong while
   writing the third — and both fixes are in the log.
6. **Documentation quality is far above average** for a project this size:
   `AGENTS.md` (the law), `PRODUCTION.md` (plan of record with
   `[VERIFIED]/[EXTERNAL]/[UNVERIFIED]` marks and a 41-item register),
   `HANDOFF.md` (move checklist), `CHANGELOG.md` (60 dated entries, admitting
   its own mistakes), `KUNIGAL.md` (language voice), `DESIGN.md` (visual system).
7. **Localisation done properly for the audience**: Kannada-first, 916 keys in
   parity, script-aware typography (negative letter-spacing suppressed for
   Kannada because it collides conjuncts), TTS hidden when no Kannada voice
   exists, statutory acronyms whitelisted rather than translated.
8. **Design decisions fit the town**: COD-first, landmark addresses, phone-based
   support, low-literacy affordances (icons, emoji, big targets, voice), offline
   caching that fails closed, a map with no key/billing account, honest
   refusals that name real numbers ("Sorry, delivery is currently available only
   within a 10 KM radius." with the measured distance).
9. **CI runs the same commands a developer runs** — no CI-only scripts, and one
   of them (the builds job) exists specifically because a bundle can die while
   typecheck passes.

---

## 8. Where the project is WRONG, WEAK, or RISKY (ranked)

**Blockers for a public release**

1. **Zero device runs. Ever.** Every "verified" claim is a build-machine or
   Postgres fact. Permissions, realtime sockets, TTS voices, gesture handling,
   Razorpay sheet, CAPTCHA WebView, print/share, Kannada rendering — all
   unexercised on hardware. Compounding: Expo Go is now a dead end (SDK 57 wall),
   so the cheapest possible device test needs an EAS dev build + a free Expo
   account, and that has been deferred for several sessions. **This is the one
   that should keep a reviewer from saying "production-ready".**
2. **Real sign-in is not enabled for real customers.** Phone OTP works only
   against configured *test numbers*; a paid SMS provider + India's TRAI DLT
   registration (entity → sender ID → approved template) is missing and is
   paperwork measured in days. Test numbers must be removed before launch.
3. **Every "live" external integration is dark by design:** no Razorpay keys
   (payment path built, untested end-to-end), no Turnstile site key (the
   CAPTCHA widget has never rendered — and enabling the dashboard switch before
   a site key exists would lock out *every* customer), no Sentry DSN (crash
   reporting inert; native crashes need a real build anyway).
4. **Owner-side data steps block real use**: the shop's `lat/lng` is NULL, so
   the distance rule cannot run (delivery falls back to the pincode zone); the
   production shelf is empty by design (6 demo products to be removed); FSSAI /
   GSTIN / Legal Metrology numbers absent; privacy-policy **URL** and `LICENSE`
   missing; Kannada dialect sign-off by a Kunigal local not done.
5. **Play closed test not started** — for a *personal* developer account it is
   12 testers × 14 continuous days before production access. Starting it the day
   the first installable build exists is the documented plan; it has not started
   because no installable build exists (see 1).

**Real weaknesses in the engineering itself**

6. **No UI/behaviour tests.** The 22 "checks" are static analyses of source text
   (regexes over the app's own code). They are valuable guard-rails, and the
   project says so, but two of them were *wrong while passing* until fixed, and
   none of them proves a screen works. There is no component test, no Maestro/
   Detox, no E2E. The only behavioural test in the repo is the SQL one.
7. **Documentation drift is a recurring, admitted problem.** The same numbers
   disagree across files *right now*: i18n keys are claimed as 702 / 717 / 743 /
   882 / 916; DB assertions as 787 / 850 / 957 / 1000 / 1001; "29 SQL test files"
   vs 38 on disk; `CHANGELOG.md`'s newest entry says 1000 assertions while a
   re-run yields 1001. For a project whose stated rule is "the newest file wins",
   that is a hygiene failure — a reviewer cannot trust any single number without
   re-running it.
8. **Unexplained artefact**: there is no `supabase/tests/04_*.sql` while files
   01–39 otherwise run consecutively; no doc explains the gap.
9. **`apps/admin` has no tests at all**, and Next 16.4.6 was bumped reactively
   for an **unauthenticated RCE that "was in range"** (commit 41255f8) — a good
   catch, but it shows the panel is on a manual-watch basis. It is also a second
   shelf-editing tool: `PRODUCTION.md` §14 lists "decide its fate" as an owner
   decision while a 2026-10-20 note says the dev side resolved it — the
   contradiction is still on the page.
10. **No analytics of any kind.** The plan's own success metric ("a second order
    from the same customer within a week") cannot be measured automatically;
    everything is "measure by hand".
11. **Minor debt, all admitted in-doc:** SDK 57 → 58 upgrade (RN 0.86→0.88,
    Strict TS default, router core rework) deferred to Phase 8; one binary ships
    all three faces with no staging/flags (register L6); iOS permission strings
    are English-only; a rider's dead phone means no position after 10 minutes
    (by design); `common.off` unused key and `expo-localization`-as-plugin are
    deliberate leftovers; the `CHANGELOG.md` was nearly destroyed twice by
    `write`-instead-of-`edit` (the rule now forbids it).

**What is *not* a weakness** (so a reviewer doesn't waste time on it): Expo Go
incompatibility (environmental, SDK-58 wall), the emoji fallback (deliberate for
low literacy), packs-not-fractions (argued and tested), no background location
(privacy decision), no admin switch for `online_payments_enabled` (deliberate:
flicking it before a gateway exists creates unpayable orders), no push
notifications (roadmap, not scope), no `expo-updates` (deliberate), the 60 s
polling backstop (explicitly a backstop for rural sockets).

---

## 9. Production-readiness verdict (as the brief frames it)

**Verdict: NOT production-ready — but the blockers are external and operational,
not architectural. The code and database are unusually mature for a pilot; the
*gap between the code and evidence* is the problem.**

Suggested order (mirrors `PRODUCTION.md`, which remains the plan of record):

1. **EAS development build + one real device walkthrough, in Kannada** (free,
   ~15 min build): sign-in (test numbers), browse → cart → address with door pin
   → order → cancel → reorder; then rider pool + owner board; force-kill and
   reopen to prove the session persists on a device. Log every failure verbatim.
2. **Then** SMS provider + DLT for real numbers (longest external pole);
   Turnstile site key → dashboard switch *second*; Razorpay test-mode payment
   before any live key; Sentry DSN.
3. **Owner data steps**: shop pin; real products with real photos; GSTIN/HSN
   decision with the CA; FSSAI number; privacy URL + terms + LICENSE; Kannada
   sign-off.
4. **Start the Play closed test the day the first installable build exists**
   (12 testers × 14 days is calendar time nobody can compress later).
5. **Fix the doc drift** (single source for the counts; add the missing test-04
   explanation; resolve the admin-panel decision) before more sessions make it
   worse.

Time-to-pilot is realistically **owner/calendar-bound** (DLT paperwork, 14-day
closed test, Mac or cloud build for iOS, Kannada sign-off), not code-bound. The
single highest-value hour in the project remains the first device run.

---

## 10. The questions the owner wants you (Claude) to answer

1. **Is this up to production standard?** Rank: the database/security layer, the
   mobile app architecture, the i18n/localisation, the test strategy, the docs.
   Say where we are **genuinely excellent** and where we are **fooling
   ourselves**.
2. **Where are we going wrong?** Judge our decisions on the merits, not their
   documentation: packs-not-fractions, RPC-for-every-write, no admin switch for
   online payments, OSM-OSRM instead of a maps SDK, allowlist-only persistence,
   text-first tracking, the static-analysis check scripts, Next.js panel's
   existence, deferring the device run, SDK 57 vs 58.
3. **Where are we going right?** Which of these decisions would you keep exactly
   as-is in a paid-code review?
4. **What is missing for launch that we have not listed?** Think about things we
   may have normalised: rate limiting beyond CAPTCHA, order-number collisions,
   web/SEO, accessibility, battery, the shared-phone identity model, invoice
   sequence resets, multi-device sessions, refunds actually being sent, the
   rider deleting their assigned orders, store migration away from Supabase.
5. **If you had to ship this to 50 real customers in Kunigal in two weeks, what
   would you change first, and what would you deliberately not touch?**

---

## 11. Reading map for the reviewer (repo files, in order)

| # | File | Why read it |
| --- | --- | --- |
| 1 | `AGENTS.md` | The rules: money in paise, two languages, RLS, the ten production standards, current state |
| 2 | `PRODUCTION.md` | Plan of record: phases, the 41-item register (C/H/M/L), Razorpay + CAPTCHA operator runbooks, store-calendar facts |
| 3 | `CHANGELOG.md` | 60 dated sessions: what was built, what was verified *and how*, bugs found, open gaps |
| 4 | `HANDOFF.md` | One-page current state + the laptop-move checklist + §6 "what is not done" |
| 5 | `KUNIGAL.md` / `DESIGN.md` | The language voice and the visual system (both are authorities, not notes) |
| 6 | `apps/mobile/src/lib/` (26 files) | The real logic: `money.ts`, `geo.ts`, `pack.ts`, `route.ts`, `map-tiles.ts`, `location.ts`, `invoice-html.ts` |
| 7 | `supabase/migrations/` (45 files) | The schema law; read `20261002000008_place_order.sql` → `20261112000001_gst_billing.sql` → `20261112000006_razorpay.sql` |
| 8 | `supabase/tests/` (38 files) | The behavioural proof; `02_place_order`, `19_shop_totals`, `21_pack_sizes`, `26_refund_due`, `39_razorpay`, plus the concurrency suite in `scripts/run-db-tests.mjs` |
| 9 | `scripts/check-*.mjs` (22) | The guard-rail style; note their nature (source-pattern asserts) |
| 10 | `docs/launch/` | `DEVICE-RUN.md`, `SMS-SETUP.md`, `STORAGE-POLICIES.md`, `LAUNCH-REGISTER.md`, privacy/terms drafts |
| 11 | `apps/admin/` | The optional desk panel (no tests) |
| 12 | `SCALE-AND-TRACKING.md`, `COMPETITOR-TEARDOWN.md`, `FEATURE-PARITY.md`, `ROADMAP.md` | Performance/concurrency decisions, competitor evidence, parity gaps, phase plan |

---

## Appendix A — re-verify every number yourself

```bash
npm run test:db     # expect: 1001 passed / 0 failed, two-session race included
npm run typecheck   # clean, both apps
npm run lint        # 0 errors, 0 warnings, 22 chained checks
npm run check:i18n  # expect: 916 keys in both languages, 680 used literals
ls supabase/migrations | wc -l            # 45
ls supabase/tests | wc -l                 # 38 (no 04_* — unexplained)
git log --oneline | wc -l                 # 77
git status --short                        # clean on 2026-11-12
```

Known-good state on 2026-11-12: hosted project "Kunigal Bazaar"
(`argahiagpywluxpqtnpp`, Postgres 17.11), all 45 migrations applied, 0 pending
(`npm run check:hosted`), test OTP numbers configured, 6 demo products on the
shelf (to be removed), `online_payments_enabled = false`, shop `lat/lng` NULL.

---

## Appendix B — the one-paragraph version (if you only paste this)

*Kunigal Bazaar is an Expo/React Native grocery-delivery app (customer, rider,
and owner faces in one binary) over a Supabase/Postgres backend whose money and
permission rules live entirely in the database: 45 migrations, RLS everywhere,
guard triggers, generated money columns, and 1001 SQL assertions against real
PostgreSQL including a concurrency race. Kannada-first with 916 i18n keys in
parity, integer-paise money with one hand-rolled formatter, GST invoices and
PDFs built from Postgres arithmetic, a built-but-dark Razorpay path with three
Edge Functions, a key-free OpenStreetMap/OSRM map, consent-gated rider location,
and CI running the exact commands a developer runs. The engineering culture is
self-critical and exceptionally well documented. It is **not production-ready**
for one dominant reason: **it has never run on a phone** (Expo Go's SDK-58 wall
means the first device run needs an EAS dev build that has not been made), plus
real SMS/DLT, Razorpay keys, Turnstile key, Sentry DSN, the owner's shop pin and
statutory numbers, and Play's 12-tester/14-day closed test are all outstanding.
Secondary weaknesses: no UI/E2E tests (the 22 lint checks are source-pattern
asserts, two of which were themselves wrong until fixed), no analytics, doc
numbers drift between files, an untested Next.js admin panel that received a
reactive security bump, and an unexplained gap in the test-file numbering.*
