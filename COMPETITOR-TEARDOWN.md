# COMPETITOR-TEARDOWN.md — Blinkit and Zepto, measured

Written 2026-10-26. Companion to `FEATURE-PARITY.md`, which argues **which
features** matter and which to refuse. This file is the other half: the
**measured design and API evidence** behind those arguments, and the minute
details — the 13 px, the −2 px tracking, the 1 px hard shadow — that decide
whether an app feels like a product or like a form.

Read `FEATURE-PARITY.md` first for the business judgement. Read this for the
numbers.

---

## 0. How this was captured, and what it cannot see

### The tags used below

| Tag | Means |
| --- | --- |
| `[MEASURED]` | Read out of a live page/session in a real Chrome on 2026-10-26: computed styles, DOM, or a JSON response body the page itself fetched. Reproducible with §9. |
| `[CODE]` | Read from this repository. A path is named. |
| `[PUBLIC]` | Published statements, app-store listings, or third-party writing. |
| `[INFERENCE]` | My reasoning. Could be wrong. Says so. |
| `[UNKNOWN]` | Not observed. Written down rather than guessed. |

### The capture

- Real `google-chrome --headless=new`, **412 × 915 CSS px, DPR 3**, Android 13
  / SM-A536E mobile UA, `en-IN`. Both sites over HTTPS, no proxy, no
  interference with any protection mechanism.
- Blinkit: `https://blinkit.com/` — 191 requests, 1 841 elements, 0 JS errors.
- Zepto: `https://www.zeptonow.com/` → canonical `https://www.zepto.com/` — 217
  requests, 2 231 elements.
- Techniques: rendered DOM dump; **computed styles** of real elements (not
  stylesheet guesses); full stylesheet download and token extraction; and
  `Network.getResponseBody` on the JSON the page fetched itself, plus
  same-origin `fetch()` inside the page for unauthenticated endpoints.

### What this cannot see — state it plainly

1. **Cart, checkout, payment, order tracking, order history, and every
   account screen are behind phone-OTP login.** I did not log in and did not
   attempt to. Those screens are `[UNKNOWN]` at the pixel level here. Where
   this file discusses them, it says so and cites `[PUBLIC]` or flags a
   `[INFERENCE]`.
2. **No screenshot was interpreted by me.** I have no vision on this model. PNGs
   were captured (§9) and can be opened by a human; every claim below is text
   evidence — DOM, computed CSS, JSON — which is stronger for tokens and weaker
   for "does it look nice".
3. **No app binary was opened.** Same reasoning as `FEATURE-PARITY.md` §0:
   visible behaviour is ordinary competitive research, and this shop has no
   authorisation to disassemble Blinkit's APK.
4. **Two single captures, one city, one moment.** Blinkit's session resolved to
   merchant `31719`, city `HR-NCR`. Zepto's resolved to store
   `BLR-Whitefield New`, Bengaluru. Prices, ETA and layout are per-store and
   per-time; nothing here is a universal constant.

---

## 1. Blinkit, measured

### 1.1 The palette is a system, not a brand colour

`222` CSS custom properties on `:root` `[MEASURED]`. Not 222 colours used — 222
*decisions already made*, so no engineer ever types a hex by hand:

- **15 ten-step ramps**, `050`→`900` each: `avacado, blue, corn, green, grey,
  red, indigo, teal, brown, cider, orange, purple, pink, lime, yellow`.
- Plus legacy ramps the product still leans on: `--color__gro1..8` (brand
  yellow), `--color__grc1..10` (neutral ink → paper), `--color__grg1..8` (brand
  green), `--color__grr1..8` (danger red).
- Plus `base/grey/black/white` swatches.

The colours that actually paint the screen:

| Role | Value | Where |
| --- | --- | --- |
| Brand green | `#0C831F` | the cart bar, nothing else |
| Secondary green | `#318616` | the ADD button border and label |
| And its tint | `#F7FFF9` | the ADD button fill — *2 % green, not white* |
| Brand yellow | `#F8CB46` | offers, badges |
| Ink | `#1F1F1F` | product names, section headings |
| Body grey | `#666666` | default body text |
| Quiet grey | `#828282` | the struck-through MRP |
| App base | `#F5F8FA` | the page behind cards |
| Theme colour | `#1C2224` | the OS status bar (`<meta name="theme-color">`) |

`[MEASURED]` · `[INFERENCE]` The discipline worth stealing is not the green. It
is that **there is exactly one saturated colour per job**, and the surface under
it is white or `#F5F8FA` — near-neutral. The card is white, the ink is 16:1
against it, and the only loud thing on screen is the button you are meant to
press. Our app tints its backgrounds warm cream and washes selections in
`accentSoft`, so the accent has to compete with its own page.

### 1.2 The type is a commissioned typeface with eight weights

`[MEASURED]` `font-family: Okra, Helvetica`. The font faces actually loaded in
the session: **Okra 400, 500, 600, 700, 800** as separate faces, plus
`CustomFont` and two icon fonts (`wasabicons`, `IconFont`). `Paytone One`
(display) and `Okra 200` were declared but not loaded on this page.

Type in use, measured on the rendered page:

| Element | Size / weight / line-height | Colour |
| --- | --- | --- |
| "Delivery in 8 minutes" (hero) | 18 / 800 / 20.7 | `#000` |
| Section heading ("Hot deals") | 17 / 800 / 19.55 | `#1F1F1F` |
| Marketing heading ("Free delivery") | 32 / 800 / 36.8, **tracking −2 px** | `#1F1F1F` |
| Product name | 13 / 600 / 14.95 | `#1F1F1F` |
| Pack size ("1 ltr") | 12 / 500 / 13.8 | `#4F4F4F` |
| Price | 13 / 600 / 14.95 | `#1F1F1F` |
| MRP, struck | 12 / 500 / 13.8 | `#828282` |
| "see all" | 12 / 500 | `#318616` |
| Body default | 12 / 400 / 13.8 | `#666666` |

Two things there are not accidents `[INFERENCE]`: line height is **1.15×** the
font size at every level (13 → 14.95, 17 → 19.55, 32 → 36.8), which packs text
tight and makes a grid of 40 buttons feel dense rather than airy; and the 32 px
headline is tracked **−2 px**, i.e. 6 % of the font size is removed, which is
what stops large type looking loose and amateurish.

### 1.3 The product card, to the pixel

`[MEASURED]` 2-column grid, page gutter **12 px**, card width **138.56 px**:

```
┌─────────────────────────────┐
│  image                      │  ~139 px tall, explicit width+height attrs
├─────────────────────────────┤
│ Real Fruit Power Masala     │  13/600, lh 14.95, clamp-2 → 30 px block
│ Mixed Fruit Juice           │
│ 1 ltr                       │  12/500, lh 13.8,  #4F4F4F
│                             │
│ ₹76        ₹150             │  price 13/600 · MRP 12/500 #828282 struck
│                     ┌─────┐ │
│                     │ ADD │ │  66 × 32, radius 6, 1 px #318616,
│                     └─────┘ │  fill #F7FFF9, label #318616 13/600
└─────────────────────────────┘
```

Plus, on cards where it applies: a `49% OFF` badge and an `8 MINS` badge above
the name. **42 ADD buttons** were rendered within the first four screens — that
is the density target.

Three details `[INFERENCE]`:

- The ADD button is **outlined, not filled**. The only filled green on the page
  is the cart bar. So "green fill" means "money moving" and "green outline"
  means "consider this".
- The button fill is `#F7FFF9`, not white — a 2 % green wash that reads as
  "this is part of the button" without a second saturated block.
- The MRP is struck **and** two steps quieter (`#828282` vs `#1F1F1F`). The
  discount has to be legible without being the loudest thing on the card.

### 1.4 The chrome

`[MEASURED]`

- Header: `position: sticky`, height **128 px**, `z-index: 1000`, background
  `#FFF`, **no border and no shadow**. It separates from content by colour
  alone.
- Header content: "Delivery in 8 minutes" (the promise, 18/800), "Select
  Location", then the search field.
- Search placeholder **cycles** through `butter, paneer, chocolate, curd, rice,
  egg, chips`. It is a demo of what search can do, not a label.
- Cart bar: `position: fixed`, 12 px inset each side, 52 px tall (36 px of bar
  + 8 px padding), radius **12**, fill `#0C831F`, white text, and a separate
  64 px `CartButton__Fade` element behind it so content fades out rather than
  being cut.
- Location picker: a bottom sheet, 450 px tall, fill `#F4F6FC`, over a
  `rgba(50,50,50,0.7)` scrim. It opens on first load.
- **Zero `<h1>`–`<h4>` elements on the whole page.** Every heading is a `div`.
  `[INFERENCE]` Great for layout control, bad for screen readers and SEO — a
  trade-off we should not copy.

### 1.5 Motion and images

- `139` elements carry an animation or a non-trivial transition `[MEASURED]`.
- `add_to_cart_animation_config: { enabled: false, max_counter: 3 }` `[MEASURED]`
  — the fly-to-cart animation is **capped at 3 per session**. They measured that
  the flourish is delightful three times and irritating the fourth, and they
  shipped the cap as server config.
- Images: **47/47 have explicit width and height attributes**; 0 lazy, 0
  `srcset`, 0 `fetchpriority` on this page `[MEASURED]`. The CDN path itself
  encodes the size: `cdn.grofers.com/app/images/collections/asset_V7_312x360_…`
  and `?disable_resizing=true` to opt out. `[INFERENCE]` They render few enough
  images that eager loading wins, and they push resizing to the CDN path rather
  than to query params.

---

## 2. Zepto, measured

Zepto is the more instructive of the two, because Zepto publishes its design
system *as tokens* — the whole type scale is `--heading1-font-size` …
`--banner2-letter-spacing`, `214` custom properties `[MEASURED]`.

### 2.1 The complete type scale, verbatim

`[MEASURED]` Every step has size, weight, line height **and letter-spacing**.
Note that tracking is set at *every* level, including the small ones.

| Token | Size | Weight | Line | Tracking |
| --- | --- | --- | --- | --- |
| heading1 | 30 | 700 | 38 | −0.5 |
| heading2 | 24 | 700 | 30 | −0.5 |
| heading3 | 20 | 700 | 24 | −0.5 |
| heading4 | 18 | 600 | 20 | −0.3 |
| heading5 | 16 | 600 | 20 | −0.2 |
| heading6 | 14 | 600 | 18 | 0 |
| heading7 | 13 | 600 | 15 | −0.2 |
| heading8 | 12 | 600 | 14 | −0.2 |
| heading9 | 11 | 600 | 14 | −0.2 |
| body1 | 16 | 450 | 20 | 0 |
| body2 | 14 | 450 | 18 | 0 |
| body3 | 13 | 450 | 15 | 0 |
| body4 | 12 | 450 | 16 | 0 |
| body5 | 11 | 450 | 15 | +0.1 |
| body6 | 10 | 450 | 12 | −0.1 |
| strikethrough1–3 | 16 / 14 / 12 | 450 | 20 / 18 / 16 | 0 |
| cta1 | 16 | 700 | 20 | 0 |
| cta2 | 14 | 700 | 18 | 0 |
| cta3 | 12 | 700 | 16 | +0.1 |
| ctaNumber | 13 | 700 | 17 | +0.1 |
| overline1 | 10 | 600 | 13 | +0.2 |
| overline2 | 9 | 700 | 14 | +0.2 |
| banner1 | 20 | 800 | 24 | −0.2 |
| banner2 | 10 | 800 | 14 | **+0.7** |

Weights are `450 normal · 500 medium · 600 demibold · 700 bold · 800
extrabold` `[MEASURED]`. **450, not 400** — the regular weight is a hair heavier
so 10–12 px text stays legible on a phone at arm's length. `[INFERENCE]` That
single decision is worth more legibility than most contrast work, and it is a
number you can type into `fontWeight` as a string in React Native.

The sign of the tracking follows the job: negative on anything large, **positive
on anything small and uppercase** (`banner2` +0.7, `overline` +0.2, `cta3`
+0.1). That is the whole difference between "designed" and "default".

Other measured foundations:

- Shadows: `sm 0 0 8px rgb(40 44 63/.2)`, `md 0 2px 4px rgba(0,0,0,.08)`,
  base `0 2px 11.43px rgb(0 0 0/.08)`, `lg 0 2px 10px rgb(0 0 0/.12)`.
- `--safe-area-max-inset-bottom: env(safe-area-max-inset-bottom, 36px)` — the
  bottom bar clears iOS's home indicator by a real measurement.
- Radii actually used, by frequency: **10 px ×49, 8 ×34, 4 ×26**, 12 ×13, 6 ×12,
  pill ×8, 20 ×8, 16 ×8.
- Font sizes actually used: **14 ×73, 12 ×66, 10 ×55, 16 ×47, 18 ×28**, 20 ×18,
  8 ×17, 24 ×11, 32 ×11, 28 ×10, 40 ×5.
  `[INFERENCE]` The centre of gravity is **12–14 px**. Zepto is a dense app.
- Typeface: **`Zepto Norms`** (custom), with `Roca` and `Fraunces` (a serif)
  declared for campaign/display use `[MEASURED]`.

### 2.2 The palette

`[MEASURED]` stored as RGB triples, used through `rgb(var(--…))` so opacity can
be modulated without a new token:

| Token | Value | Role |
| --- | --- | --- |
| `color-primary` | `239,67,114` (`#EF4372`) | the pink — CTAs, ADD, price accents |
| `color-primary-violet` | `149,14,219` (`#950EDB`) | the 4 px band at the very top |
| `color-primary-dark` | `76,21,119` (`#4C1577`) | deep violet |
| `color-primary-void` | `43,30,53` (`#2B1E35`) | near-black violet |
| `color-text` | `19,0,34` (`#130022`) | ink |
| `color-map-bg` | `245,241,247` (`#F5F1F7`) | pale lavender page |
| `color-grey-light` | `240,244,249` (`#F0F4F9`) | cool grey |
| `color-success` | `39,184,123` | success |
| `color-error` | `217,0,0` | error |
| `color-saver-green` | `18,137,66` | "saver" pricing |
| `color-secondary-lemonade` | `245,233,60` | campaign accent |
| `color-secondary-slime` | `9,184,79` | campaign accent |
| `color-secondary-tangerine` | `255,121,77` | campaign accent |
| `color-warning` | `250,135,92` | warning |
| `color-secondary-black` | `38,42,51` (`#262A33`) | dark text |
| `color-secondary-black-lighter` | `117,124,141` (`#757C8D`) | quiet text |

`<meta name="theme-color">` is **`#DEC1FF`** — the OS status bar is tinted
lavender, so the brand starts above the app's own pixels `[MEASURED]`.

### 2.3 The signature: a stacked colour band

`[MEASURED]` Three fixed layers at the top of the page:

```
4 px    #950EDB   (violet, class "bar", z-index 10+)
12 px   #DEC1FF   (lavender, "fixed inset-x-0 top-0 z-50 h-3")
120 px  #EDDDFF   (lavender header, "sticky top-0 z-[60]")
```

A 4 px violet hairline, a 12 px lavender strip, then a lavender-tinted sticky
header, and the OS status bar painted `#DEC1FF` to match. `[INFERENCE]` This is
the single reason Zepto *reads* as a brand from across a room and we do not: the
top 16 px of the screen is a deliberate colour decision, repeated on the rider's
bag and the packaging `[PUBLIC]`. Ours is a white status bar over a cream page.

At the bottom: a fixed `58 px` element with a **white gradient fade**
(`linear-gradient(to top, #fff, #fff 0, transparent)`) so the list dissolves
under the cart/tab bar instead of being cut by it `[MEASURED]`.

### 2.4 The product card, to the pixel

`[MEASURED]` Card **129 px** wide, radius **10**, padding **4**, white:

```
┌───────────────────────────┐
│ ┌───────────────────────┐ │  image 121×121, radius 8,
│ │                       │ │  border 1px #DFE4EC
│ │              ┌──────┐ │ │
│ │              │ ADD  │ │ │  72 × 32, radius 8, white fill,
│ │              └──────┘ │ │  pink label 12/600, tracking +0.2,
│ └───────────────────────┘ │  border 1px pink, and
│ Apple                     │  box-shadow: pink 1px 1px 0 0
│ iPhone 17 Pro 5G 512 GB   │  ← the "sticker" offset
│ ⬡ 512 GB                  │  10/600 chip, radius 4,
│ ₹1,45,699  ₹1,54,900      │  bg rgba(11,12,14,.04), #586274
└───────────────────────────┘  price 14/700 + ₹ at 12/600
                               MRP 12/**450** #8B96A7, struck
```

Details worth naming `[INFERENCE]`:

1. **The ADD button is absolutely positioned, overlapping the image's
   bottom-right corner.** It is not in the layout flow. That buys ~32 px of
   vertical space per card and puts the tap target under the thumb.
2. **`box-shadow: 1px 1px 0 0` pink** — a hard, un-blurred offset, not a soft
   elevation. It reads as a printed sticker. It costs one shadow with no blur
   radius, so it is nearly free to paint, and it is the single most
   recognisable detail on the card.
3. **The rupee sign is set smaller than the number** (12 vs 14). Every price
   looks professionally set because of it, and no design tool does that for you.
4. **The image has a `1px #DFE4EC` border**, not a shadow. Product photos are
   mostly white; without a hairline they bleed into the card.
5. The MRP weight is **450**, lighter than the price's 700 — the discount
   hierarchy is carried by weight, not only by the strike.

### 2.5 The home screen is assembled from typed widgets

`[MEASURED]` `GET /lms/api/v2/get_page?page_type=HOME&version=v2&page_size=…`
returns a `pageLayout.widgets[]`, each with `widgetType`, `widgetHeader`,
`widgetFooter`, `viewMeta{numberOfColumns, padding}`, `experiments`, `order`,
`campaignName`, `deeplink`, `action`.

The 15 widgets on one home page: `HORIZONTAL_LIST`, `BANNER_GRID_V2`,
`BANNER_CAROUSEL_WITHOUT_TITLE`, `SPACER` (with `spacerHeight: 16`),
`CATEGORY_GRID_V2` ×6, `BANNER_GRID` (`SHOP_BY_STORE`),
`GROUPED_HORIZONTAL_CAROUSEL_V1`, `VERTICAL_LIST`.

`[INFERENCE]` That is the difference between "our home screen is a `ScrollView`
with six sections in code" and "our home screen is a list of data". Changing the
order of sections, adding a Diwali strip, or A/B testing a rail is a database
row for Zepto and a release for us. **We should not build this** — see §7 — but
we should build the *one* thing it buys cheaply: a section order and section
visibility that the owner can change without a build.

Also in `pageLayout` `[MEASURED]`: `isScheduleDeliveryEnabled`,
`isListsEnabled`, `isYfpEnabled`, `isZeptoThreeEnabled`, `smartBasketAvailable`,
`isE2EAdsEnabled`, `isEmiEnabled`, `pageReloadTime: 900000` (**15 minutes** —
the server tells the client how long the home page is good for), and a
server-driven `bottomNav` with **separate active and inactive SVG icons** per
tab, plus a `pageMeta.floatingAction` cart button that can show a
`bachatItemCount` (rupees saved).

### 2.6 Zepto's product schema

`[MEASURED]` One product item from a `VERTICAL_LIST`, as the API returns it:

```json
{
  "id": "...",                      // variant id
  "baseProductId": "...",           // product id  ← product vs variant, two levels
  "sellingPrice": 112100, "mrp": 279900,
  "discountAmount": 167800, "discountPercent": 59,
  "pricePerUom": 5605,              // ₹ per litre/kg ← comparison price
  "unitOfMeasure": "...", "uom": "...", "quantity": 2000,
  "availableQuantity": 3,           // stock, exposed to the customer
  "pricingData": { "pricingEntityPrices": [
      { "pricingEntity": "SUPER_SAVER", "discountedSellingPrice": 112100 },
      { "pricingEntity": "ULTRA_SAVER", "discountedSellingPrice": 112100 } ] },
  "primaryCategoryName": "Atta, Rice, Oil & Dals",
  "primarySubcategoryName": "Oil",
  "product": {
    "name": "Jivo Extra Light Olive Oil", "brand": "Jivo",
    "countryOfOrigin": "Spain", "ingredients": "",
    "manufacturerName": "Jivo", "manufacturerAddress": "",
    "minimumRequiredAge": 0, "description": ["..."]
  },
  "productVariant": {
    "formattedPacksize": "1 pc (2 L)",
    "images": [{ "width": 2800, "height": 2800, "resizeMode": "contain" }],
    "l4Attributes": { "returnable": false, "replacementReturnWindowTime": 3,
                      "selfServeReturnable": false, "emiType": "" }
  },
  "productCardTags": { "slot3": [{ "tagName": "Fry, Roast, Cook",
                                   "tagType": "ATTRIBUTE", "position": "P2" }] }
}
```

What that proves they model, that we do not `[INFERENCE]`:

| Field | Why it exists |
| --- | --- |
| `pricePerUom` | ₹/litre. **The only honest way to compare a 900 ml bottle against a 1 L bottle**, and legally expected for some prepacked goods. |
| `baseProductId` + `id` | Product vs variant, so "also in 1 kg" is a query, not a second row. We have `product_pack_options` — the same idea, narrower. |
| `availableQuantity` | Stock shown to the customer ("only 3 left"), which doubles as the per-SKU order cap. |
| `pricingData.SUPER_SAVER` | Multiple prices per product per customer segment. |
| `primaryCategory / Subcategory / l3CategoryDetails` | **Three levels.** We have one. |
| `l4Attributes.returnable` + `replacementReturnWindowTime` | Return policy per product, not per shop. |
| `countryOfOrigin`, `ingredients`, `manufacturerName/Address`, `minimumRequiredAge` | Printed on the pack anyway; the app has to be able to show it. |
| `productCardTags` with `position: P0/P2` | Which badge goes in which slot on the card, chosen server-side. |

---

## 3. The ETA model — the most useful thing in this whole teardown

`[MEASURED]` `GET /v1/consumerweb/eta` returns:

```json
{ "eta_in_minutes": 8,
  "title": "Delivery in 8 minutes",
  "update_eta_action": { "update_eta": { "eta_map_v2": {
    "31719": {
      "express":                     { "eta": 8 },
      "large_order":                 { "eta": 12 },
      "payment_mode_cash_on_delivery": { "eta": 10 },
      "longtail":                    { "eta": 8 },
      "super_longtail":              { "eta": 8 },
      "pharma_rx_general_medicine":  { "eta": 30 },
      "pharma_rx_preapproved":       { "eta": 8 },
      "installation_fan_installation": { "eta": 10 },
      …
    }, "35940": { "instant": { "eta": 10 } } } } } }
```

Read that carefully. **The delivery promise is not one number.** It is a function
of `(store, order shape)`:

- Normal grocery: **8 min**.
- A **large order**: **12 min** — the same rider, more bags.
- **Cash on delivery**: **10 min**, *slower than prepaid* — because cash has to
  be reconciled at the door.
- A prescription-only medicine: **30 min** — because a pharmacist has to look at
  it.
- Different store (`49971`): 30 min for the same medicine.

And the same payload carries `asset_map`, which is **design tokens chosen by the
server**: `{ "text_data": { "color": {"type":"cider","tint":"700"},
"font":{"size":"050","weight":"bold"} }, "bg_color_data":
{"type":"cider","tint":"100"}, "image_data": {"url":
"…/eta-icons/30-mins.png"} }` — a badge whose colour, tint, font size and weight
and icon all come from the API, addressed by the same token names as the CSS
ramps in §1.1.

`[INFERENCE]` **This is the single claim in this file I would act on first.**
Our app renders `zone.eta_minutes` — one number per delivery zone
`[CODE]` `apps/mobile/src/app/(tabs)/index.tsx`. That is the same promise for a
₹120 order and a ₹4 000 one, for prepaid and for cash, at 09:00 and at 20:55.
Blinkit's own numbers say a large order is **50 % slower**. Publishing one
number and missing it half the time is worse than publishing a range and meeting
it. It is also cheap for us: a `eta_minutes` function of `(zone, total, payment
method, item count)` in Postgres is a single migration and a test, and it needs
no new screen.

---

## 4. What their own feature flags admit they have

`[MEASURED]` `GET /api/feature-flags/receive` returned 38 flags. They are a
feature inventory written by the companies themselves — better evidence than any
screenshot, because a flag exists only if someone shipped a path behind it.

**Blinkit** (verbatim flag names, grouped):

| Group | Flags |
| --- | --- |
| Search | `is-type-to-search-mweb-enabled` (typeahead), `is-web-search-bff-enabled`, `is-web-location-auto-suggest-enabled` (address autocomplete) |
| Catalogue | `is-web-plp-bff-enabled`, `is-web-pdp-bff-enabled`, `is-web-mobile-pdp-v2-enabled`, `is-web-desktop-bff-*` |
| Cart & money | `is-web-cart-coupon-enabled` (**false** at capture), `is-web-zpay-enabled`, `is-web-zpay-v2-enabled`, `is-web-new-cart-address`, `is-web-cart-share-enabled`, `show-bill-and-tip-v2-on-web`, `is-web-dp-tip-enabled` |
| Orders | `is-web-bff-order-history-enabled`, `is-web-v1-order-count-enabled` |
| Tracking | `is-web-bff-crystal-track-order-enabled`, `is_web_crystal_track_v2_enabled` — their tracking system is named **Crystal** |
| Support | `is-web-onesupport-enabled`, `is-web-agent-tools-enabled` |
| Other verticals | `is-web-pharma-checkouts-enabled`, `is-web-print-enabled`, `is-web-gyftr-enabled` (gifting), `is-web-blinkit-link-enabled`, `dc-web-enabled` (dark store) |
| Platform | `is_consumer_web_bff_enabled`, `is-web-jumbo-client-enabled`, `is-web-paas-async-validation-enabled`, `is-web-paas-revamp-enabled` |

**Blinkit's `secondary-data` response** `[MEASURED]` is a table of contents for
features we cannot see without logging in:

| Key | What it means for us |
| --- | --- |
| `sbc_free_delivery_details: { free_delivery_count, minimum_order_value, order_limit: 30 }` | "SBC" is their membership; it sells **30 free deliveries**. Confirms the model `FEATURE-PARITY.md` §4 refuses — and shows what the refusal costs: a 30-order hook. |
| `app_refresh_data.background_to_foreground_refresh: { distance_in_meters: 300, duration_in_seconds: 420 }` | **Refresh on resume if you moved 300 m or 7 minutes passed.** A precise, copyable rule for our stale-data problem. |
| `add_to_cart_animation_config: { enabled, max_counter: 3 }` | Cap the flourish at 3. |
| `prefetch_media[5]` kinds: `image, video, lottie, web_resource, audio` | They preload five media types at boot. We should preload exactly one thing (the catalogue) — see §6. |
| `loading_overlay_config` — a Lottie loader with a `recurrence_expr: "DTSTART;TZID=Asia/Kolkata:…"` | The cold-start loader is a **scheduled marketing slot**, timezone-aware. |
| `search_bar_ui_config_map` — hint text, icon codepoint, mic visibility, `margin: "4,12,4,12"`, `bg_color {type:"accent",tint:"900"}` | Even the search bar is server-driven. |
| `profile_image_banner` → `birthday_input_bottom_sheet` | They capture birthdays for the one message people actually like. |
| `sbc_auto_renewal_data` with `"Membership will auto renew at ₹%s after %s"` | Renewal copy, parameterised. |
| `trending_searches_list`, `live_activity_ads`, `splash_ads` | Advertising slots. |
| `analytics_properties.services` = `express, longtail, unicorn, super_longtail, instant` + **emergency ambulance numbers** | One app, five service tiers, and a public-service page. |

`[INFERENCE]` The two rows I would act on: **the 300 m / 420 s resume rule** (§6)
and the **membership counter**, only to note that a 30-order discount hook is
what we are declining.

---

## 5. Side by side with ours

All three columns are measured or `[CODE]`, not estimated.

| | **Blinkit** | **Zepto** | **Ours** `[CODE]` |
| --- | --- | --- | --- |
| Typeface | Okra (custom, 5 loaded weights) | Zepto Norms (custom, 450→800) | Latin: **system sans** (Roboto / SF — differs per platform); Kannada: **bundled Noto Sans Kannada ×4 weights** `[CODE]` `constants/fonts.ts` |
| Type scale | sizes only, weight+LH inline | 24 named steps, each with **tracking** | 10 steps, **no tracking token** (5 one-off `letterSpacing` values exist, all for codes: `login.tsx:350`, `checkout.tsx:595`, `admin/coupons.tsx:567`, `index.tsx:717`, `demo-accounts.tsx:136`) |
| Smallest text | 12 px | 9–10 px (overline/banner) | **12.5 px floor** (`Type.caption`) — deliberate |
| Body line height | 1.15× | 1.25–1.4× | **1.5×** (`body` 16/24) — deliberate, for Kannada |
| Card name | 13/600/14.95, clamp-2 → 30 px | 12/500/14, clamp-2 → 28 px | **16/600/24, clamp-2 → 48 px** |
| Card pack line | 12/13.8 → 14 px | 12/16 → 16 px | **14/22 → 22 px** |
| Card price | 13/600 | 14/700 (+small ₹) | **17/800** |
| Text block, 2-line name | **≈59 px** | ≈62 px | **≈94 px** |
| Page gutter | 12 px | 16 px | 16 px (`Spacing.three`) |
| Card radius | 6 (button) | 10 (card), 8 (image + button) | `Radii.lg` 20 / `md` 14 |
| Radii set | — | 4/8/10/12 | **10/14/20/28/pill** |
| Spacing scale | — | 4/8/12/16… | **2/4/8/16/24/32/64 — no 12** |
| Brand accent | `#0C831F` / `#318616` | `#EF4372` / `#950EDB` | `#0F7B3E` (nearly Blinkit's green) |
| Page surface | white + `#F5F8FA` | `#F5F1F7` + lavender band | **`#FFFBF3` cream + `accentSoft` washes** |
| Ink | `#1F1F1F` | `#130022` | `#221B12` |
| Status bar | `#1C2224` | **`#DEC1FF`** | not set |
| Dark mode | web: none | web: none | **full second palette** (System/Light/Dark, persisted) |
| Section headings | 17/800/19.55 | 18/700/22 (−0.2) | `heading` 19/700/28 |
| Custom shadow | none | 4-step scale | `Elevation` presets |
| Motion | 139 animated elements, cart animation capped at 3 | 129 animated | **none by decision** (`SCALE-AND-TRACKING.md` T0: static skeletons) |
| Image sizing | explicit w/h, 0 lazy | explicit w/h, **lazy + `fetchpriority`**, CDN transform `w-144,q-40,f-auto,pr-true` | `expo-image`, `contentFit="cover"`, `transition={150}` |
| Product data | name, pack, price, MRP, disc %, ETA badge | + brand, ₹/kg, stock left, return policy, origin, ingredients, 3-level category | name_en/kn, price, MRP, unit, stock, pack structure |

---

## 6. Why people love their theme, and do not love ours

Seven mechanisms, in order of how much they matter. This is the honest answer,
and it is not "they have nicer colours".

**1. A commissioned typeface, and tracking that follows the size.**
We ship **two** families and never designed them as a pair `[CODE]`: Latin is
`system-ui` — Roboto on Android, SF on iOS — so English looks like a different
app per platform; Kannada is **Noto Sans Kannada**, four weights, bundled
(`apps/mobile/src/constants/fonts.ts`, `assets/fonts/*.ttf`, OFL) precisely so it
stops changing between phones. That was the right call and it is more than
Zepto does. But the *relationship* is unmanaged: a bilingual line set in Noto
Sans Kannada next to Latin text is two faces with two x-heights, two stroke
weights and two sets of sidebearings on one baseline. Blinkit and Zepto own both
halves of the problem because they own the face. `[INFERENCE]` The cheapest fix
that preserves the Kannada decision is **one variable family with real Latin and
real Kannada** (the bundled Noto Sans family already ships both cuts, so the
licence may already cover it — worth checking before buying anything); the
expensive version is a commissioned Kannada face. Either way it is a licence
question and a `fonts.ts` change, not a redesign.

**2. There is one loud colour, and it is the thing you press.**
Blinkit's entire page is white, `#1F1F1F` ink, and green on exactly two things:
the ADD outline and the cart bar. Ours tints the background cream, tints selected
chips `accentSoft`, tints banners `accentSoft`, and then uses `accent` for the
button — so the button is the same colour as the furniture. `[INFERENCE]` The
fix is a rule, not a palette change: **`accentSoft` may never sit adjacent to an
`accent` fill**, and green fills are reserved for money-moving actions.

**3. Density, honestly measured.** Our card's text block is **94 px** against
their **59–62 px** — 1.6×. On a 412 × 915 screen that is roughly 3 rows of
products instead of 4.5. `[INFERENCE]` But this is the one place where copying
would be wrong: 1 in 3 adults in Kunigal cannot comfortably read a sentence
(`KUNIGAL.md`), so 12 px product names and a 12.5 px floor would be a
regression, not a polish. **We should keep our sizes and win the space back
elsewhere**: 12 px gutters instead of 16, image radius instead of a padded
frame, a discount badge overlaying the image instead of sitting above the name,
and the ADD control anchored to the price row (as Zepto does, absolutely
positioned) rather than in its own footer row with `marginTop: Spacing.two`
`[CODE]` `product-card.tsx`.

**4. The top 16 pixels.** Zepto spends 4 px of violet, 12 px of lavender, paints
the OS status bar `#DEC1FF`, then tints the header. It is the first thing the eye
sees and it costs nothing to paint. Ours begins with an unset status bar over a
cream page. `[INFERENCE]` One `<meta>`/`expo-status-bar` colour and one 4 px
marigold hairline under it would buy more perceived brand than any new screen.

**5. A system for the parts nobody designs.** Zepto has 24 named type steps; we
have 10 and no tracking. Their radii are 4/8/10/12; ours are 10/14/20/28, so
nothing can ever look crisp — every corner is soft. Their spacing scale includes
12; ours jumps 8 → 16, which is why our cards cannot be tightened without a
magic number. `[INFERENCE]` These are the differences a user cannot name and can
always feel.

**6. Depth is drawn, not blurred.** Zepto's ADD button uses `1px 1px 0` with no
blur — a sticker. Blinkit uses a 1 px border and a 2 % tint. Both avoid the soft
drop shadow that makes a card look like a 2014 Material demo. Our `Elevation`
presets are blurred shadows.

**7. The promise is a badge, not a paragraph.** "8 MINS" sits **on the product
card**, in a badge, next to the discount. Speed is repeated at the moment of
choosing, not announced once at the top. Ours says it once in the hero
`[CODE]` `home.promise` and never again.

**And two things we do better, which should be defended** `[CODE]`:
**dark mode** (neither web app has one) and a **12.5 px legibility floor with 1.5×
line height** (Zepto ships 9–10 px overlines). Neither is a gap. They are the
reason a 55-year-old in Kunigal can use this app at all.

---

## 7. The gap list, and what I would do about each

Ordered by what it costs a customer today. **A** = do it, **B** = do it after
launch, **C** = refuse with a reason.

### A — worth doing before launch

| # | Gap | Evidence | Where it lands |
| --- | --- | --- | --- |
| A1 | **ETA is one number per zone.** Theirs is a function of store × order shape: large order +50 %, COD +2 min, prescription +22 min. | `[MEASURED]` §3 | migration + `shop_day_totals`-style RPC; home hero, checkout, order screen |
| A2 | **No per-unit price (₹/kg, ₹/L).** The one honest way to compare two packs on the same shelf. | `[MEASURED]` §2.6 `pricePerUom` | `product_pack_options` already normalises g/ml (`PRODUCTION.md` M4); add `price_per_100g` display derived in `src/lib/pack.ts` |
| A3 | **Stock is invisible until checkout fails.** They show `availableQuantity` and "only 3 left". | `[MEASURED]` §2.6 | `product-card`, product screen — we already have `stock_qty` |
| A4 | **No status-bar / top-of-screen brand.** | `[MEASURED]` §2.3, §1.1 | `app.json` + root layout |
| A5 | **No tracking on the type scale**, so headings read as default. | `[MEASURED]` §2.1 vs `[CODE]` `theme.ts` `Type` | `Type` gains `letterSpacing` per step (−0.5 large → +0.2 overline) |
| A6 | **`Spacing` has no 12**, so 12 px gutters need magic numbers. Blinkit's page gutter is 12. | `[MEASURED]` §1.3 vs `[CODE]` | `theme.ts` `Spacing.three` stays 16; add `twoHalf: 12` |
| A7 | **Refresh-on-resume rule is ad hoc.** Theirs: 300 m **or** 420 s. | `[MEASURED]` §4 | `hooks/` + `SCALE-AND-TRACKING.md` PERF rows |
| A8 | **No `fetchpriority` / no lazy strategy per image role.** Zepto: lazy + `fetchpriority=low` + `w-144,q-40`; Blinkit: eager + explicit size. | `[MEASURED]` §1.5, §2 | `product-card` (first 4 eager, rest lazy), `expo-image` `priority` |
| A9 | **Missing catalogue truth**: brand, country of origin, ingredients, manufacturer, net quantity, return/replacement window. These are on the pack and are legally expected for prepacked goods. | `[MEASURED]` §2.6 | migration + product screen. **Legal Metrology wording is still `[UNVERIFIED]`** (`PRODUCTION.md`) — this is the row that touches it |
| A10 | **Two-level taxonomy.** They have L1 → L2 → L3. We have one flat list of 8. | `[MEASURED]` §1.5, §2.6 | categories gain `parent_id`; matters at ~300 SKUs, not at 34 |

### B — after launch

- **B1 `availableQuantity` as the per-SKU cap** — `product_sku_limit` is a flag on their side; we can enforce `quantity <= stock_qty` in `place_order()`, which we may already do. `[UNVERIFIED]` — check the migration before claiming it.
- **B2 Section order/visibility the owner can change without a build.** Not a widget engine (§2.5) — one `store_settings.home_sections jsonb` column and a `RENDERERS` map.
- **B3 Cart button that shows rupees saved** (`bachatItemCount`). We already compute `discount_paise`; showing "₹40 saved" in the cart bar is a label change.
- **B4 Search placeholder that cycles** with real shelf items ("ಅಕ್ಕಿ", "ಹಾಲು") — a copy change, and it teaches what search can do to someone who has never used search.
- **B5 Birthday capture** (one optional field, one message). Theirs is a bottom sheet, server-driven; ours can be a row in the account screen.
- **B6 Cap the add-to-cart flourish at 3** — *if and when* we add one. Recorded so nobody ships an uncapped animation later.
- **B7 Home page TTL** (`pageReloadTime: 900000`). Our `SHELF_STALE_MS` is 5 min `[CODE]`; theirs is 15. Ours is more conservative; leave it.

### C — refuse, with reasons (extends `FEATURE-PARITY.md` §4)

| Feature | Why not |
| --- | --- |
| **Server-driven UI (LMS widgets)** | Fifteen widget types, an experiments field, and per-widget analytics. It is a platform for a company with a merchandising team shipping six campaigns a day. We have one shop and 34 products. B2 gets 90 % of the value for one column. |
| **Tiered pricing (`SUPER_SAVER` / `ULTRA_SAVER`)** | Two prices for the same item is a discount engine. `FEATURE-PARITY.md` §4 already refuses membership; this is membership's plumbing. |
| **Their density (12–13 px names)** | Directly contradicts `KUNIGAL.md`. See §6.3 — keep the sizes, take the space back structurally. |
| **`user-scalable=0`** | Measured in their viewport meta `[MEASURED]` §1.1 note. It disables pinch-zoom. For an app whose users include people with weak eyesight, that is an accessibility defect, not a technique. |
| **Zero semantic headings** | Blinkit renders **no `<h1>`–`<h4>`** `[MEASURED]`. On React Native that maps to `accessibilityRole="header"`; we should keep ours. |
| **One app, five service tiers** (express / longtail / unicorn / instant / pharmacy) | Their store map, not ours. |
| **Retail media slots** (`live_activity_ads`, `splash_ads`, `isE2EAdsEnabled`) | Advertising inventory needs advertisers. |
| **Buying a commissioned typeface now** | The Latin/Kannada mismatch in §6.1 is real, but a purchase is not the first move: the Noto Sans superfamily already covers both scripts under the OFL we accepted for Kannada `[CODE]` `assets/fonts/OFL.txt`. Try the free unification first and only commission a face if it still looks wrong. |

---

## 8. Decisions this file needs

1. **Typeface — do we unify Latin and Kannada?** One family with real cuts of
   both, so a bilingual line shares one x-height. Before spending anything:
   the Noto Sans superfamily ships both cuts under OFL, so the licence we
   already accepted for Kannada may cover the Latin half too — that is a
   five-minute check, not a purchase. A commissioned face is the expensive
   version of the same decision. This is the only item in §6 that cannot be
   done by a developer alone.
2. **Density — do we tighten the card?** My recommendation: keep 16 px
   name / 12.5 px floor, and recover space with a 12 px gutter + an
   overlaid discount badge + the ADD anchored to the price row. That buys a
   third row of products without shrinking a single glyph. Any further and we
   contradict `KUNIGAL.md`.
3. **ETA — is the owner willing to publish `(zone, order size, payment method)`**
   instead of one number per zone? It is more honest and it is a Postgres
   function, but it means telling a customer "20–25 min" for a big prepaid
   order on a Sunday.
4. **A9 — who supplies the pack facts?** Brand, net quantity, manufacturer,
   country of origin, ingredients. Either the owner types them per product (34
   products, an evening's work) or they stay empty. Empty is a legal exposure
   for prepacked goods `[UNVERIFIED]` — needs the CA, not me.
5. **A4 — is a marigold hairline + a tinted status bar acceptable branding**,
   or does the owner want the shop's own colour? It is the cheapest brand
   change available and it needs one opinion, not a design project.

---

## 9. How to re-run this

Everything below ran on this machine on 2026-10-26 and is reproducible.

```bash
mkdir -p /tmp/opencode/teardown && cd /tmp/opencode/teardown
# cdp.js      – 60-line Chrome DevTools Protocol client, Node 22 global WebSocket, no deps
# probe.js    – computed design tokens, headings, CTAs, images, network, at 412×915 DPR3
# anatomy.js  – one component subtree with computed styles + fixed/sticky chrome
# harvest.js  – JSON response bodies from the page's own session
# pagefetch.js– same-origin fetch() for unauthenticated endpoints
node probe.js    zepto   https://www.zeptonow.com/
node probe.js    blinkit https://blinkit.com/
node anatomy.js  blinkit https://blinkit.com/ ADD
node anatomy.js  zepto   https://www.zeptonow.com/ ADD
node harvest.js  blinkit-api https://blinkit.com/ 'blinkit\.com/(v1|v2|api)'
node harvest.js  zepto-api   https://www.zeptonow.com/ 'bff-gateway\.zepto\.com'
node css-tokens.js        # colour/type/radius/shadow frequency + every CSS custom property
```

`Rea` note: the `reverse-engineer-anything` skill is installed at
`~/.config/opencode/skills/reverse-engineer-anything/`, but its MCP server was
**not run** — it requires Node ≥ 22.23.4 (this machine is 22.22.0) and an
`opencode` MCP registration that does not exist. What was used is the skill's
method: evidence tags, "what this cannot see" stated first, and no claim without
a source. See `FEATURE-PARITY.md` §0 for why no binary was opened.

**Next capture, when someone can log in:** cart, checkout, live-tracking and
order-history screens; the ADD → stepper transition (measure the tap target and
the state change); and one Zepto `get_page` during a festival, to see
`festivalUITheme` in effect. None of these are reachable without a phone number
and I did not attempt to obtain one.
