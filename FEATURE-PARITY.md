# FEATURE-PARITY.md — what Blinkit and Zepto do, and what this app is missing

Written 2026-10-21. This file exists because a customer-facing grocery app is
judged against a habit, not a spec: people in Kunigal have seen Blinkit on a
relative's phone. They will ask "why can't I see where the boy is" before they
ask about anything else.

Read this next to `SCALE-AND-TRACKING.md` (how to build it) and `PRODUCTION.md`
(what must be true before release). This file answers a third question: **what
is in the category that is not in this app, and which of it does Kunigal
actually need?**

---

## 0. How this was produced, and what it is not

Three kinds of claim appear below, and they are never mixed without a tag:

| Tag | Means |
| --- | --- |
| `[CODE]` | Read from this repository. A file path or migration is named. Verify it yourself. |
| `[PUBLIC]` | Public behaviour of Blinkit / Zepto / Swiggy Instamart: what a person sees using the app or the website, and what those companies publish. Not a decompilation. |
| `[INFERENCE]` | My reasoning from the two above. Could be wrong. Says so. |

**No Blinkit or Zepto binary was decompiled, and none should be.** Three reasons,
in order of weight:

1. **Authorization.** The `rea` toolkit's own disclaimer requires that you are
   authorised to examine the target. This shop is not authorised to examine
   Blinkit's shipped APK. Cloning *visible behaviour* is ordinary competitive
   research; opening their binary is a different act with a different risk, and
   the client's name would be on the store listing, not mine.
2. **It answers the wrong question.** Binary RE tells you *how* an app implements
   a feature. It is very good at that. It is an expensive way to learn *which*
   features exist, which is legible from the product itself in ten minutes.
3. **It would not have changed a single row of the table below.** Every gap
   identified here is visible without a disassembler.

What *was* adopted from that toolkit is its discipline: every claim carries its
evidence and its limitations, and "I did not check" is written down rather than
smoothed over. That is the same rule `PRODUCTION.md` §2 already runs on.

**What this file does not know.** Nobody has run this app on a phone (`PRODUCTION.md`
C4). So every `[CODE]` gap below is a gap in the source; whether the existing
screens feel right is unverified and this file cannot say.

---

## 1. The four loops these apps actually run on

Blinkit, Zepto and Instamart look like hundreds of features. They are four loops,
and nearly every screen belongs to one of them. Judging this app feature-by-feature
against them misses that; judging it loop-by-loop is how you find real gaps.

| Loop | What it does | Why it exists |
| --- | --- | --- |
| **The promise** `[PUBLIC]` | A specific, small number of minutes on the home screen, and a countdown after ordering. | Grocery is an errand. The product is *the errand not happening*. The number is the whole marketing budget. |
| **The live order** `[PUBLIC]` | A map with a moving rider, a status ladder (confirmed → packed → **picked up** → arriving), an ETA that updates, a face and a call button. | This is where trust is won or lost. People check it 20 times. It is the single most-used screen in the category. |
| **The reorder** `[PUBLIC]` | "Buy again" on the home screen and in order history, one tap back into the cart. | Grocery is the most repetitive purchase in retail. The second order costs nothing to acquire. |
| **The correction** `[PUBLIC]` | Rate the order, report a missing or damaged item, get a refund with no argument, tip the rider. | Indian grocery runs on thin margins and thinner patience. One unresolved "the curd was missing" turns a household into an ex-customer. |

**This app already has loops 1, 3, and the skeleton of 4.**

- Loop 1: `home.deliveryIn` renders `zone.eta_minutes` on the home screen `[CODE]` — `apps/mobile/src/app/(tabs)/index.tsx:219`.
- Loop 3: `home.buyAgainTitle`, `order.reorder`, and a "Buy again" carousel `[CODE]` — `en.json`, `(tabs)/index.tsx`.
- Loop 4: `refund_due_paise` exists for the *owner's* books `[CODE]` — migration `20261021000002_shop_totals.sql`.

**Loop 2 is about a third built, and loop 4 has no customer side at all.**
Those two are the answer to "what has been left out".

---

## 2. The register

### 2.1 The live order — the biggest gap

| Blinkit / Zepto behaviour | This app today | Verdict |
| --- | --- | --- |
| A map showing the rider's current position, updating every few seconds | **No location anywhere.** `grep` for `lat`/`lng` across `supabase/migrations/` returns nothing `[CODE]` | **MISSING** |
| Status ladder distinguishes **packed** from **picked up from the shop** | `TRACK_STEPS` has four stops: placed/confirmed → packing → out_for_delivery → delivered `[CODE]` — `order/[id].tsx:346`. `out_for_delivery` means both "assigned to a rider" and "the bag is on the bike" | **MISSING** — this is the "has he picked it up or not" problem, exactly |
| An ETA after ordering that tightens as the rider moves | Only a static zone ETA before ordering: `zone.eta_minutes` on home `[CODE]`. Nothing on the order screen | **MISSING** |
| "Ravi is 1.2 km away · ~7 min · updated 20 s ago" | Nothing. `grep` finds no `distance`, no `km` key in either locale `[CODE]` | **MISSING** |
| Rider's face, name, one-tap call | **BUILT.** `RiderCard` + `rider_directory` (four columns only) `[CODE]` — migration `20261021000001` | **HAVE** |
| Honest terminal states — "could not deliver", "returned to shop" | **BUILT.** `failed` (with a required reason from a fixed translated list) and `returned`, both terminal, `failed` can never reopen as `delivered` `[CODE]` — test 18 | **HAVE — and better than most** |
| Proof of handover (OTP / photo) for COD | Nothing. `payment_status` moves to `paid` by hand `[CODE]` | **MISSING** (see §3.6 — maybe refuse) |

### 2.2 The correction loop — the second biggest gap

| Blinkit / Zepto behaviour | This app today | Verdict |
| --- | --- | --- |
| Rate the order and the delivery partner after delivery | No `rating` or `review` key in either locale `[CODE]` | **MISSING** |
| "Item missing / damaged / wrong" → refund decided in-app, with a record | Nothing customer-facing. `refund_due_paise` is computed for the owner's books and never shown to a customer `[CODE]` | **MISSING** |
| Tip the rider | No `tip` key `[CODE]` | **MISSING** |
| Support chat or a ticketed complaint | `call-shop.tsx` — one button that dials the shop `[CODE]` | **PARTIAL** — a phone call is the right answer in Kunigal; the missing half is the *record* |

### 2.3 The basket — mostly present, one real hole

| Blinkit / Zepto behaviour | This app today | Verdict |
| --- | --- | --- |
| Search across the whole shop | **BUILT**, client-side over the cached catalogue so it works on one bar `[CODE]` — `(tabs)/index.tsx:103` | **HAVE** |
| Category tiles, offers row, pack-size chips ("also in 1 kg") | **BUILT** `[CODE]` — `pack-options.tsx`, migration `20261021000004` | **HAVE** |
| Out-of-stock items shown but not addable | **BUILT** — filtered by `stock_qty > 0` `[CODE]` — `(tabs)/index.tsx:132` | **HAVE** |
| When one item is unavailable, the shop substitutes or removes it and the order continues at the corrected total | **Nothing.** An unavailable item can only fail the *whole* order `[CODE]` — `order_status.failed` | **MISSING — the most underrated gap here.** See §3.4 |
| Search filters and sort (price, brand, discount) | Nothing `[CODE]` | **MISSING, and should stay missing** — 34 products (§4) |
| Search autocomplete and recent searches | Nothing `[CODE]` | **MISSING, low value at this catalogue size** |

### 2.4 Checkout and money

| Blinkit / Zepto behaviour | This app today | Verdict |
| --- | --- | --- |
| One-tap UPI, cards, wallet, COD | `payment_method` is `cod` \| `online` `[CODE]`. Razorpay is deliberately not built (`AGENTS.md` §1) | **DELIBERATELY NOT YET** — Phase 8 |
| Coupons and discounts | **BUILT** `[CODE]` — migration `20261014000004` | **HAVE** |
| Free-delivery threshold nudge ("add ₹120 more") | The threshold is enforced server-side and stated as a fixed line at checkout: `checkout.freeDeliveryHint` renders `free_delivery_above_paise` `[CODE]` — `checkout.tsx:379`, `use-shop.ts:98`. It never says *how much more* is needed | **PARTIAL** — an informational line, not a nudge. Cheap to finish |
| Scheduled delivery ("send it at 6 pm") | No `schedule` or `slot` key `[CODE]` | **MISSING** — genuinely useful here (§3.5) |
| Double-tap safety on placing an order | **BUILT**, better than most: idempotency key + `place_order()` `[CODE]` — `lib/idempotency.ts` | **HAVE** |

### 2.5 The owner's side

| Blinkit / Zepto seller app | This app today | Verdict |
| --- | --- | --- |
| Live order board with sound | **BUILT** — Realtime + rider buzz `[CODE]` — `20261013000002` | **HAVE** |
| Day's takings, cash-in-hand, refund liability | **BUILT**, computed in Postgres `[CODE]` — `shop_day_totals()` | **HAVE — better than a spreadsheet** |
| Price/stock/on-off-shelf from the phone | **BUILT** — `update_product_from_shop()` `[CODE]` | **HAVE** |
| Add a product in Kannada from the phone | **BUILT** — `create_product_from_shop()` `[CODE]`, migration `20261021000005` | **HAVE** |
| Assign / reassign riders | **BUILT** `[CODE]` — `20261013000001`, test 09 | **HAVE** |
| Rider earnings and shifts | Nothing | **DELIBERATELY NOT** (§4) |

### 2.6 Growth and habit

| Blinkit / Zepto behaviour | This app today | Verdict |
| --- | --- | --- |
| Membership (Zepto Pass, Swiggy One) | No `membership` key `[CODE]` | **DELIBERATELY NOT** (§4) |
| Wallet / stored balance | No `wallet` key `[CODE]` | **DELIBERATELY NOT** — a float of other people's money, unlicensed, on a shop's books |
| Referral | No `referral` key `[CODE]` | **DELIBERATELY NOT** (§4) |
| Push notifications | Not built; needs an EAS development build (`AGENTS.md` §7) | **DEFERRED, and it is the real retention lever** |
| Favourites / shortlist | **BUILT** `[CODE]` — `20261014000002`, `favourite-button.tsx` | **HAVE** |
| Product ratings and reviews | Nothing | **REFUSE for now** (§4) — 34 products, no volume, trivially gamed |

---

## 3. The seven worth building for Kunigal

Ranked by *trust gained per rupee of effort*, not by what Blinkit has.

### 3.1 Rider location, text first (`SCALE-AND-TRACKING.md` §6, T3–T6)

The customer is in a courtyard with one bar of signal. "Ravi is 1.2 km away,
~7 minutes, updated 20 s ago" plus the existing call button answers the actual
question — *is it coming* — on 2G, with no tiles, no API key and no data bill.
A live map is the third rendering of the same data, not the first.

Everything needed is already designed and **nothing is built**: no columns, no
RPC, no view, no screen. See §5.

### 3.2 A real "picked up" step

Right now `out_for_delivery` is doing two jobs: *a rider has been assigned* and
*the bag is on the bike*. The owner assigns a rider while still packing, so the
customer sees "Out for delivery" for ten minutes while the bag sits on the
counter. That is a small lie, and this app's whole standard is refusing small
lies.

Fix: a `picked_up_at` timestamp on `orders`, set by the rider when they claim the
bag, and a fifth `TRACK_STEPS` stop. No new status needed, so no migration of the
`order_status` enum and no risk to the guard triggers.

### 3.3 A per-order ETA, computed in Postgres

Same rule as `shop_day_totals()`: the server owns the number. Straight-line
distance from the rider to the delivery landmark, a conservative speed, floored
at "a few minutes". The app renders it; the app never invents it.

### 3.4 Partial fulfilment — the gap I would argue for hardest

This is the one that is *not* cosmetic. Today, if a customer orders ten items and
the shop is out of the curd, the only honest options are: deliver without it and
refund the difference, or fail the whole order. The app supports only the second
`[CODE]`.

In a shop with 34 products on a shelf that a person can see, the curd runs out
daily. Failing a ₹450 order over ₹35 of curd is how a customer learns the app is
unreliable.

The shape: owner marks a line `unavailable` during packing → `place_order`-style
server-side recompute of `subtotal_paise`, `total_paise` and `refund_due_paise` →
customer sees "1 item unavailable, ₹35 refunded" on their order screen. This
needs a migration, a guard change, and a test that proves a customer cannot mark
their own item unavailable and thereby reduce their own bill.

**Do not build this by letting the client send new totals.** `AGENTS.md` §9.1.

### 3.5 Scheduled delivery

"Send it at 6" is how a shop works when the shop knows its customers. It is also
the cheapest way to smooth a rider's day in a town with one rider.

It is a *slot* on the order plus a guard rule (a rider cannot pick up a scheduled
order before its slot), not a scheduler service. Medium effort.

### 3.6 Refuse: proof of delivery / OTP

Blinkit uses OTP for high-value COD. At ₹450 average in a town where the rider
knows the family, an OTP is friction that solves a problem that does not exist
yet. Revisit if COD disputes appear. `[INFERENCE]`

### 3.7 Post-delivery rating — but only one question

Blinkit asks for a star rating and a rider rating. For this shop, that is data
nobody will read. The version worth building is the one that *routes to action*:
one screen after delivery — "Was everything right?" → **yes** / **something was
wrong** → a short translated picker (missing item, damaged, late, wrong address).
That produces a record, which is the thing a phone call cannot produce.

Pair it with §3.3's ETA and the correction loop closes.

---

## 4. What to refuse, and why

Writing this down is the point. Without it, every future session relitigates.

| Feature | Why not |
| --- | --- |
| **Membership / subscription** | It sells free delivery. Delivery is ₹25 and the whole order is ₹450. The accounting is negative and it makes the owner a debt collector. |
| **Wallet / stored balance** | Holding other people's money is a regulated activity (RBI PPI). The shop is not licensed and should not become one to save a UPI step. |
| **Referral programme** | Works when customer acquisition is the constraint. Here the constraint is that the shop cannot deliver faster than it already does. It pays people to bring customers the shop cannot serve. |
| **Search filters and sort** | Thirty-four products. A filter bar on a 34-item shelf is a worse search box. Revisit at ~300 SKUs. |
| **Product ratings and reviews** | No volume to average, and one family can move a 34-product catalogue's average. Fake certainty is worse than none. |
| **Live map as the default view** | Tiles are the data bill (`SCALE-AND-TRACKING.md` §6.5). Text first, map behind a tap. |
| **Rider earnings, shifts, route optimisation** | This is a shop with one to five riders and a person who assigns them by name. A workforce product for five people is theatre. |
| **Product photo upload from the customer app** | The owner's `admin/photos.tsx` already covers it `[CODE]`. A second write path is a second way to break the guard. |
| **A "second opinion" on the map provider** | Already decided: design so the map is replaceable, choose it last. Choosing it now locks the screen to a vendor before the data path exists. |

---

## 5. The build order

Extends `SCALE-AND-TRACKING.md` §8, which stops at T7. Phases T0–T2 are already
done or unblocked; the ones below are the actual work left.

| Phase | Work | Gate | Effort |
| --- | --- | --- | --- |
| **P1** | `src/lib/tracking-rules.ts` + `npm run check:tracking` — pure throttle logic, no native code | lint | S |
| **P2** | `rider_positions` table + `record_my_position()` + narrow read view + `picked_up_at` column + migration + **test proving the forbidden cases** | `npm run test:db` | M |
| **P3** | Rider: consent screen in Kannada + throttle wired to the rule module + "I have the bag" button | device | M |
| **P4** | Customer: text-first tracking block (distance, ETA, age) + fifth `TRACK_STEPS` stop | device | M |
| **P5** | Post-delivery "was everything right?" + translated problem picker → a recorded row | device | S |
| **P6** | Partial fulfilment: `unavailable` line state, server-side recompute, refund visibility | `npm run test:db` | L |
| **P7** | Scheduled delivery slots | device | M |
| **P8** | Optional: static route image, then live map behind a tap | owner's data budget | L |

P1 and P2 need no phone, no API key and no client decision. P3 onward do.

---

## 6. Decisions this file creates

For the owner/client, not the developer:

1. **Partial fulfilment or fail-the-order?** P6 is the largest build here. The
   shop must decide whether it will deliver a short order or cancel it.
2. **Scheduled delivery — is it worth a rider's day?** Needs a real answer about
   when people in Kunigal actually want groceries.
3. **`picked_up_at` — will riders tap it?** It is one button, but if nobody taps
   it the tracker is decoration. A device pilot answers this.
4. **If a rider's phone dies mid-delivery, what does the customer see?** Proposed
   default: position older than 10 minutes is not shown at all, and the screen
   falls back to the status ladder and the call button. Confirm.
