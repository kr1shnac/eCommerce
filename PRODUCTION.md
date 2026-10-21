# PRODUCTION.md — the plan of record to a real Kunigal release

**Status:** draft, 2026-10-19. **Authority:** for *how we get to a public release*
this file wins over `ROADMAP.md`. The ROADMAP is what we meant to build; this is
what is actually true and what actually comes next. `AGENTS.md` still owns the
rules, `KUNIGAL.md` still owns the language, `DESIGN.md` still owns the visuals.

**Where this came from:** a five-advisor, five-reviewer adversarial review of the
whole repository (the council run kept in `.council/runs/20261019-1731-kunigal-production-review/`
— see that folder's `report.html` for a readable version). Where this file says
"the council", that run is meant. The register in §12 is the chairman's, item for
item.

---

## 0. How to read this file

Every claim carries one of three marks. Nothing is stated without one.

| Mark | Means |
| --- | --- |
| `[VERIFIED]` | Read out of this repository, or run on this machine, in this session. The evidence is named. |
| `[EXTERNAL]` | A store/legal/statutory claim checked against a live public source in this session. The source is named. Store and legal rules change; re-check before you rely on a date. |
| `[UNVERIFIED]` | An advisor or reviewer claim that this session did **not** confirm. Treat it as a hypothesis with an owner and a verification step, never as a fact. |

And one rule that overrides everything else in here, from `AGENTS.md` §9.10: a
step is finished only when `npm run typecheck` passes, `npm run lint` passes,
`supabase/tests/` passes against real PostgreSQL, and a dated `CHANGELOG.md`
entry says what was verified and how. "It compiles" is not "it works".

---

## 1. What this software is for, for these exact people

Kunigal: ~34,000 people in the town, ~1.9 lakh in the taluk (2011 census).
Literacy ≈ 69% — roughly **one adult in three cannot comfortably read a full
sentence**. Kannada first, cash first, ~70 km from Bengaluru, patchy 4G. Full
facts and the language contract live in `KUNIGAL.md`; this section is only the
part that shapes the plan.

### The job

Today, buying from this shop means a phone call, a shouted list, and hope. The
app's whole reason to exist is to **replace one phone call with something faster
and more trustworthy — for one shop, one street, on the phone the customer
already owns.**

### What that translates into, feature by feature

| The real situation in Kunigal | What the product must therefore do | Where it is now |
| --- | --- | --- |
| One in three adults cannot comfortably read a sentence | The meaning must survive without reading: icons, numbers, big targets, and eventually voice. Kannada text never smaller than English. | Mostly done (`KUNIGAL.md` §2); **voice is not built** — register H4 |
| Kannada is the default, not a preference | Kannada loads first; English is the one-tap switch. | Done — `DEFAULT_LANGUAGE = 'kn'` |
| Cash economy, low order values | Cash on delivery is the *primary* path, never an apology. UPI is a bonus. | Done — COD only today; Razorpay deliberately not started |
| Joint families share one handset | "One phone = one person" is false here. | **Not handled** — register H10 |
| Homes have no reliable numbering | The address must be a landmark a rider can find, plus a phone call. | **Yes** — `landmark` is a column, is captured at checkout, is snapshotted onto the order, and now leads the rider's card (register M5) |
| Loose goods by weight (ragi, millet, coconut, dal, chilli) | Half a kilo must be orderable and priced. | **Handled as a pack, not a fraction** — `sold_by`/`pack_size`/`pack_unit` + `product_pack_options`, and "also in 1 kg" chips; `quantity` stays an integer `[VERIFIED]` — register M4 |
| Word of mouth travels in one step | Trust devices matter more than discounts: the shop's own name, the licence, the rider's name and face. | Rider assignment is live; licence/legal display is not — register H6/H7 |
| The rider *is* the app's interface | Who is coming, can I call them, when will they arrive. | Assignment + realtime live; no call action, no push — register H2 |
| The owner runs a cash business alone | "How much did I collect today, and how much does Ravi still owe me" is his most-wanted number. | **Does not exist** — register H3 |

### What success is (so the plan has a target)

Not downloads. The first proof is: **one real customer, in Kunigal, on their own
phone, places a cash order end to end — and places a second one within a week.**
Everything before that is preparation; everything after it is growth.

---

## 2. The verdict this plan comes from

The council's answer, in one line: **do not release yet.** Fix the front door,
then run a small closed pilot on internal builds. The store calendar and the
statutory/legal layer — not code speed — set the real launch date.

Three showstoppers, all of them facts about this repository:

1. **Nobody can sign in.** The app's only customer path is phone one-time-code,
   and phone sign-in is disabled on the hosted project (`422 "Phone logins are
   disabled"`). The repo's own `supabase/demo-accounts.sql` header admits it:
   "until an SMS provider is configured NOBODY can sign in." — register C1.
2. **Nobody stays signed in.** `createClient` was given `persistSession: true`
   and no `storage` adapter, so `@supabase/auth-js` fell back to a per-instance
   in-memory object under Hermes. The language and the cart survived a restart;
   the login did not. — register C2, **fixed in this commit** (§4).
3. **Nobody can install it.** `app.json` had no `android.package` and no
   `ios.bundleIdentifier`, and there was no `eas.json`, so there was no build
   artefact to release. — register C3, **fixed in this commit** (§4).

…and the meta-flaw that made all three easy to miss: **nothing has ever run on a
device or an emulator.** Every "DONE" in `ROADMAP.md` means "type-checks and 348
SQL assertions pass". That is a real achievement about Postgres; it is not
evidence about Kunigal. — register C4.

Finally, the cash loop is open: the owner's "Today" totals screen does not exist,
so the first cash variance he cannot reconcile is the day he stops using the app.

---

## 3. Where the repository actually stands today

`[VERIFIED]` by running the commands in this session unless marked otherwise.

| Area | State |
| --- | --- |
| Database | 17 migrations, RLS + guard triggers on every table, integer paise, generated `line_total_paise`, CHECK on `total_paise`, conditional stock decrement |
| Database tests | **348 assertions, 0 failures**, against real PostgreSQL (`npm run test:db`) |
| Typecheck / lint / i18n | Clean. **416 keys in parity** across `en.json` and `kn.json` |
| Mobile app | Three faces by `profiles.role` (customer / rider / admin), realtime order updates, light **and** dark themes, design system in `src/components/ui/` |
| Install path | `app.json` + `eas.json` now exist (this commit). Still never built |
| Device runs | **None. Ever.** No screenshot, no emulator session, no APK |
| Sign-in | Phone OTP only in release builds; the email+password path is `__DEV__`-gated |
| CI | None (`.github/` does not exist) |
| Crash reporting / analytics | None (`expo-updates`, push, Sentry all absent from `package.json`) |
| Payments, push, maps | Deliberately not started |
| Expo SDK | `~57.0.26`. Latest is `58.0.14` `[EXTERNAL]` (npm registry, 2026-10-19) |

> **Snapshot, not current fact.** This table is how the repository stood when
> Phase 0 landed (2026-10-19). Two rows have since changed: **CI now exists**
> (`.github/workflows/checks.yml`, register H12) and **Sentry is now in**
> (`src/lib/crash-reporting.ts`, register H11). "Never built" and "no device run"
> are, sadly, still true. Read §12 for the current status of any row.
| Deployable admin panel | `apps/admin` is a skeleton, optional, kept only for bulk catalogue edits |

---

## 4. Phase 0 — the front door (this commit)

Two edits and one new file. Small, and the highest-value work in the repo.

### 4.1 The session now survives a restart

`apps/mobile/src/lib/supabase.ts` passes `storage: AsyncStorage` to
`createClient`. `@react-native-async-storage/async-storage` was already a
dependency (the cart and the theme already use it), so this adds no new package
and no new place where data lives.

**Why it was broken** `[VERIFIED]`: `@supabase/auth-js` uses
`globalThis.localStorage` only when it exists *and* is writable, and otherwise
builds a `memoryLocalStorageAdapter` over a plain per-instance object. React
Native has no `localStorage`, so two client instances shared nothing.

**How it was verified** `[VERIFIED]` — headless, on this machine, in Node 22:

```bash
npm run check:session
```

16 checks, all passing (`scripts/check-session-persistence.mjs`). The script
deletes `globalThis.localStorage`, then:

- **before** (the old options): two instances resolve to *different* in-memory
  stores, the first can read the session it wrote, and a fresh instance — the app
  after a cold start — sees `null`;
- **after** (`storage: AsyncStorage`, the genuine npm package): both instances
  resolve to the same store and a fresh instance recovers the session;
- **the real file**: `apps/mobile/src/lib/supabase.ts` is imported under plain
  Node (`--experimental-strip-types`), and it is asserted that it hands a storage
  adapter to `createClient`, that a client restarted over that store recovers the
  session, and that a client **without** the option loses it;
- **control**: with `window` + `document` + `localStorage` present, auth-js finds
  `localStorage` by itself — which is why the defect is invisible in a browser
  and only bites on the phone.

**What this does not prove:** that the native AsyncStorage store works on an
Android device. That is Phase 1, and it is a force-kill-and-reopen test.

### 4.2 It can now be built and installed

- `apps/mobile/app.json`: `ios.bundleIdentifier` and `android.package` are both
  `in.kunigal.grocery`; `ios.buildNumber` and `android.versionCode` start at `1`.
- `apps/mobile/eas.json` (new): `preview` profile = internal distribution,
  Android `.apk`; `production` profile = store build with
  `autoIncrement` on `versionCode` / `buildNumber`; `cli.appVersionSource` is
  `local`, so `app.json` stays the source of truth for versions.

Both were checked with `npx expo config --type public --json`, which now resolves
all four values correctly `[VERIFIED]`.

**Decision to confirm with the owner.** The reverse-DNS prefix `in.kunigal` is a
guess. `android.package` is immutable once an app is uploaded to Play, and the iOS
bundle identifier is immutable once the app exists in App Store Connect. Nothing
has been uploaded, so changing it now is free and changing it later is not.
→ §14, question 1.

**Not run here:** `eas config` (it needs an EAS login) and any build (needs an
Expo account, and an iOS build needs macOS or a cloud Mac).

### 4.3 What Phase 0 deliberately does **not** do

No `development` EAS profile (it needs `expo-dev-client`, which is not a
dependency — install it when a development build is actually wanted). No
`expo-updates`. No CI. No crash reporting. Those are Phases 1–4.

---

## 5. Phase 1 — one real device run (the highest-value hour in the project)

Nothing in this repository has ever rendered on a phone. **Still true.** What has
now been proven, on a machine with no Android SDK at all, is only that the thing
*can* be built: the 4.4 MB Android Hermes bundle assembles with the Kannada fonts
carried, and `expo prebuild` writes `applicationId 'in.kunigal.grocery'` /
`versionCode 1` into the generated Gradle config `[VERIFIED]` (see `CHANGELOG.md`,
2026-10-20). That is a build-machine fact. It is not a phone fact.

1. `npx expo start` on a physical Android phone on the shop's own 4G — not the
   office Wi-Fi. Read `ROADMAP.md` §14.1 for the checklist it should cover.
2. Walk it **in Kannada**: browse → add to cart → checkout → place order → watch
   the order screen → cancel → reorder. Then the rider pool and the owner board.
3. Force-kill the app and reopen it. Confirm the session is still there (§4.1).
   `npm run check:session` proves the storage **wiring** under Node; only this step
   proves the native AsyncStorage store on a handset. It is the single highest-value
   check in the project.
4. Log every failure **verbatim** in `CHANGELOG.md`: the screen, the tap, the
   Kannada string, what appeared, what was expected.

Acceptance: the checklist runs to the end without a crash, and every failure is
written down. Add crash reporting (register H11) before or during this, because a
pilot you cannot see inside is not a pilot.

---

## 6. Phase 2 — a sign-in that works for a real customer

The only release sign-in path is phone OTP, and OTP is switched off.

- **Owner-only work:** enable Phone auth on the Supabase project and fund an SMS
  provider. In India that also means **DLT registration of the sender ID and the
  message template** — a paperwork step measured in days, not minutes, and the
  single longest pole in this phase. `[UNVERIFIED]` as a timeline; the
  requirement itself is standard for Indian SMS.
- ✅ **Guard the door either way — DONE.** The app never shows a raw provider
  error. A failed sign-in now gets a Kannada sentence, a `CallShop` button to the
  shop's own number, and a dedicated offline sentence; the Supabase test-number
  hint is `__DEV__`-only, because it is developer advice, not customer advice.
  `apps/mobile/src/app/login.tsx`.
- ✅ **Register C8 — the store reviewers cannot log in** (Apple `[EXTERNAL]` 2.1(a)
  wants a demo account; Google asks too) — **DONE, in code.** A fourth door exists
  that is deliberately **not** `__DEV__`-gated: it opens when
  `EXPO_PUBLIC_REVIEW_EMAIL` + `EXPO_PUBLIC_REVIEW_PASSWORD` are both set, which
  they are only in the new `review` EAS profile. It is **one customer account**,
  never an admin. A plain `production` build — even with the demo variables set —
  has no door at all, and the three dev accounts are now dropped from a release
  bundle rather than merely hidden. Proven by `npm run check:auth-doors`
  (15 checks), now part of `npm run lint`. **Owner action left:** create that
  account in the project's Auth users and set the two variables in the review
  environment.
- ✅ **Account recovery** (register H9) — **DONE, honestly.** The sign-in *is* the
  phone number, so a changed number is a lost account; in this town that is the
  common case, not a corner case. Account → "Changed your phone number?" now
  explains the path in the shop's voice and puts the shop's number one tap away.
  The shop moves the number from the admin panel. There is deliberately **no**
  self-serve change: with OTP-only auth the customer cannot prove the old number,
  and an unauthenticated "change my number" endpoint would be an account-takeover
  hole.
- **Still open in this phase:** the owner's half above (provider, DLT, the
  reviewer account row), and a device run to see the new login states on a phone.

---

## 7. Phase 3 — the legal and store minimum (gates, not polish)

This is a small shop in Karnataka selling groceries, some of them food, over the
internet. That triggers a short list of statutory duties. Two of them are
`[EXTERNAL]`-verified in this session; the rest are `[UNVERIFIED]` and must be
checked with the shop's accountant before the plan hardens.

| Duty | What it means for the product | Status |
| --- | --- | --- |
| **Privacy policy + terms + a licence** `[VERIFIED]` | A hosted privacy policy URL is required by both stores, and there was no `privacy` copy, no terms and no `LICENSE` anywhere. **In-app half DONE** (`src/app/privacy.tsx`, `privacy.*` in both locales). The **hosted URL** is still missing and is a client deliverable — it needs the domain, and it is the URL the store listing points at. | Register C5 — in-app done |
| **Account deletion, in-app** `[VERIFIED]` | Both stores require a way to delete the account and its data from inside the app, not by email. **DONE**: `delete_my_account()` (migration 20261020000001), the Account screen's button, and test 16 (29 assertions). | Register C5 — done |
| **DPDP notice, in a language the person understands** `[EXTERNAL]` | DPDP Act 2023 s.6(3) + DPDP Rules 2025 Rule 3: the notice must be accessible in English **or an Eighth Schedule language** — Kannada qualifies. The rules were notified 13 Nov 2025 and the notice obligations (Rules 3, 5–16, 22, 23) come into force **18 months after publication, i.e. around May 2027**. **DONE as content**: the notice is `privacy.*` in `en.json` **and** `kn.json` and renders offline. | Register H5 — done |
| **Retention** `[EXTERNAL]` | The DPDP Rules' 3-year-inactivity erasure duty applies to "e-commerce entities" above substantial user thresholds. A one-shop app is very likely outside it — but the erasure *capability* is worth having anyway, and it now exists. | Feeds C5 — done |
| **FSSAI licence display** `[EXTERNAL]` | FSSAI's guidance lists "display of FSSAI registration/licence number of the FBO", and its e-commerce guidance requires the number on the transaction document / digital receipt. **Fields DONE** (`stores.fssai_number`, shown on the privacy screen and the order footer when set). **The number itself is a client input**, and is deliberately absent until then. | Register H6 — fields done, number needed |
| **Legal Metrology declarations** `[UNVERIFIED]` | The Packaged Commodities Rules require declarations (MRP, net quantity, seller/manufacturer details, consumer-care contact). `mrp_paise` exists; **fields DONE** for the rest (`products.packer_name`, `products.net_quantity`, `store_settings.receipt_footer`). **Verify the exact wording with the CA.** | Register H7 — fields done, wording unverified |
| **GST / a cash memo** `[UNVERIFIED]` | Whether this turnover is GST-registered, and what a compliant cash memo must show, is a question for the shop's accountant. **Field DONE** (`stores.gstin`, shown when set). | Register H8 — field done, number needed |
| **DPDP consent notice in Kannada** `[EXTERNAL]` | The notice must be accessible in an Eighth Schedule language. Kannada is one. **DONE**: `privacy.*` in both locales, written in the KUNIGAL voice. | Register H5 — done |

Also in this phase:

- **Remove every demo account from the hosted project** (register C7). The
  `supabase/demo-accounts.sql` header says clearly that the file is
  development-only and that the passwords are not in the repository; but this
  machine's git-ignored `.env` defines the demo addresses, so the script has been
  run against *some* project. Check Auth → Users on the hosted project and delete
  anything named `demo`. The owner's own account must have MFA.
- **No developer text on a customer screen** (register M9). `auth.testNumbers` in
  `en.json`/`kn.json` is developer text showing on the login screen. It is now
  `__DEV__`-only, so it cannot appear in a release build — but it should be
  deleted outright before the public release, not merely hidden.
- **A `LICENSE`** (register C5, still open). The repo has none. Decide the licence
  before the code is shown to anyone outside the shop.
- **One phone, several adults** (register H10). Decide the household model
  explicitly and write the decision down, rather than discovering it in the pilot.
- **A second admin** (register H9): the owner locked out of his own shop with no
  second admin is an outage of the business. `delete_my_account()` now refuses to
  remove the shop's only admin, so the two halves agree.

---

## 8. Phase 4 — build it, then pilot it small

### The build

- An Expo/EAS account the owner controls (not a personal developer account with
  the developer's own name on the store listing, unless that is the intent).
- **iOS cannot be built or run from this Linux machine** (register M12). Either a
  cloud Mac runner (EAS handles this) or accept Android-first and defer iOS —
  which is defensible: the shop's customers are on Android.
- One `preview` build, installed by sideloading the `.apk`. This is the artefact
  the pilot uses.

### The pilot (option (c) in the council's terms)

Internal-track APK, handed to the owner, the 5–6 riders and a handful of real
customers — **outside the Play Store**, because Play production is gated (§9).

Measure by hand, on paper if necessary, every day:

- orders placed, and **how many were placed by the same customer twice**;
- cash collected versus cash expected, per rider (register H3 — until the app
  has a "Today" screen, this is the owner's ledger and it is how you find out
  whether the app is worth keeping);
- every basket that died at the ₹100 minimum, and every basket that grew to
  reach the ₹500 free-delivery line (register H1, L3);
- every delivery that failed and why (register M3 — **now DONE**: `failed` /
  `returned` are real statuses with a required reason, so a rider can close an
  order honestly and the owner can read why).

### The customer-trust half — DONE

The three items that cost nothing, need no client input, and carry the most trust
in a town where the rider is the interface:

1. **The rider is a person, not a status** (M5 / H2 trust half). The order screen
   shows the assigned rider's **name and photo**, and a **Call the rider** button
   that opens the dialler pre-filled. Backed by the `rider_directory` view
   (migration 20261021000001), which exposes exactly four columns — id, name,
   photo, phone — and no other profile field, so a customer can see the rider
   without the app ever handing out another person's profile row. Proved by
   `supabase/tests/18_order_tracker_test.sql`.
2. **An honest end state** (M3). `failed` and `returned` exist, with a required
   reason (`not_home`, `wrong_address`, `refused`, `unreachable`, `other`) and an
   optional rider note. Both are **terminal**: the guard refuses to reopen a
   failed order as delivered. Both surfaces are covered — the rider picks a
   reason from a panel, the customer reads it in a translated sentence with
   "nothing was charged, call the shop and we will send it again".
3. **The failed order is no longer mistaken for a cancellation.** `cancelled`
   means nobody left the shop; `failed` means a rider stood at a door. They have
   different icons, different colours and different words in both languages, and
   the customer's Orders filter counts both as finished without conflating them.

### The owner's ledger — DONE (register H3)

The pilot's paper reconciliation now has a screen behind it. **Today**, a new tab
in the owner's face, answers the closing-time question: how much came in, how
much is still in a rider's pocket, and what the day cost in giveaways.

The figures are computed by `shop_day_totals()` and `shop_day_by_rider()`
(migration `20261021000002_shop_totals.sql`), **not** summed in the app. That is
not decoration: the owner's board fetches at most 100 orders, so summing those
would report a confident, wrong total on any busy day, and it would look right.
The rule the functions encode — a failed delivery is not a sale, COD that has not
been paid is a rider's pocket rather than the shop's bank — lives in one place,
next to the ledger, and is proved by `supabase/tests/19_shop_totals_test.sql`.

Writing that test found two real bugs in the first draft of the design, both
worth recording because they are the kind that ship silently:

1. **`gross` counted failed deliveries as takings.** A failed order was included
   because it was not `cancelled`. The rider came back with the bag; no money
   changed hands. The day was overstated by exactly the orders that went wrong.
2. **There was no refund liability at all.** A customer who paid online and never
   got their order was invisible on the screen. `refund_due_paise` now shows that
   money, kept deliberately separate from takings — the shop holds it and owes it.

Both functions refuse anyone who is not staff, checked before a single row is
read, so the publishable key cannot be used to read the shop's money.

### The shelf, from the counter — DONE (register M2, second half)

The owner can now change a price, change stock, or take something off the shelf
from the phone (`apps/mobile/src/app/admin/shelf.tsx`, a new **Shelf** tab),
backed by `update_product_from_shop()` (migration `20261021000003_product_guard.sql`,
proved by `supabase/tests/20_product_guard_test.sql`, 20 assertions).

**No column was added and no policy was widened, and that is the point.** `products`
already had `price_paise`, `mrp_paise`, `stock_qty` and `is_active`, and the
existing CHECKs (`price_paise > 0`, `mrp_paise >= price_paise`, `stock_qty >= 0`)
already bind the owner as well as a customer — test 06b proves that. What was
missing was not a place to put the number, it was **a door that tells the truth**.

Two things had to be built:

1. **A save button that cannot lie.** `supabase.from('products').update(...)` by
   anyone who is not the shop matches **zero rows and raises no error** — RLS
   simply filters the row out. Every existing test relies on this. A screen
   trusting it would show *Saved* while nothing was saved, which is exactly the
   failure AGENTS.md §9.4 is about. The RPC raises instead of going quiet, and
   returns the row as the database now holds it, so the screen shows the stored
   number rather than the intended one (§9.1).
2. **A guard that freezes identity.** The policy says an admin may write *any*
   column. `guard_product_update()` narrows that to what a counter edit actually
   is, so a mis-tap cannot rename a product or **move it to another shop** (which
   would silently repoint existing order history). The shop is one shop; if a
   second ever exists that becomes a deliberate migration, not a tap.

**A real bug this surfaced, worth recording.** The first version of the guard
refused *every* non-admin write to `products` — which broke `place_order()`, whose
stock decrement is the one legitimate non-admin write to that table. It is
`security definer`, but the caller's JWT is still the customer's, so a role check
alone saw "a customer editing the shelf" and refused every order in the app. The
final design uses the same device `delete_my_account()` already uses: a
**transaction-local flag** set only by the two order functions, plus a **shape
check** that while the flag is set only `stock_qty` may differ. A flag alone would
be a hole any customer could borrow; with the shape check the only write it
unlocks is a stock move.

Re-creating `place_order` for the flag exposed a second trap: the current version
lives in `20261014000004_coupons.sql` (six arguments, coupon support), not the
five-argument original in `20261002000008`. Copying the original would have
**silently deleted coupons**. The migration was rebuilt from the coupons version
and a mechanical `diff` confirms the only difference is the four added
`set_config` lines.

### Crash reporting and CI — DONE (register H11, H12)

**Crash reporting (H11).** `@sentry/react-native` is wired through
`apps/mobile/src/lib/crash-reporting.ts` and started at module scope in
`src/app/_layout.tsx`, before the first component renders, so an error thrown
while the tree is being built is still captured. `Sentry.wrap` surrounds the root,
which is what turns an unhandled render error into a report instead of a white
screen — the failure mode a customer never reports.

Three decisions worth keeping:

1. **The DSN is in the app, and that is correct.** A Sentry DSN is a *write-only
   ingest key*: it can send events to one project and cannot read anything back.
   It is designed to ship in a client binary, and it is not the same category of
   mistake as a Supabase secret (AGENTS §9.6). It still lives in `.env`, not in
   the repo.
2. **It sends no personal data.** `sendDefaultPii: false`, plus a `beforeSend` that
   strips the user block, cookies and query strings, in one place so there is one
   thing to audit rather than a rule scattered across the app. The only identifier
   attached is an opaque Supabase user id, cleared on sign-out. In a town this
   small, a crash report is not the place to leak a neighbour's address.
3. **If the DSN is absent, nothing starts.** A local checkout gets no reporting and
   no noise, and a reporting failure can never itself be a crash.

**The honest limitation, which should not be discovered at submission time:**
native crashes (the app dying in Kotlin/Swift) are **not captured in Expo Go** —
only JavaScript errors are, and only in development. Full crash reporting needs a
development or release build. This is the same wall push notifications and
Razorpay hit, and it means **the value of H11 is not realised until the first
`eas build`**.

**CI (H12).** `.github/workflows/checks.yml` runs on every push and pull request.
It runs **the same commands a developer runs** — there are deliberately no
CI-only scripts, so green CI means green locally and neither is a special case:

| Step | Command |
| --- | --- |
| typecheck | `npm run typecheck` |
| lint + i18n parity + auth doors | `npm run lint` |
| session survives a restart | `npm run check:session` |
| database suite | `npm run test:db` |
| Expo SDK consistency | `npx expo-doctor` |

PostgreSQL 16 is installed in the job because `supabase/tests/run.sh` boots its
own throwaway cluster with `initdb`/`pg_ctl` and needs no service or container.

**One exemption, and it is argued rather than assumed.** `expo-doctor` reports
`resolver.disableHierarchicalLookup mismatch` in `metro.config.js`. That line is
**deliberate and required by Expo's own monorepo guide** — with npm workspaces, it
is what stops two copies of a package being loaded at once, and `npx expo export`
proves the bundle builds with it in place. Removing it to quieten the doctor is the
change that would actually break the build. So the workflow drops *only* that one
block and fails on any other complaint of any kind, including whatever new check
the doctor gains next. The filter was tested against three inputs — the real output
(→ pass), a simulated SDK-drift failure (→ fail), and both together (→ fail); the
last is the case that matters, because an exemption that masks a real problem is
worse than no exemption.

Running the doctor in CI also found **six packages had drifted off the SDK's
expected patch versions** (`expo`, `expo-constants`, `expo-crypto`, `expo-linking`,
`expo-router`, `expo-splash-screen`). All were upgraded within SDK 57 and the whole
gate plus a real bundle export were re-run afterwards.

### The landmark, and the drift it exposed — DONE (register M5)

**M5 was already built, and the register said it was not.** `landmark` has been a
column since `20261002000004_addresses.sql`; the checkout form has collected it
(`apps/mobile/src/app/address.tsx`); `place_order()` has snapshotted it onto the
order. The register entry was written from memory rather than from the schema and
was simply wrong for three sessions.

**The check was the work.** Before touching anything: `grep -rn landmark` across
the migrations, the screens and the types. What it found was the *real* gap —
`formatSnapshotAddress` existed and was used by the owner's board, but the
**customer's order screen joined the address by hand** (five lines of inline
`[line1, line2, landmark, city+pincode].filter(Boolean).join(', ')`), and the
**rider's cards rendered the same comma list** via the shared helper. Three
screens, two of them hand-rolled, all trying to say one thing.

So the change is not "add a landmark field". It is:

1. **The customer screen now calls the shared helper** instead of duplicating the
   join. The two can no longer disagree about what an address says.
2. **The rider gets a different question answered.** A customer reads their own
   address and knows where they live — the sentence is a reminder. A rider is
   *finding* a house, on a bike, in a town with no reliable numbering: the
   landmark is the instruction and the house number is the part that may not
   exist. So `splitSnapshotAddress()` pulls the landmark out, and
   `RiderAddressBlock` renders it first, bold, under a flag icon, with the rest as
   supporting detail. When there is no landmark it falls back to the plain
   sentence rather than showing an empty heading — which is the common case,
   because the field is optional.
3. **Both rider cards use one component** (the waiting pool and "my
   deliveries"), so they cannot drift apart the way the three screens already had.

**`readSnapshotAddress`'s parameter was loosened, deliberately.** It was typed
`Pick<Order, 'delivery_address'>`, which rejected the customer screen's
`OrderWithItems`. The honest contract is "anything with that column, and I will
check the value at runtime" — the column is `jsonb`, so runtime checking is the
only option anyway. Tightening it back would re-break a caller for no safety
gained.

**A new check, because this module had none.** `apps/mobile/src/lib/order-view.ts`
is imported by the rider's screen, the owner's board and the customer's order
screen, and had **zero** test coverage. It is pure logic — no React, no network —
so it can be tested honestly from Node without a device, which is why it now is:
`scripts/check-order-view.mjs`, wired as `npm run check:view` and into `npm run
lint` (so it runs in CI). **48 assertions**, covering malformed jsonb (a string, a
number, an array, null), the empty-parts join that would otherwise render
`"Main Road, , , 572130"`, landmark-first splitting with no part lost between the
halves, the `hasLandmark` fallback, `dialablePhone` refusing a number too short to
call, and `isSameDay` comparing **local** calendar days — the thing "today's
takings" depends on, and the one a UTC comparison gets wrong at 23:59.

**What this does not prove:** that any of it renders correctly. Still no device
(§5), so the rider card's new landmark line has never been looked at on a phone.

### The catalogue survives closing the app — DONE (register M1)

The app targets patchy rural 4G, which is why `OfflineBanner` exists and why
AGENTS §9.3 is a rule. But the banner only helped a customer who was **already in
the app**: React Query's cache lived in memory, so it died with the process. Open
the app in a dead spot and the shop's shelves were a blank page with a spinner,
even though they had been fetched ten minutes ago.

Now the cache is written to the device and hydrated on the next cold start. The
visible behaviour: **open offline → the shelves are there, with the quiet amber
offline banner → it silently corrects itself when a bar appears.**

**`AsyncStorage` is a plain file on the phone, so the interesting part is what is
*not* written to it.** `shouldPersistQuery()` in
`apps/mobile/src/lib/query-persistence.ts` is an **allowlist** on the query key's
root:

| Persisted (public shop data, identical for everyone) | Not persisted (belongs to a person, or staff-only) |
| --- | --- |
| `categories`, `products`, `product` | `orders`, `order` (carries the delivery-address snapshot), `addresses`, `address`, `profile`, `rider`, `rider-directory`, `shelf`, `shop-totals`, `coupons`, `cart-products` |

**A denylist was rejected on purpose.** A denylist fails *open*: the day somebody
adds a `useSomethingSensitive()` hook, its data is silently persisted and nobody
notices. An allowlist fails *closed* — a new key is simply not cached, and the
worst case is a slower first screen. The one that would matter most is `order`:
a plain file on a shared phone holding where somebody lives is a DPDP problem, not
a performance one.

Two constraints that are easy to get wrong and are therefore written in the file:

- `gcTime` must be **≥** `maxAge` (`7 days`), or React Query garbage-collects a
  query from memory before the persister can restore it. This is the most common
  way the feature silently does nothing.
- The cache key is namespaced (`kunigal-query-cache`) so it cannot collide with the
  auth session that `src/lib/supabase.ts` also keeps in `AsyncStorage`.

The cache is **display only**. The price a customer is charged still comes from
`products` at write time inside Postgres (AGENTS §9.1) — a week-old cached price
can be *seen* but never *charged*.

**`check:persist` (27 assertions), and it found a real bug.** The first version of
`shouldPersistQuery` read `query.queryKey[0]`, which throws on a query object with
no `queryKey` — during hydration, before the first paint. That is an app that does
not open at all. The test caught it; the function now checks the shape first. The
test also enumerates every forbidden key **by name with the reason**, so the
exclusions are argued rather than implied, and pins the fail-closed behaviour that
a future `useLoyaltyPoints()` must inherit without anyone reading the module.

### Loose weights, without breaking the paisa — DONE (register M4)

The register's original line was "`quantity` is an integer, so loose weights cannot
be sold". The obvious fix — make `quantity` a `numeric` so a customer can order
0.5 kg — is **wrong**, and the whole work here is about rejecting it for a testable
reason rather than a preference.

`order_items.line_total_paise` is a **generated** column,
`price_paise * quantity`. Make `quantity` fractional and three things break at once:

1. `line_total_paise` becomes fractional, but it is an `integer` column — the
   line total has to be **rounded**, and
2. `place_order()` sums those line totals into `orders.subtotal_paise` with its own
   integer arithmetic, which rounds **a second time**, in a different place;
3. `orders_totals_add_up` is a CHECK
   (`total = subtotal + delivery − discount`). Two roundings that disagree by one
   paisa do not fail loudly — they fail **intermittently**, on baskets that happen
   to land on a half-paisa, which is the worst possible bug for a shop's books.

There is a second, quieter reason: "0.5 of a tomato" is not how this shop speaks.
A half-kilo in Kunigal is a **packet**, priced as a packet.

**So the shape is a pack, not a fraction.** `quantity` stays an integer and counts
**packs**; the pack is described once, in structured columns:

- `products.sold_by` — `piece` (counted: soap, biscuit) or `measure` (weighed or
  poured: rice, dal, milk);
- `products.pack_size numeric(10,3)` and `products.pack_unit` — the closed enum
  `g | kg | ml | l | piece`;
- a CHECK, `products_pack_fields_agree`, refuses a `measure` product with no pack,
  and a second CHECK refuses a pack of zero or less — a weighed product with no
  weight is a contradiction, not an edit;
- `product_pack_options` is a view that normalises every pack onto one scale
  (g/ml), which is what makes "500 g and 1 kg" comparable at all. It is
  `security_invoker = true`, so it is not a way around the products RLS policy.

Migration `20261021000004_pack_sizes.sql`; test
`supabase/tests/21_pack_sizes_test.sql` — **29 assertions**. Its first assertion is
the one that matters most: `quantity` **is still an integer**. That single line
fails the day somebody "simplifies" the schema back to a decimal, and it is the
reason the test exists at all. The test also proves a client **cannot send a line
total at all** — the generated column refuses one with `428C9`, which is stronger
than the server overwriting it — and that an order total off by one paisa is still
refused.

**The guard learned the pack too.** `guard_product_update()` now freezes
`sold_by`, `pack_size` and `pack_unit` alongside `id` and `store_id`. Selling "1 kg"
of rice and selling "5 kg" of rice at the same price are two different products; if
a mis-tap on the price field could change the pack, the customer would be charged
the 1 kg price for a 5 kg bag and nothing in the flow would look wrong.

That freeze created a real problem, which is worth recording because the first
draft got it wrong: the **seed** rewrites pack fields when it normalises the shelf,
and it runs as `postgres`, so it is not a "client" and the freeze stopped it. The
fix is the same pattern the stock move already uses — a **transaction-local flag**
(`identity_edit_in_progress()`, `set_config('kunigal.editing_identity','on',true)`)
set only by the seed and by data migrations, never by the app. A customer cannot
reach it: the non-admin client branch raises before the flag is even consulted. And
because the flag is transaction-local, the seed had to wrap its normalisation in an
explicit `begin; … commit;` — `psql -f` otherwise runs each statement in its own
implicit transaction and the flag evaporates between them. That cost one debug
cycle and is commented at the call site.

**In the app**, three surfaces know about packs:

- `src/lib/pack.ts` — pure arithmetic: `packInBase`, `lineBaseQuantity`,
  `formatLineSize` ("three 500 g packets" reads **1.5 kg**, as a shopkeeper says
  it — never "1500 g", never "0.0015 t"), `packLabel`, `offersPackAlternatives`.
  Pure so it can be checked off-device: `scripts/check-packs.mjs`, **48
  assertions**, wired as `npm run check:packs` and into `lint`.
- `src/components/pack-options.tsx` + `src/hooks/use-pack-options.ts` — the
  "Also in 1 kg" chips on the product screen, each showing **its own price**. A chip
  pushes the other product's own page; it never lets one product be bought at
  another's price (§9.1). Matching is conservative: same store, same category,
  **identical Kannada name**, both `measure`. A false negative shows a normal
  product page; a false positive sells the wrong thing.
- `src/components/pack-field.tsx` on the owner's Shelf tab — shows what one pack IS,
  read-only, behind a deliberate two-step "Change → Save". It is a separate
  component mounted only while open, so its draft is seeded from the stored row once
  rather than synced by an effect (which `expo lint` refuses, correctly).

`supabase/seed.sql` derives the structured pack from the shop's own free-text
`unit` ('500 g' → 500 g, '1 kg' → 1 kg), lower-casing the subject first because the
seed writes both '1 L' and '1 l' and Postgres regex is case-sensitive — matching
only the lower-case form silently left every oil as a piece product. `'4 x 100 g'`
is deliberately left a plain piece: its unit already names the whole thing, and
calling it a 100 g pack would understate what the customer gets.

**Still open, and recorded honestly:** a shop cannot sell above its own printed MRP
(the MRP rises with the price instead), and the pack chips have never been seen on
a phone — this machine has no Android SDK (§5).

### The owner can add a product, in Kannada — DONE (register M6)

The register's line was "i18n is read-only; no Kannada data entry for the owner".
Finding the real gap meant grepping rather than trusting the sentence: the **web
panel could already create a product** (`apps/admin/src/app/(app)/products/page.tsx`,
with a `name_kn` field), but the **app could not create one at all**. Since the
whole premise of the Shelf tab is that the owner runs the shop standing up, "edit a
product on your phone, but walk to a desk to add one" is not a working shop.

**The failure the function exists to stop.** `products.name_kn` is `not null`, but
an **empty string** satisfies that. One in three adults in Kunigal cannot
comfortably read the English name (KUNIGAL.md §1), so a blank Kannada label is a
blank shelf label — a product the customer who most needs it cannot read, added by
an owner who pressed Save and saw no error. So `create_product_from_shop()`
refuses three things:

- a blank Kannada name (`23514`);
- a Kannada name with **no Kannada character in it** — the English name copied
  across, which is exactly the shortcut a hurried owner takes, and which looks
  filled-in;
- a blank English name, a missing price, a negative stock.

`looks_like_kannada()` is U+0C80–U+0CFF, the Kannada Unicode block, and it is
commented as the **heuristic it is**: it checks the script, never the meaning.
`KUNIGAL.md` remains the authority on wording. A real shop writes
`Aashirvaad ಗೋಧಿ ಹಿಟ್ಟು`, so a Kannada name containing a Latin brand word is
accepted — the rule must not become an obstacle.

**Why an RPC and not a plain `.insert()`.** The same reason as the shelf edit: the
policy authorises on ROLE, and a mistake in how the client calls an insert can turn
a refusal into zero rows and no error — a save button that lies (§9.4). The RPC
raises on "not the owner" (`42501`) and returns the row as Postgres stored it.

**Why `store_id` is not an argument.** The function finds the one active store
itself. If the app named the shop, a signed-in owner could create a product in a
shop they do not own, and the policy would allow it, because it authorises on role,
not on which shop. One shop today; the rule is written for the second one.

**`unit` is derived, not typed.** `create_product_from_shop()` builds the
customer-facing pack text from `(pack_size, pack_unit)`, so it can never drift from
the pack the app compares sizes on — one fact, one place. It is faithful to the
declared unit: a pack entered as "1 kg" reads "1 kg", and a 500 g pack stays
"500 g". Storing 1000 g as "1 kg" would lose how the shop writes its own shelf.
This is where a real bug was caught and pinned by a test: the first draft trimmed
trailing zeros with `rtrim(..., '0')`, which turns a 100 g pack into **"1 g"** — a
silent hundred-fold lie about what the customer gets. Whole numbers are now left
intact, and test 22 asserts `100 g` and `250 g` stay what they are.

**In the app**, an **Add a product** button on the Shelf header opens an inline
panel (`src/components/add-product-panel.tsx`, scrolling with the list so it never
covers the shelf). Kannada name first and required; then English name, price, MRP,
stock, aisle, counted-or-weighed, and the pack. Rupees are converted to integer
paise **once**, at the edge. The screen mirrors the server's rules so the owner is
told before the request — and the database still refuses anything the screen misses,
because the screen is a courtesy, never the guard.

**Kannada is typed, not transliterated.** Deliberately no transliteration helper: a
guesser turning English letters into Kannada letters would produce words no Kunigal
customer recognises, which is worse than asking the owner to type the name he
already says out loud. This is the M6 decision, and it is why the field is first and
why the refusals are specific — the screen tells the owner *which* field is wrong.

Migration `20261021000005_create_product.sql`; test
`supabase/tests/22_create_product_test.sql` — **28 assertions**, including that a
customer, a rider and a signed-out caller are all refused, that the derived pack
text cannot drift, and that a customer can **read** the product the owner just added
(a product nobody can see would be a shelf that lies).

### Still in this phase

- **Real photographs** (register M8): the seeded photos are development stock
  images. Every product the shop actually sells needs a picture of the real thing
  on the real shelf, and six products currently have none. *(Owner.)*
- **A backup, a rollback and a name to call** (register H13): Supabase point-in-
  time recovery on, one tested restore, one written page of what to do at 9 p.m.
  when the shop cannot take orders.
- **A Sentry project and a DSN** *(developer)*: the code is wired and inert. It
  does nothing until a real DSN is in `.env` and `SENTRY_AUTH_TOKEN` is set in the
  EAS build environment. No account is needed to *develop*; one is needed to see a
  crash.

---

## 9. Phase 5 — the store calendar (this is the real launch date)

`[EXTERNAL]`, checked 2026-10-19. Store rules change; re-read them before you
promise anyone a date.

**Google Play**

- A **personal** Play developer account created after 13 Nov 2023 must run a
  **closed test with at least 12 testers opted in continuously for the 14 days
  immediately before applying for production access** (Play Console Help,
  "App testing requirements for new personal developer accounts"). Opt-in is not
  the same as invited; a tester who drops out and returns restarts their own
  14 days. The production application is then reviewed, usually within a week.
  An **organisation** account follows a different path — the Dashboard is the
  authority for your own account.
- Consequence: **start the closed test the day the first installable build
  exists, in parallel with everything else.** Do not sequence it after the pilot.
- From **31 Aug 2026**, new apps and updates must target **Android 16 (API 36)**
  or higher (extensions to 1 Nov 2026 can be requested). `[EXTERNAL]`
- **16 KB page sizes** are required for apps targeting Android 15+; from **1 Feb
  2027** a non-compliant update cannot be released. Expo SDK 53+ handles this,
  and this repo is on SDK 57, so it is a non-issue — but keep it that way when
  upgrading. `[EXTERNAL]`
- From **Feb 2027** Play enforces technical-quality thresholds (user-perceived
  crash rate ≤ 1.09%, ANR ≤ 0.47%). An unmonitored app can fall foul of these
  without anyone noticing — register H11 now. `[EXTERNAL]`

**Apple**

- Organisation enrolment needs a **legal entity that can contract with Apple**
  plus a **D-U-N-S number** (Dun & Bradstreet). DBAs, trade names and branches
  are not accepted. `[EXTERNAL]` (Apple Developer Program enrolment page). Start
  this early: it is paperwork, and the clock only starts when it clears.
- Reviewers need a working login (see Phase 2, C8).
- `[UNVERIFIED]` — a single-shop storefront may draw scrutiny under App Review
  Guideline 4.2 (minimum functionality). Nothing in this session confirmed that
  for a grocery app; the mitigation is the same either way: make the listing and
  the app unmistakably a *working shop*, not a wrapper.

**Both stores** require a privacy policy URL, a data-safety / privacy-nutrition
declaration that matches what the app actually collects, a content rating, and
screenshots that show the app in use rather than a splash screen.

---

## 10. Phase 6 — the human layer: how this earns a second order

This is the part the plan must not lose. The repository is an excellent database
with a good design system on top; what is missing is the layer that makes a
Kunigal customer trust it twice. Each item below is a *behaviour*, with the
product consequence and the register row.

### Trust, before cleverness

1. **Show the shop, not the software.** The shop's own name, its street, its
   FSSAI number (H6), and "call the shop" as a real button that dials the shop's
   phone. In a town where the shopkeeper is a neighbour, anonymity reads as risk.
2. **The rider is the interface.** ~~Name and photo on the order screen; a *call
   the rider* action at "out for delivery";~~ **DONE** (name, photo and Call the
   rider are live on the order screen; migration 20261021000001).
   ~~A landmark field at checkout so the rider can actually find the house (M5)~~
   **DONE, and it was already done** — see below.
3. **Honest status, in the words people say.** `ಬಂದಿದೆ`, `ಮನೆ ಸೇರಿದೆ` — already
   the voice in `KUNIGAL.md` §4. **DONE**: the missing honest state exists — a
   delivery that failed is neither "delivered" nor "cancelled", it is `failed`
   with a reason, and `returned` when the bag came back (M3).
4. **Never a blank screen.** Loading, empty and error-with-Retry on every
   data-loading screen (AGENTS.md §9.2) plus one offline banner rather than a
   modal per request (§9.3). On NH-75 4G, a white screen is read as "this app is
   broken", and that opinion travels the whole town by evening.

### Reduce the cost of the first order

5. **Nothing surprises at the total.** Delivery fee and total are already
   computed server-side; make sure the customer sees them before the last tap and
   understands `ಬಂದಾಗ ನಗದು`.
6. **The free-delivery gap, said out loud** (L3): "add ₹80 more for free
   delivery" is a kinder, more effective nudge than a coupon, because it is
   information rather than bribery.
7. **Revisit the ₹100 minimum against real baskets** (H1). If the modal first
   basket in Kunigal is ₹150 of rice and oil, fine; if it is ₹60 of vegetables,
   the minimum is refusing exactly the daily habit the app needs.
8. **Substitution, not silence** (M13): out of stock at 8 a.m. must become "we
   sent the other brand / we left it out and did not charge you", not a surprise
   in the bag.

### Work with the way this town actually lives

9. **Voice** (H4). With ~31% low literacy this is the single most Kunigal-specific
   feature available: `expo-speech` reading a product name and the cart total
   aloud, in Kannada, using the same strings that are already in `kn.json`. Not
   built, not scheduled, and the strongest differentiator on the list.
10. **Reorder in one tap** (the "buy again" shelf already exists). In this town the
    real basket is the *same basket*: milk and vegetables daily, rice and oil
    monthly. A repeat button beats any search.
11. **One phone, several adults** (H10): decide and document it.
12. **Kannada data entry for the owner** (M6) — **DONE.** See the section at the
    end of Phase 4. The owner now adds a product from the phone, and the function
    refuses a blank Kannada name or the English name copied across.
13. **A dialect read-through** (M7). `KUNIGAL.md` §3 was written in the voice of
    the shop's own helper by the build, not by a Kunigal local. One afternoon with
    one local, and a recorded sign-off. Wording can change for free; every string
    is a key.

---

## 11. Phase 7 — acquisition, the way a small town actually works

The channel that will move this is the one that already exists: the shop. In
priority order, cheapest first.

1. **The counter is the front door.** A QR code at the till and a poster by the
   door; the person billing already has the customer's attention and their phone
   in hand. Highest conversion, zero media cost. Train whoever stands at the till
   to install it on the customer's phone with them, once, in front of them.
2. **The shop's own phone contacts and WhatsApp** (L2). The shop already has
   hundreds of customer numbers. A `wa.me` link and a WhatsApp Business profile
   with the catalogue reach people who will never search an app store. Measure
   the channel.
3. **The riders are walking adverts.** Branded bag, and one instruction: on
   delivery, show the customer the reorder button on their own new order.
4. **Referral, both sides, in the shop's own social currency** (L1). In a small
   town a referral is a favour between neighbours; a both-sides credit is a
   thank-you, and it converts better than a discount aimed at strangers.
5. **Local, cheap, and honest:** the Kunigal Facebook/WhatsApp groups, Kannada
   creatives, "the same shop on the same street, now on your phone, pay when it
   arrives".
6. **Institutionalise nothing you cannot keep** (L4): a weekly repeat basket is
   the natural subscription here, but only build it once the pilot shows the
   repeat rate.
7. **Fresh research, not the 2011 census** (L5): three to five real customer
   interviews, and the same for riders, written down in the repo. The town has
   changed since 2011 and the plan is partly built on that census.

---

## 12. The register — all 41 items, mapped

From the council chairman, item for item. "Owner" is who can actually move it.

| ID | Sev | Item | Phase | Owner |
| --- | --- | --- | --- | --- |
| C1 | Critical | Only sign-in path is phone OTP, and OTP is disabled; no SMS provider / DLT | 2 | Owner + dev |
| C2 | Critical | Session could not persist (no `storage` adapter) | **0 — done** | Dev |
| C3 | Critical | No installable artefact (no bundle ids, no `eas.json`) | **0 — done** | Dev |
| C4 | Critical | Nothing has ever run on a device | 1 | Dev + owner |
| C5 | Critical | No privacy policy, terms, LICENSE, or in-app account deletion | **0 in-app done**, hosted URL + LICENSE left | Owner + dev |
| C6 | Critical | Play closed-test calendar gate (12 testers / 14 days) | 5 | Owner |
| C7 | Critical | Demo accounts may be live on the hosted project | 3 | Owner |
| C8 | Critical | Store reviewers cannot log in (OTP-only, dev path compiled out) | **2 — code done**, owner action left | Dev + owner |
| H1 | High | ₹100 minimum refuses the modal first basket | 6 | Owner + dev |
| H2 | High | Realtime cannot reach a pocketed phone; no push | **trust half done** (rider name/photo/call); push still missing | Dev |
| H3 | High | Open cash loop; no owner "Today" totals | **0 — done** | Dev |
| H4 | High | No voice/TTS — the town's defining accessibility gap | **0 — done.** Kannada TTS on product and cart, hidden when the phone has no Kannada voice (never reads it in the wrong language) | Dev |
| H5 | High | DPDP consent notice, in Kannada | **0 — done** | Owner + dev |
| H6 | High | FSSAI licence display missing | **fields done**, number needed | Owner |
| H7 | High | Legal Metrology declarations absent | **fields done**, wording unverified | Owner + CA |
| H8 | High | No GST decision / cash memo | **field done**, decision needed | Owner + CA |
| H9 | High | No account recovery, customer or owner | **2 — code done**, owner action left | Dev + owner |
| H10 | High | Identity assumes one phone = one person | **0 — done.** `set_my_name()` + a name editor on the account screen, migration `20261021000006`, test 23 (22 assertions). The owner now names their own account from the app; refusals on blank names; the function acts only on `auth.uid()`; and the account screen explains the household model. | Dev + owner |
| H11 | High | No crash reporting or analytics | **0 — done** (Sentry; native crashes need a real build, not Expo Go) | Dev |
| H12 | High | No CI | **0 — done** (`.github/workflows/checks.yml`) | Dev |
| H13 | High | No backup / restore / rollback runbook; nobody on call | 4 | Dev + owner |
| M1 | Medium | No persisted offline catalogue | **0 — done.** `query-persistence.ts`: allowlist persistence of the public catalogue only, `check:persist` (27 assertions, and it found a launch-time crash) | Dev |
| M2 | Medium | No in-app price/stock edit; no admin totals screen | **0 — done** (totals 20261021000002 + test 19; shelf edit 20261021000003 + test 20) | Dev |
| M3 | Medium | No failed/returned order status | **0 — done** (`failed`/`returned` + reason, migration 20261021000001, test 18) | Dev |
| M4 | Medium | `quantity` is integer — loose weights cannot be sold | **0 — done, by rejecting the decimal.** Structured packs (`sold_by`/`pack_size`/`pack_unit`) + `product_pack_options`, migration `20261021000004`, test 21 (29 assertions); `check:packs` (48) | Dev |
| M5 | Medium | Free-text address; the town has no reliable house numbering | **0 — done.** Landmark column, checkout field, order snapshot, and a rider card that leads with it | Dev |
| M6 | Medium | i18n is read-only; no Kannada data entry for the owner | **0 — done.** `create_product_from_shop()` + an in-app Add-a-product panel that requires a real Kannada name; migration `20261021000005`, test 22 (28 assertions) | Dev |
| M7 | Medium | No Kannada dialect review by a Kunigal local | 6 | Owner |
| M8 | Medium | 6 products have no image; the rest are dev stock photos | 4 | Owner |
| M9 | Medium | Developer text on the customer's first screen | **3 — hidden in release**, delete before public | Dev |
| M10 | Medium | Jargon with no glossary; "done" used two ways | 3 | Dev |
| M11 | Medium | Doc contradictions (OTA, images, order count, "DONE") | **3 — done.** Order count fixed; the two stale image claims swept (`README.md` and the `seed.sql` header both said "no product photos on purpose" while `demo-images.sql` loads 28 of them). OTA claims verified absent: no `expo-updates` in the repo, and `PRODUCTION.md` §3's "`expo-updates`, push, Sentry all absent" was true when written — Sentry has since landed, so that one line is now corrected in place. | Dev |
| M12 | Medium | No iOS build path from this Linux box | 4 | Owner + dev |
| M13 | Medium | No substitution / out-of-stock path | **0 — done, and already was.** `place_order()` returns per-item `items_unavailable`; cart clamps to `stock_qty`; checkout redirects to a corrected basket | Dev |
| L1 | Low | No referral / share | 7 | Dev |
| L2 | Low | WhatsApp not used as an acquisition front door | 7 | Owner |
| L3 | Low | Free-delivery nudge not shown at checkout | **0 — done, and already was.** `checkout.freeDeliveryHint` with `free_delivery_above_paise` from settings | Dev |
| L4 | Low | No subscription / repeat basket | 7 | Dev |
| L5 | Low | Town stats are from the 2011 census; no user interviews | 7 | Owner |
| L6 | Low | One binary ships all three faces; no staging or flags | 8 | Dev |
| L7 | Low | Multi-store "town rail" contradicts the one-shop scope | 8 | Owner |

**How this table is maintained, and a correction.** Four rows (M5, M13, L3, and
M2's totals half) were marked "not done" while the feature was in fact already
built, some for several sessions. They were written from memory rather than read
from the code. That is the specific failure this file exists to prevent, so the
rule is now: **a row's status is set by grepping the schema and the screens, never
from recollection**, and a row corrected is recorded in §15a rather than quietly
edited. Each of the four was re-verified against `supabase/migrations/`,
`apps/mobile/src/app/` and `src/hooks/` before being marked done.

**Minority views kept on the record** (from the council, so they are not lost):the growth-layer work in Phase 7 was argued by one reviewer and one advisor to be
the highest-value work; the rest of the council held that it is unusable while
the front door is shut. One advisor would refuse push notifications and payments
outright; another notes that refusing push refuses the rider alert. The UPI/Razorpay
question is genuinely open, and `AGENTS.md` still lists payments as not-built.

---

## 13. Phase 8 — only after the first hundred orders

Deliberately listed, deliberately not scheduled: push notifications (which the
rider alert genuinely needs), Razorpay/UPI, live rider location, a second shop,
per-environment staging, and the town-wide "delivery rail" that would contradict
the one-shop scope today. Also here: the Expo SDK 57 → 58 upgrade, which is worth
doing on a quiet week rather than during a pilot.

---

## 14. Open questions only the owner can answer

1. **The app identifier.** `in.kunigal.grocery` is a placeholder. Confirm the
   reverse-DNS prefix (do you own a domain? is it `in.` or `com.`?), because it
   becomes permanent at the first store upload.
2. **Whose Play/Apple account?** A personal developer account puts the
   developer's legal name on the store listing and triggers the closed-test gate;
   an organisation account needs a legal entity and a D-U-N-S number. Which one,
   and whose name should the shop's customers see?
3. **Is the shop GST-registered, and what must a cash memo show?** (H8). You need
   to provide the GST number and the exact fields the accountant requires on the
   cash memo (or a sample). If not registered, say so and what the memo must show
   as per law — include that text in the receipt.
4. **The FSSAI licence number**, for display on the listing and the receipt (H6).
   You need to provide this (if the shop sells food items). Also confirm the
   display text in Kannada/English per the licence.
5. **SMS budget and DLT sender ID** for OTP (C1). You need to own/configure the
   SMS provider (DLT registration for sender ID and message template) and provide
   credentials/approval status. This is code work too (enabling phone auth,
   configuring provider and templates, handling errors gracefully). It is not
   paperwork-only.
6. **Does the shop want to own the customers' phone numbers** (needed for a
   pilot and for WhatsApp), and does the shop's DPDP consent notice cover that?
7. **The ₹100 minimum** (H1): is it protecting the shop from loss-making trips, or
   refusing the town's real daily basket?
8. **Kannada sign-off** (M7): who is the Kunigal local who reads the whole app
   aloud and signs off on the voice?
9. **The web panel has fallen behind the app** (M6/M4). `apps/admin`'s product form
   still knows nothing about `sold_by`/`pack_size`/`pack_unit`, so a product created
   there is always a counted `piece` with no pack and cannot get "also in 1 kg"
   chips. Either it is brought level with the app's Add-a-product panel, or the
   panel is retired (it is already described as optional) and the Shelf tab becomes
   the only shelf tool. **A decision is needed before the first pilot**, because two
   tools that disagree about the same shelf is worse than one.
   **RESOLVED 2026-10-20 (dev side):** the panel was brought level — its product
   form now edits `sold_by`/`pack_size`/`pack_unit`, `edit()` loads them (so saving
   no longer silently wipes a pack) and `resetForm()` clears them. No owner decision
   remains here; keeping the panel is now the status quo.

---

## 15. What would change this plan

- A real device run of the full order flow in Kannada.
- A funded SMS provider plus one successful real OTP sign-in.
- A verified reading of the current Play/App Store requirements *for this
  account* (the Dashboard, not this file).
- An in-app account-deletion path plus privacy policy and statutory display.
- Evidence of a second real order from the same customer within a week.

Any one of those materially moves the plan. The last one is the only one that
proves the product works.

---

## 15a. Changelog of this file

- **2026-10-20** — Register **M6 done**. The web panel could already create a
  product; the *app* could not, which contradicted the whole phone-first premise of
  the Shelf tab. Added `create_product_from_shop()` — which refuses a blank Kannada
  name and the English name copied across, derives the customer-facing pack text
  from the structured pack, and picks the store server-side — plus an in-app Add-a-
  product panel. Migration `20261021000005`; test 22 (28 assertions). A test caught a
  real bug: `rtrim(..., '0')` turned a 100 g pack into "1 g".
- **2026-10-20** — Register **M4 done, and it was a rejection more than a build**.
  The obvious fix (make `quantity` numeric) was refused with a reason: it would
  round the paise twice, in two places, and fail intermittently. A pack is now
  structured data — `sold_by`/`pack_size`/`pack_unit` + `product_pack_options` —
  `quantity` stays an integer, the guard freezes the pack as identity, and the app
  offers "also in 1 kg" without ever pricing one product at another's price.
  Migration `20261021000004`; test 21 (29 assertions) whose **first** assertion is
  "quantity is still an integer"; `check:packs` (48). Two bugs found on the way, both
  recorded above: the seed's identity rewrite needed a transaction-local flag, and
  the pack regex was case-sensitive so `'1 L'` silently stayed a piece product.
- **2026-10-20** — Register **H4 done**: Kannada voice/TTS. Product and cart can be
  read aloud from the same `name_kn`/`kn.json` strings already on screen. Hidden
  when the phone has no Kannada voice, because reading Kannada in an English voice
  is confident nonsense. New `check:speech`; the voice-matching rule was split into
  `speech-rules.ts` so it is testable off-device. `KUNIGAL.md` §8 gap closed.
- **2026-10-20** — Register **M5 corrected and completed**. It was already built
  (landmark column, checkout field, order snapshot) and the register had been wrong
  for three sessions; the real gap was three screens hand-rolling the same address
  sentence. Fixed with a shared helper, a rider card that leads with the landmark,
  and a new `check:view` (48 assertions) for the module that had none.
- **2026-10-20** — **Four register rows were stale** (M5, M13, L3 — all already
  built — and M2's totals half, misrecorded). Found by grepping the code instead of
  trusting the table. Each was verified against the schema/screens before being
  marked done. The register is now checked against the code, not from memory; see
  the note under §12.
- **2026-10-20** — Register **M1 done**: the catalogue survives closing the app.
  Persisted React Query cache, **allowlist-only** (public catalogue in, everything
  personal out), plus `check:persist` (27 assertions) which caught a launch-time
  crash in the first version.
- **2026-10-20** — Phase 4's safety net landed: register **H11 and H12 are done**.
  Sentry crash reporting (`src/lib/crash-reporting.ts`, DSN is a public write-only
  key, no PII, inert without a DSN) and CI (`.github/workflows/checks.yml`, runs
  the same commands a developer runs). Running `expo-doctor` in CI found six
  packages drifted off SDK 57's patch versions; all upgraded and re-verified. One
  argued exemption for the deliberate Metro monorepo line, tested against a
  simulated real failure. **Native crashes still need a real build, not Expo Go** —
  so H11's value is not realised until the first `eas build`.
- **2026-10-20** — Phase 4's shelf half landed: register **M2 is done**.
  `update_product_from_shop()` + `guard_product_update()`
  (migration `20261021000003_product_guard.sql`) back a new **Shelf** tab
  (`admin/shelf.tsx`). No column added, no policy widened — the gap was a door
  that lies (a zero-row update raises nothing) and one that freezes product
  identity. Building it broke `place_order()` and nearly deleted coupon support;
  both traps are written up in Phase 4. Database suite is now 459 assertions.
- **2026-10-20** — Phase 4's owner-ledger half landed: register **H3 is done**.
  `shop_day_totals()` / `shop_day_by_rider()` (migration
  `20261021000002_shop_totals.sql`) compute the day server-side; `admin/today.tsx`
  shows it. Test 19 found two design bugs — failed deliveries were counted as
  takings, and refund liability did not exist — both fixed. Database suite is now
  439 assertions.
- **2026-10-19** — written, after the council run. Phase 0 landed (session
  persistence, build identity, `eas.json`). Store and DPDP claims checked against
  live sources on this date and marked `[EXTERNAL]`; Legal Metrology and GST
  remain `[UNVERIFIED]` pending the shop's accountant.
