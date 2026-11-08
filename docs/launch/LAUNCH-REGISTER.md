# The launch register — documents, domain, accounts, assets

**Written:** 2026-11-09. **Authority:** this file tracks the *external* things the
app needs. Code status lives in `CHANGELOG.md`; the strategy behind this list is
`PRODUCTION.md`. Rules that must not break: `AGENTS.md` §9.6 (the app may hold
only the Supabase URL + publishable key) and §9.5 (every customer-visible string
in both languages).

Every row is tagged `DEV` (I prepare it), `OWNER` (only the client can do it) or
`DEV+OWNER`. `TODO(OWNER)` / `TODO(CA)` marks a value nobody may invent.

> **The one irreversible decision.** `android.package` `in.kunigal.grocery` is a
> placeholder. It is permanent the moment the first APK/AAB is uploaded to Play,
> and the iOS bundle identifier is permanent once the app exists in App Store
> Connect. Changing it *now* is free. Decide the domain and the shop name first
> (§2), then set the identifier, then upload.

---

## 1. What blocks a store submission, in order

| # | Gate | Owner | Note |
|---|------|-------|------|
| 1 | **Privacy policy URL** (both stores require it in the listing) | OWNER (domain + publish) | §2, §3 |
| 2 | **Account-deletion URL** (Play requires it for apps with account creation) | OWNER (domain) | The in-app deletion already exists; the URL is a page explaining it. §3 |
| 3 | **Store listing copy + assets, Kannada included** | DEV draft | §4 |
| 4 | **Data-safety / App-Privacy declaration** | DEV draft, OWNER confirms | §5 |
| 5 | **Screenshots** | DEV | Blocked on the first device run (nothing has ever rendered on a phone). §4.3 |
| 6 | **Play Console + Apple accounts** | OWNER | §6 |
| 7 | **OTP sign-in working** (phone auth + SMS + DLT) | OWNER + DEV | §7 — the longest pole, start today |
| 8 | **Hosted Supabase migrated** (currently 10 migrations behind) | OWNER + DEV | §8 |
| 9 | **Demo accounts/data removed; reviewer account created** | OWNER | §9 |
| 10 | **Play closed test: 12 testers, 14 continuous days** (personal accounts created after 13 Nov 2023) | OWNER | §6.1 — calendar time, start the day a build exists |

---

## 2. Domain name — the first domino

**Why now:** the privacy URL, the account-deletion URL, and (by convention) the
permanent app identifier all hang off the domain. It costs ~₹1–2k/year and
de-risks three permanent decisions at once.

**Decision needed from the owner (one conversation):** the shop's real trade name
as customers say it. Then:

- [ ] `TODO(OWNER)` Buy `<shopname>.in` (prefer `.in` for a Kunigal shop; a `.com`
      is fine too). Check the name is not someone else's trademark and does not
      resemble Blinkit/Zepto/BigBasket.
- [ ] `TODO(OWNER)` Registrant must be **the client** (or their shop entity), with
      the payment card on file **theirs** — never the developer. A domain the
      dev owns is a domain the dev controls at launch.
- [ ] `TODO(OWNER)` Registrant name, registrant email, admin email — needed for
      the WHOIS and for the store contact fields.
- [ ] `DEV+OWNER` Set `android.package` / `ios.bundleIdentifier` to match
      (`in.<shopname>` or `com.<shopname>`) **before the first upload**.
- [ ] `DEV` Host the privacy policy, terms and account-deletion page on it
      (GitHub Pages / Vercel / Netlify — free). Drafts are in this folder.

---

## 3. Documents to publish on the domain

| Document | Status | Notes |
|---|---|---|
| **Privacy policy** (EN + KN) | Draft ready — `privacy-policy.md` | Mirrors the in-app `privacy.*` notice, which already ships in both languages; adds the parts only a hosted policy carries (controller identity, contact, grievance, third parties, hosting region). `TODO(CA)` sign-off before publishing. |
| **Terms of use** | Draft ready — `terms.md` | `TODO(CA)` review. A one-shop app can keep this short. |
| **Account-deletion page** | `DEV` | Explains the in-app `Delete my account` path (Account → Delete my account, immediate) plus a support contact. Play requires a reachable deletion URL. |
| **LICENSE** (repo) | `TODO(OWNER+DEV` | Decide before anyone outside the shop sees the code. |
| **Data-deletion + retention summary for the Data-safety form** | `DEV` — §5 | Already written; must match what the code does (it does). |

---

## 4. Store listing assets and copy

Draft in `store-listing.md`. What is missing today:

- [ ] **Feature graphic 1024×500** (Play) — `DEV`, can be derived from the theme
      colours in `apps/mobile/src/constants/theme.ts` + the shop's name.
- [ ] **Phone screenshots, min 2, up to 8** — **blocked on the first device run**
      (§4.3). Kannada-first screenshots for the Kannada listing; 2–3 English ones
      for the `en-IN` listing. No splash/empty screens — both stores reject them.
- [ ] App name (≤30 chars), short description (≤80), full description, category,
      contact email + phone, content rating questionnaire, target audience.
- [ ] Kannada versions of all of the above (Play accepts `kn-IN` listings; the
      app's default language is Kannada, so the listing should be too).
- [ ] Apple-only if iOS proceeds: subtitle (30), keywords (100), promotion text,
      support + marketing URLs, age rating, export-compliance answer.

### 4.1 Store reviewer login (register C8 — code is done)
The `review` EAS profile exists and compiles in a customer-only door
(`check:auth-doors` proves a plain production build has no dev door).
`TODO(OWNER)` create that customer account in Supabase Auth and hand the
credentials to Play and Apple review, **not** to customers.

### 4.2 Accounts needed
| Account | Cost | Owner | Note |
|---|---|---|---|
| Google Play Console | $25 once | OWNER | Personal vs organisation is a real decision — see §6.1 |
| Apple Developer Program | $99/yr | OWNER | Only if iOS at launch; Android-first is the fast path |
| Expo/EAS (builds) | free to start | OWNER | Dev creates, transfers ownership |
| Supabase project | free → $25/mo Pro | OWNER | Pro when point-in-time recovery matters (H13) |
| Sentry (crashes) | free tier | DEV | Currently **inert** — no DSN in `.env` yet |
| SMS provider + DLT | varies, days | OWNER | §7 |
| Razorpay | KYC + PAN + bank | OWNER | Only if payments are in scope for launch |

---

## 5. Data-safety / App-Privacy declaration (must match the code)

Collected by this app today, from the code:

| Data | Where it lives | Why |
|---|---|---|
| Phone number | Supabase Auth | Sign-in (OTP); how the shop/rider reaches you |
| Name, delivery address (+ optional door pin lat/lng) | `addresses`, snapshotted on the order | Delivery |
| Orders and items | `orders`, `order_items` | The purchase; the shop's books |
| Rider GPS position | `rider_positions`, deleted when the delivery closes, >10 min never shown | Live tracking while delivering |
| Product photos (owner only) | Supabase Storage | The shelf |
| Crash diagnostics | Sentry — **no PII, stripped in `beforeSend`** | Fixing crashes |
| OSM/OSRM tile + route requests | Third-party servers, no key, no account; IP visible to them | The map |

Not collected, and the declaration must say so: **no analytics, no advertising
ID, no payment data (COD only at launch)**. Data is encrypted in transit
(HTTPS/Supabase TLS). Deletion exists in-app; the URL points at §3's page.

`TODO(OWNER)` confirm both declarations after reading §5 — a declaration that
disagrees with the app is a rejection and a policy problem, not a typo.

---

## 6. The Play calendar (register C6) — the real launch date

From `PRODUCTION.md` §9 (`[EXTERNAL]`, checked 2026-10-19 — **re-check when
submitting; store rules move**):

- A **personal** Play developer account created after 13 Nov 2023 must run a
  **closed test with ≥12 testers opted in for 14 continuous days** before it can
  apply for production access. An **organisation** account follows a different
  path — the Dashboard is the authority for the actual account.
- So: `TODO(OWNER)` tell me **when the Play account was created and whether it is
  personal or organisational.** If it predates Nov 2023, the 14-day gate may not
  apply and we save two weeks.
- New apps must target **Android 16 (API 36)** since 31 Aug 2026; this repo is on
  Expo SDK 57 (`expo-doctor` is clean), so this is a keep-an-eye-on item.
- From Feb 2027 Play enforces crash/ANR thresholds — which is why Sentry must
  stop being inert (§1).

---

## 7. OTP sign-in (register C1) — start today, it is the longest pole

The only release sign-in path is phone OTP; the app already handles every
failure in Kannada. What is missing is all on the owner's desk:

- [ ] `TODO(OWNER)` Enable Phone auth on the Supabase project.
- [ ] `TODO(OWNER)` Choose and fund an SMS provider; register the **DLT sender
      ID + message templates** (entity paperwork, measured in days). Provide the
      provider credentials so I can wire them into the project.
- [ ] `DEV` Once the provider is chosen: configure the project, test one real OTP
      end-to-end, and log it in `CHANGELOG.md`.
- Interim fallback for the pilot only: demo/review accounts (dev only, removed
      before the public build — register C7, §9).

---

## 8. Hosted Supabase is ten migrations behind

Probed today: the live project has migrations only up to
`20261013000001` (rider assignment). Missing: `rider_directory`, `shop_day_totals`,
`update_product_from_shop`, `create_product_from_shop`, `product_pack_options`,
`record_my_position`, `order_rider_position`, `order_feedback`,
`orders.refund_due_paise`, `addresses.lat/lng`, `shop_feedback_totals`.

`TODO(OWNER)` give me project credentials (or run the SQL-editor sweep yourself)
so the missing files can be applied **in filename order** — never edit an applied
migration. Three of them are guard triggers; this runs against live data, so it is
the owner's call. The local suite proves them (732 assertions); the live project
has never run them.

---

## 9. Before any public build

- [ ] `TODO(OWNER)` Remove the demo accounts and demo orders from the hosted
      project (register C7); keep them out of production.
- [ ] `TODO(OWNER)` Give the owner's own account MFA, and create a **second
      admin** account (a locked-out owner with no second admin is a business
      outage).
- [ ] `TODO(OWNER+CA)` FSSAI licence number + display text, GST decision +
      GSTIN + cash-memo wording, Legal Metrology declarations. The fields exist
      (`stores.fssai_number`, `stores.gstin`, `products.packer_name`,
      `products.net_quantity`, `store_settings.receipt_footer`); the numbers and
      wording are the client's, and the app deliberately shows nothing until they
      exist — it never invents a placeholder.
- [ ] `TODO(OWNER)` Real photographs of all 34 products (6 have none).
- [ ] `TODO(OWNER)` Kannada sign-off by a Kunigal local reading the app aloud
      (register M7).
- [ ] `TODO(DEV)` Delete developer text from the login screen (register M9) — it is
      `__DEV__`-gated now, but it should not exist in the public build.
- [ ] `TODO(DEV+OWNER)` One tested restore + a one-page "what to do at 9 p.m. when
      the shop can't take orders" runbook, and a named on-call person (H13).

---

## 10. Deliberately deferred (so nobody thinks they were forgotten)

Razorpay (COD-only launch is faster and fee-free), push notifications
(in-app realtime + a 60 s poll covers a one-street shop; the customer never
needs push when the order is 20 minutes old), iOS (Android-first is defensible
in Kunigal), the `apps/admin` decision, A1/A9/A10/A11/A12 owner decisions, SDK
58. Each row in `PRODUCTION.md` §12 still says what it needs if we revisit.
