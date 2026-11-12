# COMPETITOR-TEARDOWN.md â€” Blinkit and Zepto, measured

Written 2026-10-26. Companion to `FEATURE-PARITY.md`, which argues **which
features** matter and which to refuse. This file is the other half: the
**measured design and API evidence** behind those arguments, and the minute
details â€” the 13 px, the âˆ’2 px tracking, the 1 px hard shadow â€” that decide
whether an app feels like a product or like a form.

Read `FEATURE-PARITY.md` first for the business judgement. Read this for the
numbers.

> **Status 2026-11-03 â€” the plan now has a build log.** The measurements and the
> A/B/C lists below are still the record. **A5, A6, A3 and A2 are built** in the
> working tree (see the top `CHANGELOG.md` entry): Latin-only type tracking, the
> `Spacing.twoHalf = 12` token, the low-stock badge on the shelf card, and an
> integer-paise â‚¹/kg Â· â‚¹/L rate behind every pack (`src/lib/unit-price.ts`, with
> `check:unit-price` in the lint chain). **A1, A4 and A7â€“A10 are not started.**
> A1 needs the owner's honest ETA numbers, A4 needs decision 5, A9 needs the owner
> and a CA, and A10 waits for ~300 SKUs. Â§10 adds three items measured on
> Flipkart's web on 2026-11-06 with REA (A11 rating on the card, A12 an
> itemised fee line, A13 "save for later") â€” all three need an owner decision
> before build, and A12 must not be read as a licence to hide a margin.
> The five decisions in Â§8 remain open.
> `HANDOFF.md` Â§6.4 has the item-by-item audit, plus three corrections to this
> file: A2's file target was wrong for this repo (it now lives in its own module,
> not `pack.ts`), A3's real gap was the card rather than the product page, and A5
> must not apply negative tracking to Kannada.

---

## 0. How this was captured, and what it cannot see

### The tags used below

| Tag | Means |
| --- | --- |
| `[MEASURED]` | Read out of a live page/session in a real Chrome on 2026-10-26: computed styles, DOM, or a JSON response body the page itself fetched. Reproducible with Â§9. |
| `[CODE]` | Read from this repository. A path is named. |
| `[PUBLIC]` | Published statements, app-store listings, or third-party writing. |
| `[INFERENCE]` | My reasoning. Could be wrong. Says so. |
| `[UNKNOWN]` | Not observed. Written down rather than guessed. |

### The capture

- Real `google-chrome --headless=new`, **412 Ã— 915 CSS px, DPR 3**, Android 13
  / SM-A536E mobile UA, `en-IN`. Both sites over HTTPS, no proxy, no
  interference with any protection mechanism.
- Blinkit: `https://blinkit.com/` â€” 191 requests, 1 841 elements, 0 JS errors.
- Zepto: `https://www.zeptonow.com/` â†’ canonical `https://www.zepto.com/` â€” 217
  requests, 2 231 elements.
- Techniques: rendered DOM dump; **computed styles** of real elements (not
  stylesheet guesses); full stylesheet download and token extraction; and
  `Network.getResponseBody` on the JSON the page fetched itself, plus
  same-origin `fetch()` inside the page for unauthenticated endpoints.

### What this cannot see â€” state it plainly

1. **Cart, checkout, payment, order tracking, order history, and every
   account screen are behind phone-OTP login.** I did not log in and did not
   attempt to. Those screens are `[UNKNOWN]` at the pixel level here. Where
   this file discusses them, it says so and cites `[PUBLIC]` or flags a
   `[INFERENCE]`.
2. **No screenshot was interpreted by me.** I have no vision on this model. PNGs
   were captured (Â§9) and can be opened by a human; every claim below is text
   evidence â€” DOM, computed CSS, JSON â€” which is stronger for tokens and weaker
   for "does it look nice".
3. **No app binary was opened.** Same reasoning as `FEATURE-PARITY.md` Â§0:
   visible behaviour is ordinary competitive research, and this shop has no
   authorisation to disassemble Blinkit's APK.
4. **Two single captures, one city, one moment.** Blinkit's session resolved to
   merchant `31719`, city `HR-NCR`. Zepto's resolved to store
   `BLR-Whitefield New`, Bengaluru. Prices, ETA and layout are per-store and
   per-time; nothing here is a universal constant.

---

## 1. Blinkit, measured

### 1.1 The palette is a system, not a brand colour

`222` CSS custom properties on `:root` `[MEASURED]`. Not 222 colours used â€” 222
*decisions already made*, so no engineer ever types a hex by hand:

- **15 ten-step ramps**, `050`â†’`900` each: `avacado, blue, corn, green, grey,
  red, indigo, teal, brown, cider, orange, purple, pink, lime, yellow`.
- Plus legacy ramps the product still leans on: `--color__gro1..8` (brand
  yellow), `--color__grc1..10` (neutral ink â†’ paper), `--color__grg1..8` (brand
  green), `--color__grr1..8` (danger red).
- Plus `base/grey/black/white` swatches.

The colours that actually paint the screen:

| Role | Value | Where |
| --- | --- | --- |
| Brand green | `#0C831F` | the cart bar, nothing else |
| Secondary green | `#318616` | the ADD button border and label |
| And its tint | `#F7FFF9` | the ADD button fill â€” *2 % green, not white* |
| Brand yellow | `#F8CB46` | offers, badges |
| Ink | `#1F1F1F` | product names, section headings |
| Body grey | `#666666` | default body text |
| Quiet grey | `#828282` | the struck-through MRP |
| App base | `#F5F8FA` | the page behind cards |
| Theme colour | `#1C2224` | the OS status bar (`<meta name="theme-color">`) |

`[MEASURED]` Â· `[INFERENCE]` The discipline worth stealing is not the green. It
is that **there is exactly one saturated colour per job**, and the surface under
it is white or `#F5F8FA` â€” near-neutral. The card is white, the ink is 16:1
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
| Marketing heading ("Free delivery") | 32 / 800 / 36.8, **tracking âˆ’2 px** | `#1F1F1F` |
| Product name | 13 / 600 / 14.95 | `#1F1F1F` |
| Pack size ("1 ltr") | 12 / 500 / 13.8 | `#4F4F4F` |
| Price | 13 / 600 / 14.95 | `#1F1F1F` |
| MRP, struck | 12 / 500 / 13.8 | `#828282` |
| "see all" | 12 / 500 | `#318616` |
| Body default | 12 / 400 / 13.8 | `#666666` |

Two things there are not accidents `[INFERENCE]`: line height is **1.15Ã—** the
font size at every level (13 â†’ 14.95, 17 â†’ 19.55, 32 â†’ 36.8), which packs text
tight and makes a grid of 40 buttons feel dense rather than airy; and the 32 px
headline is tracked **âˆ’2 px**, i.e. 6 % of the font size is removed, which is
what stops large type looking loose and amateurish.

### 1.3 The product card, to the pixel

`[MEASURED]` 2-column grid, page gutter **12 px**, card width **138.56 px**:

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  image                      â”‚  ~139 px tall, explicit width+height attrs
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚ Real Fruit Power Masala     â”‚  13/600, lh 14.95, clamp-2 â†’ 30 px block
â”‚ Mixed Fruit Juice           â”‚
â”‚ 1 ltr                       â”‚  12/500, lh 13.8,  #4F4F4F
â”‚                             â”‚
â”‚ â‚¹76        â‚¹150             â”‚  price 13/600 Â· MRP 12/500 #828282 struck
â”‚                     â”Œâ”€â”€â”€â”€â”€â” â”‚
â”‚                     â”‚ ADD â”‚ â”‚  66 Ã— 32, radius 6, 1 px #318616,
â”‚                     â””â”€â”€â”€â”€â”€â”˜ â”‚  fill #F7FFF9, label #318616 13/600
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

Plus, on cards where it applies: a `49% OFF` badge and an `8 MINS` badge above
the name. **42 ADD buttons** were rendered within the first four screens â€” that
is the density target.

Three details `[INFERENCE]`:

- The ADD button is **outlined, not filled**. The only filled green on the page
  is the cart bar. So "green fill" means "money moving" and "green outline"
  means "consider this".
- The button fill is `#F7FFF9`, not white â€” a 2 % green wash that reads as
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
- **Zero `<h1>`â€“`<h4>` elements on the whole page.** Every heading is a `div`.
  `[INFERENCE]` Great for layout control, bad for screen readers and SEO â€” a
  trade-off we should not copy.

### 1.5 Motion and images

- `139` elements carry an animation or a non-trivial transition `[MEASURED]`.
- `add_to_cart_animation_config: { enabled: false, max_counter: 3 }` `[MEASURED]`
  â€” the fly-to-cart animation is **capped at 3 per session**. They measured that
  the flourish is delightful three times and irritating the fourth, and they
  shipped the cap as server config.
- Images: **47/47 have explicit width and height attributes**; 0 lazy, 0
  `srcset`, 0 `fetchpriority` on this page `[MEASURED]`. The CDN path itself
  encodes the size: `cdn.grofers.com/app/images/collections/asset_V7_312x360_â€¦`
  and `?disable_resizing=true` to opt out. `[INFERENCE]` They render few enough
  images that eager loading wins, and they push resizing to the CDN path rather
  than to query params.

---

## 2. Zepto, measured

Zepto is the more instructive of the two, because Zepto publishes its design
system *as tokens* â€” the whole type scale is `--heading1-font-size` â€¦
`--banner2-letter-spacing`, `214` custom properties `[MEASURED]`.

### 2.1 The complete type scale, verbatim

`[MEASURED]` Every step has size, weight, line height **and letter-spacing**.
Note that tracking is set at *every* level, including the small ones.

| Token | Size | Weight | Line | Tracking |
| --- | --- | --- | --- | --- |
| heading1 | 30 | 700 | 38 | âˆ’0.5 |
| heading2 | 24 | 700 | 30 | âˆ’0.5 |
| heading3 | 20 | 700 | 24 | âˆ’0.5 |
| heading4 | 18 | 600 | 20 | âˆ’0.3 |
| heading5 | 16 | 600 | 20 | âˆ’0.2 |
| heading6 | 14 | 600 | 18 | 0 |
| heading7 | 13 | 600 | 15 | âˆ’0.2 |
| heading8 | 12 | 600 | 14 | âˆ’0.2 |
| heading9 | 11 | 600 | 14 | âˆ’0.2 |
| body1 | 16 | 450 | 20 | 0 |
| body2 | 14 | 450 | 18 | 0 |
| body3 | 13 | 450 | 15 | 0 |
| body4 | 12 | 450 | 16 | 0 |
| body5 | 11 | 450 | 15 | +0.1 |
| body6 | 10 | 450 | 12 | âˆ’0.1 |
| strikethrough1â€“3 | 16 / 14 / 12 | 450 | 20 / 18 / 16 | 0 |
| cta1 | 16 | 700 | 20 | 0 |
| cta2 | 14 | 700 | 18 | 0 |
| cta3 | 12 | 700 | 16 | +0.1 |
| ctaNumber | 13 | 700 | 17 | +0.1 |
| overline1 | 10 | 600 | 13 | +0.2 |
| overline2 | 9 | 700 | 14 | +0.2 |
| banner1 | 20 | 800 | 24 | âˆ’0.2 |
| banner2 | 10 | 800 | 14 | **+0.7** |

Weights are `450 normal Â· 500 medium Â· 600 demibold Â· 700 bold Â· 800
extrabold` `[MEASURED]`. **450, not 400** â€” the regular weight is a hair heavier
so 10â€“12 px text stays legible on a phone at arm's length. `[INFERENCE]` That
single decision is worth more legibility than most contrast work, and it is a
number you can type into `fontWeight` as a string in React Native.

The sign of the tracking follows the job: negative on anything large, **positive
on anything small and uppercase** (`banner2` +0.7, `overline` +0.2, `cta3`
+0.1). That is the whole difference between "designed" and "default".

Other measured foundations:

- Shadows: `sm 0 0 8px rgb(40 44 63/.2)`, `md 0 2px 4px rgba(0,0,0,.08)`,
  base `0 2px 11.43px rgb(0 0 0/.08)`, `lg 0 2px 10px rgb(0 0 0/.12)`.
- `--safe-area-max-inset-bottom: env(safe-area-max-inset-bottom, 36px)` â€” the
  bottom bar clears iOS's home indicator by a real measurement.
- Radii actually used, by frequency: **10 px Ã—49, 8 Ã—34, 4 Ã—26**, 12 Ã—13, 6 Ã—12,
  pill Ã—8, 20 Ã—8, 16 Ã—8.
- Font sizes actually used: **14 Ã—73, 12 Ã—66, 10 Ã—55, 16 Ã—47, 18 Ã—28**, 20 Ã—18,
  8 Ã—17, 24 Ã—11, 32 Ã—11, 28 Ã—10, 40 Ã—5.
  `[INFERENCE]` The centre of gravity is **12â€“14 px**. Zepto is a dense app.
- Typeface: **`Zepto Norms`** (custom), with `Roca` and `Fraunces` (a serif)
  declared for campaign/display use `[MEASURED]`.

### 2.2 The palette

`[MEASURED]` stored as RGB triples, used through `rgb(var(--â€¦))` so opacity can
be modulated without a new token:

| Token | Value | Role |
| --- | --- | --- |
| `color-primary` | `239,67,114` (`#EF4372`) | the pink â€” CTAs, ADD, price accents |
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

`<meta name="theme-color">` is **`#DEC1FF`** â€” the OS status bar is tinted
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
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â” â”‚  image 121Ã—121, radius 8,
â”‚ â”‚                       â”‚ â”‚  border 1px #DFE4EC
â”‚ â”‚              â”Œâ”€â”€â”€â”€â”€â”€â” â”‚ â”‚
â”‚ â”‚              â”‚ ADD  â”‚ â”‚ â”‚  72 Ã— 32, radius 8, white fill,
â”‚ â”‚              â””â”€â”€â”€â”€â”€â”€â”˜ â”‚ â”‚  pink label 12/600, tracking +0.2,
â”‚ â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜ â”‚  border 1px pink, and
â”‚ Apple                     â”‚  box-shadow: pink 1px 1px 0 0
â”‚ iPhone 17 Pro 5G 512 GB   â”‚  â† the "sticker" offset
â”‚ â¬¡ 512 GB                  â”‚  10/600 chip, radius 4,
â”‚ â‚¹1,45,699  â‚¹1,54,900      â”‚  bg rgba(11,12,14,.04), #586274
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜  price 14/700 + â‚¹ at 12/600
                               MRP 12/**450** #8B96A7, struck
```

Details worth naming `[INFERENCE]`:

1. **The ADD button is absolutely positioned, overlapping the image's
   bottom-right corner.** It is not in the layout flow. That buys ~32 px of
   vertical space per card and puts the tap target under the thumb.
2. **`box-shadow: 1px 1px 0 0` pink** â€” a hard, un-blurred offset, not a soft
   elevation. It reads as a printed sticker. It costs one shadow with no blur
   radius, so it is nearly free to paint, and it is the single most
   recognisable detail on the card.
3. **The rupee sign is set smaller than the number** (12 vs 14). Every price
   looks professionally set because of it, and no design tool does that for you.
4. **The image has a `1px #DFE4EC` border**, not a shadow. Product photos are
   mostly white; without a hairline they bleed into the card.
5. The MRP weight is **450**, lighter than the price's 700 â€” the discount
   hierarchy is carried by weight, not only by the strike.

### 2.5 The home screen is assembled from typed widgets

`[MEASURED]` `GET /lms/api/v2/get_page?page_type=HOME&version=v2&page_size=â€¦`
returns a `pageLayout.widgets[]`, each with `widgetType`, `widgetHeader`,
`widgetFooter`, `viewMeta{numberOfColumns, padding}`, `experiments`, `order`,
`campaignName`, `deeplink`, `action`.

The 15 widgets on one home page: `HORIZONTAL_LIST`, `BANNER_GRID_V2`,
`BANNER_CAROUSEL_WITHOUT_TITLE`, `SPACER` (with `spacerHeight: 16`),
`CATEGORY_GRID_V2` Ã—6, `BANNER_GRID` (`SHOP_BY_STORE`),
`GROUPED_HORIZONTAL_CAROUSEL_V1`, `VERTICAL_LIST`.

`[INFERENCE]` That is the difference between "our home screen is a `ScrollView`
with six sections in code" and "our home screen is a list of data". Changing the
order of sections, adding a Diwali strip, or A/B testing a rail is a database
row for Zepto and a release for us. **We should not build this** â€” see Â§7 â€” but
we should build the *one* thing it buys cheaply: a section order and section
visibility that the owner can change without a build.

Also in `pageLayout` `[MEASURED]`: `isScheduleDeliveryEnabled`,
`isListsEnabled`, `isYfpEnabled`, `isZeptoThreeEnabled`, `smartBasketAvailable`,
`isE2EAdsEnabled`, `isEmiEnabled`, `pageReloadTime: 900000` (**15 minutes** â€”
the server tells the client how long the home page is good for), and a
server-driven `bottomNav` with **separate active and inactive SVG icons** per
tab, plus a `pageMeta.floatingAction` cart button that can show a
`bachatItemCount` (rupees saved).

### 2.6 Zepto's product schema

`[MEASURED]` One product item from a `VERTICAL_LIST`, as the API returns it:

```json
{
  "id": "...",                      // variant id
  "baseProductId": "...",           // product id  â† product vs variant, two levels
  "sellingPrice": 112100, "mrp": 279900,
  "discountAmount": 167800, "discountPercent": 59,
  "pricePerUom": 5605,              // â‚¹ per litre/kg â† comparison price
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
| `pricePerUom` | â‚¹/litre. **The only honest way to compare a 900 ml bottle against a 1 L bottle**, and legally expected for some prepacked goods. |
| `baseProductId` + `id` | Product vs variant, so "also in 1 kg" is a query, not a second row. We have `product_pack_options` â€” the same idea, narrower. |
| `availableQuantity` | Stock shown to the customer ("only 3 left"), which doubles as the per-SKU order cap. |
| `pricingData.SUPER_SAVER` | Multiple prices per product per customer segment. |
| `primaryCategory / Subcategory / l3CategoryDetails` | **Three levels.** We have one. |
| `l4Attributes.returnable` + `replacementReturnWindowTime` | Return policy per product, not per shop. |
| `countryOfOrigin`, `ingredients`, `manufacturerName/Address`, `minimumRequiredAge` | Printed on the pack anyway; the app has to be able to show it. |
| `productCardTags` with `position: P0/P2` | Which badge goes in which slot on the card, chosen server-side. |

---

## 3. The ETA model â€” the most useful thing in this whole teardown

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
      â€¦
    }, "35940": { "instant": { "eta": 10 } } } } } }
```

Read that carefully. **The delivery promise is not one number.** It is a function
of `(store, order shape)`:

- Normal grocery: **8 min**.
- A **large order**: **12 min** â€” the same rider, more bags.
- **Cash on delivery**: **10 min**, *slower than prepaid* â€” because cash has to
  be reconciled at the door.
- A prescription-only medicine: **30 min** â€” because a pharmacist has to look at
  it.
- Different store (`49971`): 30 min for the same medicine.

And the same payload carries `asset_map`, which is **design tokens chosen by the
server**: `{ "text_data": { "color": {"type":"cider","tint":"700"},
"font":{"size":"050","weight":"bold"} }, "bg_color_data":
{"type":"cider","tint":"100"}, "image_data": {"url":
"â€¦/eta-icons/30-mins.png"} }` â€” a badge whose colour, tint, font size and weight
and icon all come from the API, addressed by the same token names as the CSS
ramps in Â§1.1.

`[INFERENCE]` **This is the single claim in this file I would act on first.**
Our app renders `zone.eta_minutes` â€” one number per delivery zone
`[CODE]` `apps/mobile/src/app/(tabs)/index.tsx`. That is the same promise for a
â‚¹120 order and a â‚¹4 000 one, for prepaid and for cash, at 09:00 and at 20:55.
Blinkit's own numbers say a large order is **50 % slower**. Publishing one
number and missing it half the time is worse than publishing a range and meeting
it. It is also cheap for us: a `eta_minutes` function of `(zone, total, payment
method, item count)` in Postgres is a single migration and a test, and it needs
no new screen.

---

## 4. What their own feature flags admit they have

`[MEASURED]` `GET /api/feature-flags/receive` returned 38 flags. They are a
feature inventory written by the companies themselves â€” better evidence than any
screenshot, because a flag exists only if someone shipped a path behind it.

**Blinkit** (verbatim flag names, grouped):

| Group | Flags |
| --- | --- |
| Search | `is-type-to-search-mweb-enabled` (typeahead), `is-web-search-bff-enabled`, `is-web-location-auto-suggest-enabled` (address autocomplete) |
| Catalogue | `is-web-plp-bff-enabled`, `is-web-pdp-bff-enabled`, `is-web-mobile-pdp-v2-enabled`, `is-web-desktop-bff-*` |
| Cart & money | `is-web-cart-coupon-enabled` (**false** at capture), `is-web-zpay-enabled`, `is-web-zpay-v2-enabled`, `is-web-new-cart-address`, `is-web-cart-share-enabled`, `show-bill-and-tip-v2-on-web`, `is-web-dp-tip-enabled` |
| Orders | `is-web-bff-order-history-enabled`, `is-web-v1-order-count-enabled` |
| Tracking | `is-web-bff-crystal-track-order-enabled`, `is_web_crystal_track_v2_enabled` â€” their tracking system is named **Crystal** |
| Support | `is-web-onesupport-enabled`, `is-web-agent-tools-enabled` |
| Other verticals | `is-web-pharma-checkouts-enabled`, `is-web-print-enabled`, `is-web-gyftr-enabled` (gifting), `is-web-blinkit-link-enabled`, `dc-web-enabled` (dark store) |
| Platform | `is_consumer_web_bff_enabled`, `is-web-jumbo-client-enabled`, `is-web-paas-async-validation-enabled`, `is-web-paas-revamp-enabled` |

**Blinkit's `secondary-data` response** `[MEASURED]` is a table of contents for
features we cannot see without logging in:

| Key | What it means for us |
| --- | --- |
| `sbc_free_delivery_details: { free_delivery_count, minimum_order_value, order_limit: 30 }` | "SBC" is their membership; it sells **30 free deliveries**. Confirms the model `FEATURE-PARITY.md` Â§4 refuses â€” and shows what the refusal costs: a 30-order hook. |
| `app_refresh_data.background_to_foreground_refresh: { distance_in_meters: 300, duration_in_seconds: 420 }` | **Refresh on resume if you moved 300 m or 7 minutes passed.** A precise, copyable rule for our stale-data problem. |
| `add_to_cart_animation_config: { enabled, max_counter: 3 }` | Cap the flourish at 3. |
| `prefetch_media[5]` kinds: `image, video, lottie, web_resource, audio` | They preload five media types at boot. We should preload exactly one thing (the catalogue) â€” see Â§6. |
| `loading_overlay_config` â€” a Lottie loader with a `recurrence_expr: "DTSTART;TZID=Asia/Kolkata:â€¦"` | The cold-start loader is a **scheduled marketing slot**, timezone-aware. |
| `search_bar_ui_config_map` â€” hint text, icon codepoint, mic visibility, `margin: "4,12,4,12"`, `bg_color {type:"accent",tint:"900"}` | Even the search bar is server-driven. |
| `profile_image_banner` â†’ `birthday_input_bottom_sheet` | They capture birthdays for the one message people actually like. |
| `sbc_auto_renewal_data` with `"Membership will auto renew at â‚¹%s after %s"` | Renewal copy, parameterised. |
| `trending_searches_list`, `live_activity_ads`, `splash_ads` | Advertising slots. |
| `analytics_properties.services` = `express, longtail, unicorn, super_longtail, instant` + **emergency ambulance numbers** | One app, five service tiers, and a public-service page. |

`[INFERENCE]` The two rows I would act on: **the 300 m / 420 s resume rule** (Â§6)
and the **membership counter**, only to note that a 30-order discount hook is
what we are declining.

---

## 5. Side by side with ours

All three columns are measured or `[CODE]`, not estimated.

| | **Blinkit** | **Zepto** | **Ours** `[CODE]` |
| --- | --- | --- | --- |
| Typeface | Okra (custom, 5 loaded weights) | Zepto Norms (custom, 450â†’800) | Latin: **system sans** (Roboto / SF â€” differs per platform); Kannada: **bundled Noto Sans Kannada Ã—4 weights** `[CODE]` `constants/fonts.ts` |
| Type scale | sizes only, weight+LH inline | 24 named steps, each with **tracking** | 10 steps, **no tracking token** (5 one-off `letterSpacing` values exist, all for codes: `login.tsx:350`, `checkout.tsx:595`, `admin/coupons.tsx:567`, `index.tsx:717`, `demo-accounts.tsx:136`) |
| Smallest text | 12 px | 9â€“10 px (overline/banner) | **12.5 px floor** (`Type.caption`) â€” deliberate |
| Body line height | 1.15Ã— | 1.25â€“1.4Ã— | **1.5Ã—** (`body` 16/24) â€” deliberate, for Kannada |
| Card name | 13/600/14.95, clamp-2 â†’ 30 px | 12/500/14, clamp-2 â†’ 28 px | **16/600/24, clamp-2 â†’ 48 px** |
| Card pack line | 12/13.8 â†’ 14 px | 12/16 â†’ 16 px | **14/22 â†’ 22 px** |
| Card price | 13/600 | 14/700 (+small â‚¹) | **17/800** |
| Text block, 2-line name | **â‰ˆ59 px** | â‰ˆ62 px | **â‰ˆ94 px** |
| Page gutter | 12 px | 16 px | 16 px (`Spacing.three`) |
| Card radius | 6 (button) | 10 (card), 8 (image + button) | `Radii.lg` 20 / `md` 14 |
| Radii set | â€” | 4/8/10/12 | **10/14/20/28/pill** |
| Spacing scale | â€” | 4/8/12/16â€¦ | **2/4/8/16/24/32/64 â€” no 12** |
| Brand accent | `#0C831F` / `#318616` | `#EF4372` / `#950EDB` | `#0F7B3E` (nearly Blinkit's green) |
| Page surface | white + `#F5F8FA` | `#F5F1F7` + lavender band | **`#FFFBF3` cream + `accentSoft` washes** |
| Ink | `#1F1F1F` | `#130022` | `#221B12` |
| Status bar | `#1C2224` | **`#DEC1FF`** | not set |
| Dark mode | web: none | web: none | **full second palette** (System/Light/Dark, persisted) |
| Section headings | 17/800/19.55 | 18/700/22 (âˆ’0.2) | `heading` 19/700/28 |
| Custom shadow | none | 4-step scale | `Elevation` presets |
| Motion | 139 animated elements, cart animation capped at 3 | 129 animated | **none by decision** (`SCALE-AND-TRACKING.md` T0: static skeletons) |
| Image sizing | explicit w/h, 0 lazy | explicit w/h, **lazy + `fetchpriority`**, CDN transform `w-144,q-40,f-auto,pr-true` | `expo-image`, `contentFit="cover"`, `transition={150}` |
| Product data | name, pack, price, MRP, disc %, ETA badge | + brand, â‚¹/kg, stock left, return policy, origin, ingredients, 3-level category | name_en/kn, price, MRP, unit, stock, pack structure |

---

## 6. Why people love their theme, and do not love ours

Seven mechanisms, in order of how much they matter. This is the honest answer,
and it is not "they have nicer colours".

**1. A commissioned typeface, and tracking that follows the size.**
We ship **two** families and never designed them as a pair `[CODE]`: Latin is
`system-ui` â€” Roboto on Android, SF on iOS â€” so English looks like a different
app per platform; Kannada is **Noto Sans Kannada**, four weights, bundled
(`apps/mobile/src/constants/fonts.ts`, `assets/fonts/*.ttf`, OFL) precisely so it
stops changing between phones. That was the right call and it is more than
Zepto does. But the *relationship* is unmanaged: a bilingual line set in Noto
Sans Kannada next to Latin text is two faces with two x-heights, two stroke
weights and two sets of sidebearings on one baseline. Blinkit and Zepto own both
halves of the problem because they own the face. `[INFERENCE]` The cheapest fix
that preserves the Kannada decision is **one variable family with real Latin and
real Kannada** (the bundled Noto Sans family already ships both cuts, so the
licence may already cover it â€” worth checking before buying anything); the
expensive version is a commissioned Kannada face. Either way it is a licence
question and a `fonts.ts` change, not a redesign.

**2. There is one loud colour, and it is the thing you press.**
Blinkit's entire page is white, `#1F1F1F` ink, and green on exactly two things:
the ADD outline and the cart bar. Ours tints the background cream, tints selected
chips `accentSoft`, tints banners `accentSoft`, and then uses `accent` for the
button â€” so the button is the same colour as the furniture. `[INFERENCE]` The
fix is a rule, not a palette change: **`accentSoft` may never sit adjacent to an
`accent` fill**, and green fills are reserved for money-moving actions.

**3. Density, honestly measured.** Our card's text block is **94 px** against
their **59â€“62 px** â€” 1.6Ã—. On a 412 Ã— 915 screen that is roughly 3 rows of
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
nothing can ever look crisp â€” every corner is soft. Their spacing scale includes
12; ours jumps 8 â†’ 16, which is why our cards cannot be tightened without a
magic number. `[INFERENCE]` These are the differences a user cannot name and can
always feel.

**6. Depth is drawn, not blurred.** Zepto's ADD button uses `1px 1px 0` with no
blur â€” a sticker. Blinkit uses a 1 px border and a 2 % tint. Both avoid the soft
drop shadow that makes a card look like a 2014 Material demo. Our `Elevation`
presets are blurred shadows.

**7. The promise is a badge, not a paragraph.** "8 MINS" sits **on the product
card**, in a badge, next to the discount. Speed is repeated at the moment of
choosing, not announced once at the top. Ours says it once in the hero
`[CODE]` `home.promise` and never again.

**And two things we do better, which should be defended** `[CODE]`:
**dark mode** (neither web app has one) and a **12.5 px legibility floor with 1.5Ã—
line height** (Zepto ships 9â€“10 px overlines). Neither is a gap. They are the
reason a 55-year-old in Kunigal can use this app at all.

---

## 7. The gap list, and what I would do about each

Ordered by what it costs a customer today. **A** = do it, **B** = do it after
launch, **C** = refuse with a reason.

### A â€” worth doing before launch

**Status 2026-11-03:** A1 âœ— Â· A2 âœ“ (built) Â· A3 âœ“ (card + product page) Â·
A4 âœ— Â· A5 âœ“ Â· A6 âœ“ Â· A7 âœ“ Â· A8 âœ“ Â· A9 â— (`net_quantity` + `packer_name` only) Â·
A10 âœ—. `HANDOFF.md` Â§6.4 has the evidence and Â§6.5 the plan for what is left.

| # | Gap | Evidence | Where it lands |
| --- | --- | --- | --- |
| A1 | **ETA is one number per zone.** Theirs is a function of store Ã— order shape: large order +50 %, COD +2 min, prescription +22 min. We are COD-only today, so the payment dimension is future-proofing; the size dimension is real now. | `[MEASURED]` Â§3 | migration + `shop_day_totals`-style RPC; home hero, checkout, order screen |
| A2 | **No per-unit price (â‚¹/kg, â‚¹/L).** The one honest way to compare two packs on the same shelf. | `[MEASURED]` Â§2.6 `pricePerUom` | **Built 2026-11-03:** `src/lib/unit-price.ts` (integer paise, no formatter), shown on the product page and each pack chip, covered by `check:unit-price`. It is **not** in `pack.ts`, which `check:packs` forbids from touching money |
| A3 | **Stock is invisible on the shelf card** (the product page has shown it since Phase 2.5). They show `availableQuantity` and "only 3 left". | `[MEASURED]` Â§2.6 | **Built 2026-11-03:** `product-card` shows `product.lowStock` at `0 < stock_qty â‰¤ 5`, same threshold as the product page |
| A4 | **No status-bar / top-of-screen brand.** | `[MEASURED]` Â§2.3, Â§1.1 | `app.json` + root layout. The light/dark `StatusBar` already exists; the missing part is the brand strip |
| A5 | **No tracking on the type scale**, so headings read as default. | `[MEASURED]` Â§2.1 vs `[CODE]` `theme.ts` `Type` | **Built 2026-11-03:** `Type` carries `letterSpacing` (âˆ’0.5 display â†’ +0.2 caption); `themed-text.tsx` forces 0 for Kannada |
| A6 | **`Spacing` has no 12**, so 12 px gutters need magic numbers. Blinkit's page gutter is 12. | `[MEASURED]` Â§1.3 vs `[CODE]` | **Built 2026-11-03:** `Spacing.twoHalf = 12`, used by the Home shelf grid |
| A7 | **Refresh-on-resume rule is ad hoc.** Theirs: 300 m **or** 420 s. | `[MEASURED]` Â§4 | **Built 2026-11-03:** `hooks/use-refresh-on-resume.ts` bridges `AppState` to React Query's `focusManager`; stale queries refetch on return, fresh ones do not |
| A8 | **No `fetchpriority` / no lazy strategy per image role.** Zepto: lazy + `fetchpriority=low` + `w-144,q-40`; Blinkit: eager + explicit size. | `[MEASURED]` Â§1.5, Â§2 | **Built 2026-11-03:** `ProductCard` `priority` â€” first 4 grid cards / first 2 rail cards high, the rest normal, all `memory-disk` |
| A9 | **Missing catalogue truth**: brand, country of origin, ingredients, manufacturer, return/replacement window. **Net quantity and packer name already exist** (`20261020000002_shop_identity.sql`). The rest are on the pack and legally expected for prepacked goods. | `[MEASURED]` Â§2.6 | migration + product screen. **Legal Metrology wording is still `[UNVERIFIED]`** (`PRODUCTION.md`) â€” this is the row that touches it |
| A10 | **Two-level taxonomy.** They have L1 â†’ L2 â†’ L3. We have one flat list of 8. | `[MEASURED]` Â§1.5, Â§2.6 | categories gain `parent_id`; matters at ~300 SKUs, not at 34 |

### B â€” after launch

- **B1 Overtaken â€” nothing to do.** The teardown draft listed "per-SKU order cap"
  as a gap. It is not: `place_order()` already rejects `quantity > stock_qty`
  with the available number (`20261021000003_product_guard.sql:331`) and caps any
  line at **99** (`:242`), which is a stricter version of Blinkit's
  `product_sku_limit` flag. What we still lack is showing it *before* checkout â€”
  A3.
- **B2 Section order/visibility the owner can change without a build.** Not a widget engine (Â§2.5) â€” one `store_settings.home_sections jsonb` column and a `RENDERERS` map.
- **B3 Cart button that shows rupees saved** (`bachatItemCount`) â€” **built
  2026-11-06**, with one deliberate correction to the draft. Theirs counts the
  discount engine's rupee write-off; we have no such engine in the basket, so the
  number is **MRP minus shelf price** on the units in the basket
  (`useCart.mrpSavingsPaise`), shown under the subtotal on the cart screen and as
  a second line in the Home basket bar. It is computed from live `mrp_paise` on
  each product, never from a stored price (rule 9.1), and it is integer paise
  throughout. The coupon `discount_paise` is not folded in: it only exists at
  checkout, and mixing the two would produce a number the customer cannot
  reconcile with any packet in their bag.
- **B4 Search placeholder that cycles** with real shelf items ("à²…à²•à³à²•à²¿", "à²¹à²¾à²²à³") â€” a copy change, and it teaches what search can do to someone who has never used search. **Built 2026-11-06** as `components/home-search.tsx`: one real, in-stock shelf name at a time, in the customer's language, taken from the same rows the shelf is drawn from (so every example finds something), pausing on focus and swapping without a fade. The static `home.searchPlaceholder` is kept as the fallback and the screen-reader label.
- **B5 Birthday capture** (one optional field, one message). Theirs is a bottom sheet, server-driven; ours can be a row in the account screen.
- **B6 Cap the add-to-cart flourish at 3** â€” *if and when* we add one. Recorded so nobody ships an uncapped animation later.
- **B7 Home page TTL** (`pageReloadTime: 900000`). Our `SHELF_STALE_MS` is 5 min `[CODE]`; theirs is 15. Ours is more conservative; leave it.

### C â€” refuse, with reasons (extends `FEATURE-PARITY.md` Â§4)

| Feature | Why not |
| --- | --- |
| **Server-driven UI (LMS widgets)** | Fifteen widget types, an experiments field, and per-widget analytics. It is a platform for a company with a merchandising team shipping six campaigns a day. We have one shop and 34 products. B2 gets 90 % of the value for one column. |
| **Tiered pricing (`SUPER_SAVER` / `ULTRA_SAVER`)** | Two prices for the same item is a discount engine. `FEATURE-PARITY.md` Â§4 already refuses membership; this is membership's plumbing. |
| **Their density (12â€“13 px names)** | Directly contradicts `KUNIGAL.md`. See Â§6.3 â€” keep the sizes, take the space back structurally. |
| **`user-scalable=0`** | Measured in their viewport meta `[MEASURED]` Â§1.1 note. It disables pinch-zoom. For an app whose users include people with weak eyesight, that is an accessibility defect, not a technique. |
| **Zero semantic headings** | Blinkit renders **no `<h1>`â€“`<h4>`** `[MEASURED]`. On React Native that maps to `accessibilityRole="header"`; we should keep ours. |
| **One app, five service tiers** (express / longtail / unicorn / instant / pharmacy) | Their store map, not ours. |
| **Retail media slots** (`live_activity_ads`, `splash_ads`, `isE2EAdsEnabled`) | Advertising inventory needs advertisers. |
| **Buying a commissioned typeface now** | The Latin/Kannada mismatch in Â§6.1 is real, but a purchase is not the first move: the Noto Sans superfamily already covers both scripts under the OFL we accepted for Kannada `[CODE]` `assets/fonts/OFL.txt`. Try the free unification first and only commission a face if it still looks wrong. |

---

## 8. Decisions this file needs

1. **Typeface â€” do we unify Latin and Kannada?** One family with real cuts of
   both, so a bilingual line shares one x-height. Before spending anything:
   the Noto Sans superfamily ships both cuts under OFL, so the licence we
   already accepted for Kannada may cover the Latin half too â€” that is a
   five-minute check, not a purchase. A commissioned face is the expensive
   version of the same decision. This is the only item in Â§6 that cannot be
   done by a developer alone.
2. **Density â€” do we tighten the card?** My recommendation: keep 16 px
   name / 12.5 px floor, and recover space with a 12 px gutter + an
   overlaid discount badge + the ADD anchored to the price row. That buys a
   third row of products without shrinking a single glyph. Any further and we
   contradict `KUNIGAL.md`.
3. **ETA â€” is the owner willing to publish `(zone, order size, payment method)`**
   instead of one number per zone? It is more honest and it is a Postgres
   function, but it means telling a customer "20â€“25 min" for a big prepaid
   order on a Sunday.
4. **A9 â€” who supplies the pack facts?** Brand, net quantity, manufacturer,
   country of origin, ingredients. Either the owner types them per product (34
   products, an evening's work) or they stay empty. Empty is a legal exposure
   for prepacked goods `[UNVERIFIED]` â€” needs the CA, not me.
5. **A4 â€” is a marigold hairline + a tinted status bar acceptable branding**,
   or does the owner want the shop's own colour? It is the cheapest brand
   change available and it needs one opinion, not a design project.

---

## 9. How to re-run this

Everything below ran on this machine on 2026-10-26 and is reproducible.

```bash
mkdir -p /tmp/opencode/teardown && cd /tmp/opencode/teardown
# cdp.js      â€“ 60-line Chrome DevTools Protocol client, Node 22 global WebSocket, no deps
# probe.js    â€“ computed design tokens, headings, CTAs, images, network, at 412Ã—915 DPR3
# anatomy.js  â€“ one component subtree with computed styles + fixed/sticky chrome
# harvest.js  â€“ JSON response bodies from the page's own session
# pagefetch.jsâ€“ same-origin fetch() for unauthenticated endpoints
node probe.js    zepto   https://www.zeptonow.com/
node probe.js    blinkit https://blinkit.com/
node anatomy.js  blinkit https://blinkit.com/ ADD
node anatomy.js  zepto   https://www.zeptonow.com/ ADD
node harvest.js  blinkit-api https://blinkit.com/ 'blinkit\.com/(v1|v2|api)'
node harvest.js  zepto-api   https://www.zeptonow.com/ 'bff-gateway\.zepto\.com'
node css-tokens.js        # colour/type/radius/shadow frequency + every CSS custom property
```

`Rea` note: the `reverse-engineer-anything` skill was installed at
`~/.config/opencode/skills/reverse-engineer-anything/` on 2026-10-26, when its
MCP server could not be run (Node 22.22.0 < 22.23.4, and no `opencode` MCP
registration existed). **That changed on 2026-11-06:** Node is now 24.22.1 and
`rea setup --client opencode` registered the `rea` server in
`~/.config/opencode/opencode.jsonc` (`rea doctor --client opencode` reports the
registration *aligned*). Â§10 was captured with it. See
`FEATURE-PARITY.md` Â§0 for why no binary was opened.

**Next capture, when someone can log in:** cart, checkout, live-tracking and
order-history screens; the ADD â†’ stepper transition (measure the tap target and
the state change); and one Zepto `get_page` during a festival, to see
`festivalUITheme` in effect. None of these are reachable without a phone number
and I did not attempt to obtain one.

---

## 10. Flipkart web, measured 2026-11-06 (REA)

The cart/checkout screens listed as `[UNKNOWN]` above are behind Blinkit's and
Zepto's phone-OTP wall. Blinkit and Zepto are **still not reachable from this
network** â€” see Â§10.6. Flipkart, by contrast, serves its cart **to a signed-out
guest**, which makes it the one measured cart in this file. Tags keep the
meaning of Â§0.

### 10.1 How this was captured

- `rea capture_browser_scenario` (REA 6.8.0, MCP server `rea`, provider
  `rea-playwright-browser-scenario`), real Chrome 156, **launch mode with a
  provider-owned temporary profile**, 1280 Ã— 720 light `en-US`, **headless**.
  Every capture ended in the same three artifacts: DOM, accessibility tree,
  final URL. Nothing was clicked except the one "Add to cart" in Â§10.3.
- No login, no phone number, no attempt at any protection mechanism, no request
  forged by the tool: the page made its own requests and the browser accepted
  them or refused them.
- Requests were made by the page itself; the tool only drove navigation and one
  click. The DOM and accessibility texts of every capture were exported with
  `rea export_evidence_bundle` to a scratch directory **outside this repo** and
  read from there. The numbers below come from those texts.

### 10.2 The shelf page, measured

`https://www.flipkart.com/search?q=toor+dal+1kg` â€” desktop, grocery
marketplace, signed out.

- 40 results of 1 366, plus a **Filter rail on the left** (category tree,
  price min/max dropdowns, brand search box, ratings buckets, offers,
  availability, packaging, "Country Of Origin", "Type", "flavour", "Organic",
  "Discount") and a **Sort bar** over the grid (Relevance Â· Popularity Â· Price
  lowâ†’high Â· highâ†’low Â· Newest first). Ours has category chips only.
- The card anatomy, verbatim from the accessibility tree, in this order:
  image â†’ **name â†’ pack line ("1 kg") â†’ rating + count ("4.3 (39)") â†’
  â‚¹price â‚¹MRP 27% off â†’ trust line ("Only few left")**. There is **no ADD
  button on this page at all** â€” a marketplace card is browsed, not added.
- One card said "Top Discount of the Sale" â€” a merchandising line we have no
  concept of and should not want.
- Type: 20 px product names, 14 px everything else, black on white, no card
  chrome, no colour.

**Against ours** (`[CODE]` `product-card.tsx`): our card carries a name, pack,
price, MRP, discount, low-stock badge, the ADD button and â€” since A5/A6 â€” a
â‚¹/kg line. The measured gap is **rating + rating count on the card**; Flipkart
has it and it is the cheapest trust signal there is. For a one-shop grocery
this is optional, but it is the only item in Â§10 that could be lifted without
new data: `order_feedback` (migration `20261106000001`) already stores
`was_ok` plus six reasons, and an aggregate of it is what would render. See
**A11**.

### 10.3 The product page, measured

`https://www.flipkart.com/value-toor-arhar-dal/p/itm307c2f0742516?pid=PLSFUUSEYMC3K8UR`

Anatomically, top to bottom:

1. Marketplace dropdown, search, Login, Cart.
2. Breadcrumbs: Home / Food Products / Pulses / Dal / Unbranded Dal.
3. Image carousel with **"Key Highlights"** overlay cards and one hard fact
   printed over the images: **"Expiry 19 Dec 2026"**.
4. **Pack variants as links, with the unit price written into the chip**:
   `500 g` and `1 kg (â‚¹200/1kg)`, plus "Selected Quantity: 1 kg". This is A5,
   done the Flipkart way â€” the â‚¹/kg lives on the variant chip rather than under
   the price. Ours does both; theirs is denser.
5. H1 `Value Toor/Arhar Dal (1 kg)` â€” **the pack is part of the title**, not a
   separate line.
6. `4.2 | 20,608` as a link to its own ratings page.
7. Price `â‚¹200`, then "Buy at â‚¹190 â€” Apply offers for maximum savings",
   "Delivery details", "Location not set", **"Delivery by Monday, 9 Nov"** (a
   date, not a minutes estimate), seller name with `4.5 Â· 4 years with
   Flipkart`, "See other sellers", "Cancellation upto 24hrs", "No returns".
8. A reviews block: five-star rows, review photos with `+29`, "Verified Buyer"
   under each name, helpful counts, **"Show all reviews"**.
9. **Questions and Answers** with real Q&A pairs ("How is the quality of the
   product") and "Show all questions & answers".
10. `Add to cart` and `Buy now`, both **44 px tall** â€” the same tap target
    `AGENTS.md` Â§9.9 demands.
11. "Similar Products" rail, whose cards carry the pack inside the name
    ("Tata Sampann Unpolished Kabuli Chana 1 kg 1% OFF â‚¹226 â‚¹223").

**Against ours** (`[CODE]` `product/[id].tsx`): we have 1, 2 (as pack chips), 3,
the price block and the pack-option chips. We do **not** have expiry on the
image, the seller/return-policy block, reviews, or Q&A. Of those the honest
ones for one shop are: **expiry** (it is a food-safety fact the owner already
knows) and the **return/replacement window** as a single sentence â€” both are
A9 rows. Reviews and Q&A need volume we do not have; A11 is the cheap version.

### 10.4 Add to cart, measured

Clicking "Add to cart" (REA `click` on the 44 px button) **did not navigate**:

- The header's cart link changed from `Cart Cart` to **`Cart 1 Cart`** â€” the
  count is in the accessible name, so a screen reader says "Cart, 1 item, Cart".
- The button itself became **"Go to cart"**. There is no ADD â†’ stepper
  transition on desktop Flipkart, which corrects an assumption in Â§9 of this
  file: for them the stepper lives in the cart, not on the PDP.
- The URL never changed. Everything happened in place, 8 s before the capture.

**Against ours** (`[CODE]` `hooks/use-cart.ts`, `components/product-card.tsx`):
ours already does the ADD â†’ stepper on the card, and the Home basket bar carries
the live count. Nothing to do.

### 10.5 The cart, measured â€” the first cart in this file

`https://www.flipkart.com/viewcart?marketplace=FLIPKART`, guest, one item.
Verbatim text of the live region:

```
Login to Proceed        No location added
Qty: 1   Value Toor/Arhar Dal 1 kg   4.2 â€¢ (20,608)   â‚¹200   Delivery by Mon Nov 9
Save for later    Remove
Buy this now
Price Details
  Price (1 item)        â‚¹200
  Platform Fee          â‚¹10
  Total Amount          â‚¹210
Safe and secure payments. Easy returns. 100% Authentic products.
Place order 210
```

Seven things, in the order they matter:

1. **A "Platform Fee" is its own line** in the price breakdown â€” â‚¹10, charged
   even on a â‚¹200 order, above the total. Our breakdown is subtotal +
   delivery fee âˆ’ discount `[CODE]` `cart/[id].tsx`. If the shop ever charges a
   handling fee, **the model already exists**: add it as an explicit, itemised,
   integer-paise row computed in Postgres, never as a margin folded into the
   item price. See **A12**.
2. **"Save for later" alongside "Remove"** â€” two exits per line. Our cart has
   remove only. "Save for later" is the one that keeps a customer from
   re-finding a product they hesitated over; it is one table and a query.
3. **Delivery by a date, not an ETA** â€” because Flipkart's grocery promise is
   next-day, not ten minutes. Their ETA model is `[MEASURED]` Â§3 of this file
   and ours is the honest one for Kunigal; no change.
4. **The trust row**: "Safe and secure payments. Easy returns. 100% Authentic
   products." Three claims a customer can check, sitting directly above the
   button. Ours says nothing about payment at all, because we take no payments
   (COD only) â€” which makes the row **wrong** for us and a good example of why
   this section is measured evidence, not a to-do list. What we *can* say
   honestly is already on the order screen (shop identity, FSSAI when supplied).
5. **A sticky Place order carrying the total** â€” the amount is on the button.
   Ours is `cart`'s checkout row; the number should be on the label, not only
   beside it.
6. **"Login to Proceed" / "No location added"** as two quiet prompts, not
   gates â€” the cart is usable while signed out.
7. The item line repeats **rating + count + delivery date** inside the cart, so
   the customer does not go back to the PDP to remember what they picked.

**Against ours**, the honest take-aways are **A12 (itemised fee, if and only if
the shop ever charges one)**, **"Save for later"**, and the total on the
checkout button label. Everything else in Â§10.5 is Flipkart's marketplace
reality, not ours.

### 10.6 What is still not measured â€” state it plainly

- **Blinkit, Zepto, BigBasket, JioMart and Swiggy Instamart are all blocked
  from this network.** 2026-11-06, same headless Chrome, same tool:
  `blinkit.com` served a Cloudflare challenge page ("access denied â€¦ you have
  been blocked"), `zeptonow.com` and `www.zepto.com` returned **HTTP 429**,
  `www.bigbasket.com` and `www.jiomart.com` returned **Akamai "Access
  Denied"**, `swiggy.com/instamart` returned "We'll be back shortly". No
  protection mechanism was interfered with; the requests were simply refused.
  Â§1â€“Â§3 remain the only measured Blinkit/Zepto evidence and it is from
  2026-10-26.
- **No checkout, payment or order-tracking screen was reached on any site.**
  Flipkart's cart ends at "Login to Proceed" and I did not log in.
- **One headless desktop session, 1280 Ã— 720, one moment, one city (no location
  set).** Flipkart's own payload shows a mobile UA attempt (`FKUA/msite/â€¦/
  Mobile`) while the page served the desktop layout; the measured card
  therefore is the desktop card, and its spacing is not a phone's spacing.
- **No screenshot was interpreted** â€” no vision on this model. A screenshot was
  captured (Playwright PNG) and is available to a human; every claim here is
  DOM or accessibility-text evidence.
- Screenshots are only captured on request and are withheld entirely when any
  secret value is in play; none were needed.

### 10.7 What this adds to Â§7

**A11 â€” rating on the shelf card (optional, cheap).** Flipkart carries rating +
count on every card `[MEASURED]` Â§10.2. We can only compute one from
`order_feedback` (migration `20261106000001`), so it is a derived column plus a
cart-join, not a copy of theirs. For 34 products a sparse rating is worse than
none: **start with the aggregate on the product page only**, never invent a
number, and never show "0". Needs a decision before build.

**A12 â€” an itemised fee line in the price breakdown (only if the shop charges
one).** Flipkart's "Platform Fee â‚¹10" `[MEASURED]` Â§10.5 exists because they
charge one. **We do not, and must not start by hiding a margin in prices.** If
and when the owner charges a handling/packing fee, the shape is fixed now:
`*_paise` integer column, stored on the order by `place_order()`, its own row in
the breakdown, and a check that it cannot be sent by the client.

**A13 â€” "Save for later" in the cart.** Measured on Flipkart's cart line. Two
exits per row is what keeps a hesitant customer from re-searching. One table,
one query, no new money.

**BUILT 2026-11-08** (`src/lib/saved-later.ts`, `src/store/saved-store.ts`,
`check:saved`, the cart's saved section). The one decision that was ours, not
Flipkart's: the shelf lives **on the phone**, not on a server. A customer in a
village with one bar of signal hesitates exactly when the network is worst, and
a shelf that needs a round trip to write to fails exactly then â€” so it sits
next to the cart in AsyncStorage, shares the cart's product query, and carries
the quantity the customer asked for so "put back" restores the shopping rather
than just the product. `check:saved` pins the invariant that makes it safe: an
item can never be in both lists at once, putting a line back tops up the bag
instead of overwriting it, and a full bag leaves the overflow on the shelf
rather than losing it.

**Refuse, with the measurement:** their trust row ("Safe and secure payments.
Easy returnsâ€¦") is not transferable to a COD-only shop with no return window;
copying it would be writing a claim we cannot honour. Ours lives on the order
screen already (migration `20261021000005`).

---

## 11. Blinkit, in depth â€” the real app, measured 2026-11-11 (REA + Wayback)

Â§1â€“Â§3 measured Blinkit's public shell on 2026-10-26, and Â§10.6 recorded that
`blinkit.com` was **blocked from this network**. **That changed on 2026-11-11**:
the block is still there (a Cloudflare Turnstile interstitial, captured below),
but a second route in was found and it is better than the first.

### 11.1 How this was captured, and what it cannot see

**Route 1, the blocked one.** `rea capture-browser_scenario` (REA 6.8.0,
provider `rea-playwright-browser-scenario`, real Chrome 157.0.8103.40, launch
mode, provider-owned temporary profile, headless, 412 Ã— 915) against
`https://blinkit.com/`:

- `GET /` â†’ **307** â†’ **403** â†’ `Just a moment...` with
  `challenges.cloudflare.com/turnstile` and `/cdn-cgi/challenge-platform/...`
  `[MEASURED]`. Nothing was clicked, nothing was forged, no protection mechanism
  was interfered with. The same tool reached Flipkart (Â§10), so this is Blinkit's
  own edge refusing this network, not a tool limit.

**Route 2, the one that worked.** The Internet Archive. `web.archive.org` is
reachable from this machine and holds Blinkit's real deployment `[MEASURED]`:

- `http://archive.org/wayback/available?url=blinkit.com&timestamp=2026` â†’
  `200`, closest snapshot `20261001194933`, status 200.
- The archived page served Blinkit's **real** home HTML â€” title
  `30,000+ products delivered to your doorstep | Blinkit`, the real
  `blinkit.com` asset URLs, and the archive's own playback shim alongside.
- From that HTML, all 13 script sources and 5 stylesheets were read and the
  **8 application chunks + 3 CSS files** were downloaded:
  `home` (20 KB), `layout` (301 KB), `main-` (111 KB), `main` (330 KB),
  `utility` (132 KB) â€” 894 KB of Blinkit's own code, plus 366 KB of CSS.
- `rea analyze-javascript-application` over the 5 Blinkit-owned chunks: **1 139
  modules, 3 863 findings, 240 836 AST nodes, 378 `withConfig` styled-component
  display names**, SHA-256 preserved per source. React/Sentry vendor chunks were
  excluded to stay inside the per-source timeout.
- A second CDX pass over the whole `blinkit.com` domain returned 774 archived JS
  chunks; the newest per screen was pulled for `cart`, `checkout`,
  `checkoutSuccess-`, `ProductsWrapper` (the search/listing screen),
  `OrderTrack`, `WidgetisedLayout`, `print`, `store`, `tab-layout-` and
  `ReferralStore`. That is where the screen anatomy below comes from.

**What this cannot see â€” state it plainly:**

- **Nothing here is live.** Every number is from an archived copy, the newest of
  which is the 2026-10-01 home page and the 2026-07-15 checkout chunk. Blinkit
  ships weekly; a shipped-artifact claim, not a today claim.
- The **CSS and JS are the signed-out shell.** The product feed, cart and
  checkout bodies load from `/v1/layout/*` after a location is chosen, and those
  responses are **not archived**. What is measured is the app's *machinery*
  (its components, tokens, API surface, copy), not its data.
- **No logged-in screen was reached on any site.** No phone number, no account,
  no attempt at any protection mechanism.
- Archive-replay injects a banner and rewrites URLs; the **rules, values,
  component names and API paths are untouched**, and every claim below is read
  from those.
- No screenshot was interpreted (no vision on this model).

### 11.2 The design system, measured verbatim

Blinkit's stylesheet is **Tailwind plus a styled-components token layer**
(`.spicy-tailwind` is on the `<html>`). 309 CSS custom properties.

**The palette is a named scale, not a brand colour.** `[MEASURED]`

| Token | Value | Note |
| --- | --- | --- |
| `--colors-theme-500` | `#318616` | the base green |
| `--colors-base-green` | `#318616` | same green, second name |
| `--colors-base-yellow` | `#F8CB46` | the marigold, `corn-700` |
| `--colors-base-black` | `#1F1F1F` | **not `#000`** |
| `--colors-base-white` | `#ffffff` | |
| `--colors-base-appbase` | `#F5F8FA` | the app background, not white |
| `--colors-green-050â€¦900` | `#F7FFF9 â†’ #0E401D` | 10 steps |
| `--colors-grey-050â€¦900` | `#FCFCFC â†’ #363636` | 10 steps, `#363636` not `#000` |
| `--colors-corn-050â€¦900` | `#FEF4D8 â†’ #936E00` | the yellow, 10 steps |
| `--colors-avacado-*` | 10 steps | a green they *separate* from brand green |
| also | `blue`, `red`, `indigo`, `teal`, `brown`, `cider`, `orange`, `purple`, `pink`, `lime`, `yellow` | 10 steps each |

**Type.** `Okra`, self-hosted woff2 + ttf, **shipped at weight 600 and 800 only**
(`@font-face` blocks confirm), falling back to `Helvetica`. A second family,
`wasabicons`, is a **custom icon font**. `[MEASURED]`

Usage frequency across the CSS â€” the honest "what is actually used":

| Property | Top values |
| --- | --- |
| `font-size` | **14 px (78Ã—)**, **12 px (74Ã—)**, 16 px (30Ã—), 24 px (16Ã—), 18 px, 20 px, 13 px, 11 px, 10 px, 9 px |
| `font-weight` | **500 (57Ã—)**, normal, 700, 400, 600, 200, bold, 800 |
| `font-family` | `IconFont` (101Ã—), `CustomFont`, `Okra` |
| `border-radius` | **3 px (45Ã—)**, 4 px, 2 px, 50 %, **68 px**, 12 px, 8 px, 100 %, 100 px, 11 px, 16 px |
| `box-shadow` | `0 2px 2px 0 rgba(0,0,0,.22)`, `0 2px 4px 0 rgba(0,0,0,.5)`, `0 2px 2px 0 rgba(200,200,200,.5)`, `0 0 14px 0 rgba(0,0,0,.3)` |
| `line-height` | `normal` (27Ã—), 2, 1.6, 1.4, 1.5, 1.8, 0, 1 |
| breakpoints | `desktop-breakpoint 1260px`, `tablet-breakpoint 1020px` |

So: **a two-weight typeface, a 12/14 px workhorse, medium weight, tight 3 px
radii, one soft shadow, and a yellow that is a named token rather than an
accent.** Our `DESIGN.md` already owns a palette and a 12.5 px floor; the
transferable items are in Â§11.5.

### 11.3 The API surface, measured verbatim

Path literals recovered from the shipped bundles `[MEASURED]`:

```
/api/feature-flags/receive            â€” the client pulls feature flags
/v1/layout/feed                       â€” the HOME page is a server-driven feed
/v1/layout/listing_widgets            â€” the SHELF is server-driven widgets
/v1/layout/product_suggestion
/v1/layout/tag_collections
/v1/consumerweb/eta                   â€” the ETA is computed for the consumer web
/v1/order_count                       â€” "N orders near you" social proof
/v1/campaigns
/v1/consent/tobacco                   â€” a consent gate for a restricted category
/v1/actions/upload_prescription       â€” prescription upload (pharmacy)
/v1/analytics_events_properties/
/v1/user/user_property/
/v1/print/landing_page                â€” Print Store
/v1/print/print_preview
/v1/printing/decrypt
/v1/printing/update-print-config
/v2/accounts/                         â€” auth
/v2/accounts/auth_key/
/v2/accounts/authorize/airtel/        â€” telco OAuth (Airtel)
/v2/accounts/verify/phone/code/
/v2/accounts/logout/
```

Hosts seen: `blinkit.com`, `jumbo.blinkit.com`, `jumbo.zomato.com`,
`cdn.grofers.com`, `in-app-support.grofer.io`, `storage.googleapis.com`,
`maps.googleapis.com`, `blinkit.onelink.me`, `link.blinkit.com`,
`ad.apsalar.com`, `api.whatsapp.com`. `[MEASURED]`

Features named in shipped strings: `ambulance`, `black` (Blinkit Black),
`paan`, `recipes`, `wallet`. `[MEASURED]`

### 11.4 The screen anatomy, measured

**Home / shell (378 styled components, `layout` chunk).** The signed-out shell
already contains:

- `Header`, `LocationBar` **with `EtaContainer`, `ShimmerBG` and
  `TitleShimmer`** â€” the ETA sits in the location bar and shimmer-loads.
- `SearchBar` **with `AnimationWrapper` / `AnimationText`** â€” the rotating
  placeholder (ours is `home-search.tsx`, built 2026-11-06).
- `ProfileButton`, `CartButton` **with `StyledAnimatedNumbers` and
  `CartProductImageContainer`** â€” the cart count animates and the last product's
  image rides in the button.
- `Feed` with `LoaderContainer` **and `ErrorWrapper`**.
- The full modal inventory, which is the part we should actually read:
  `DeliveryAddressModal` (39 sub-components, with a **map section** and a
  detect-location button), `GetLocationModal`, `UnServiceableLocationComp`
  (`OopsText` â€” a graceful "we don't come here"), `AddressListItem` (with edit
  modal and **delete confirmation**), `AddressForm`, `CouponDetailsModal` /
  `CouponDetailsSummary` (with a **`TermsList`**), `RequestProductModal`
  (**`WordCount`** on the textarea), `ShareCartModal`, `DualCartModal`,
  `BillInfoModalSummary`, `FilterModal` (with a **`LeftNavContainer`**),
  `UploadingModal` (**`Progress`**), `UploadFailedModal`,
  `UploadingSuccessModal`, `PreviousFilesModal` (**`ThumbnailExpiry`**,
  `ExpiredContent`), `PasswordProtectedModal`, `VerifyModal`,
  `DeleteAccountModal` (**`OtpBoxes` + `ResendButton`**), `GenericErrorModal`,
  `GenericActionDialog`, `InfoModal`, `FeedingIndiaModalContent`,
  `DownloadAppModal` / `DownloadAppHeader` / `DownloadBannerSheet`.

**Search + listing (`ProductsWrapper`, 92 components).** The richest find:

- `SearchMobile`: **`TrendingTitle`, `TrendingListContainer`,
  `TrendingListItem`, `TrendingItemImage`, `TrendingItemTitle`** â€” a trending
  rail on an empty search box; **`RecentsContainer`, `RecentsTitle`,
  `ClearButton`** â€” recent searches; `SuggestionTagContainer` â€” suggestion
  chips; `ShowingResultsText` â€” "showing results forâ€¦".
- **`CantFindText`, `CantFindSection`, `RaiseRequestText`, `SuggestTextContainer`,
  `SuggestIcon`** â€” on the search screen itself: *can't find it? tell us*. That is
  the same idea as `RequestProductModal` and it is two taps from the search the
  customer just typed.
- Skeletons everywhere: `Skeletonline1â€¦4`, `SkeletonBlock`, `SearchSkeleton`,
  `ProductSkeleton`, `SuggestionSkeleton`, `Skeletonline1/2`.
- `BffPlpFeedContainer` has **`BlurredContainer`** â€” the shelf blurs rather than
  blanks while it reloads.
- `PlpSeoContainerstyles` puts a **table** of SEO text under the shelf.

**Checkout (`checkout`):** `Zpayments` (PayNowButtonContainer, PaymentContainer,
  LoaderContainer), `containers.CartItemsContainer`, `containers.AddressBox`,
  `OtpVerification`. Payments named in strings: **PhonePe**, `blinkit Cash`
  wallet with "Add Money and Place Order", "You will be redirected to wallet's
  website to authorize payment". `[MEASURED]`

**Post-order (`OrderTrack` chunk â†’ `PaymentConfirmationPage`):**
  `ThankYouComponent`, `ThankYouPlaced`, `ThankYouHeading`,
  **`ThankYouAddress`**, **`ThankYouItems`**, `ThankYouOrderDetails`,
  `ViewDetailsButton`, `ThankYouAppDownload`. The confirmation is a real page
  with the address and the items on it, not a push.

**Copy, verbatim `[MEASURED]`:** (selection, all from shipped strings)

- `Please provide your delivery location to see products at nearby store`
- `We need your location to show you curated assortment from your nearest store`
- `Delivering your order to` Â· `We deliver` Â· `Save address as` Â·
  `Nickname of your address` Â·
  `This allow us to find you easily and give you timely delivery experience`
- `Free delivery` Â· **`Get free delivery on your first order!`** Â·
  **`On first 10 orders`** â€” the offer states its own scope
- `Recent searches` Â· `Tell us what you need` Â· `Unable to open the shared cart` Â·
  `Items shared with you!`
- `Get live tracking and discounts!` Â· `Live trackingâ€¢Exclusive offers`
- `We delete your uploaded files once order is delivered` Â·
  `Your files are deleted after 3 days or upon order delivery, as per our strict
  compliance policy` Â· `Medicine name (same as your order)`
- `Your order wasn't placed. Please try again. If your account was debited, it
  will be credited within a week.` â€” a payment failure that says what happens to
  the money
- `There was an error in uploading your file. Please try again` /
  `Try uploading again` / `Cancel upload` â€” upload states are named
- `India's last minute app` Â· `Everything delivered in minutes | blinkit`

### 11.5 What this changes in our plan

**Done already, confirmed correct** (evidence above): the rotating search
placeholder, the offers rail, the map in the address flow, the text-first
tracker, `check:saved`, the "was everything right?" question. Blinkit does all of
these; none of them was a mistake.

**New, worth doing before launch (`A14`â€“`A20`) â€” each is small, honest, and needs
no owner decision. (A11â€“A13 are taken: see Â§10.7.)**

| # | Item | Evidence | Our move |
| --- | --- | --- | --- |
| A14 | **"Can't find it? Tell us" on the search screen** | `CantFindText` / `RequestProductModal` / `Tell us what you need` `[MEASURED]` | A row under an empty search result that opens a one-line "what do you need?" request. No server table needed to start: it can write a `product_requests` row, or simplest, open the shop's phone. Decide: row + CallShop is the honest minimum. |
| A15 | **The offer states its own scope** | `On first 10 orders`, `Get free delivery on your first order!` `[MEASURED]` | The free-delivery nudge says "free above â‚¹500" today; add the code's scope when a coupon is applied, and never imply a discount the DB will refuse (already true â€” `check:delivery`). |
| A16 | **Upload states are named** | `UploadingModal.Progress`, `UploadFailedModal`, `UploadingSuccessModal`, `Try uploading again`, `Cancel upload` `[MEASURED]` | Our photo upload has no explicit progress/failure/retry triad. Add the three states (rule 9.2/9.4 already demand them). |
| A17 | **Payment failure says what happens to the money** | `If your account was debited, it will be credited within a week.` `[MEASURED]` | Razorpay later; but the *sentence pattern* is ours to keep. For a refused COD order we already say nothing was charged. |
| A18 | **Confirmation is a page, not a push** | `ThankYouAddress`, `ThankYouItems`, `ViewDetailsButton` `[MEASURED]` | We already route to `/order/[id]?placed=1`. Add the address and the item list to that success card â€” it is the moment the customer re-reads what they bought. |
| A19 | **The ETA lives in the location bar** | `LocationBar__EtaContainer` `[MEASURED]` | Ours shows the zone ETA on checkout only. Add it to Home's delivery-address row. |
| A20 | **Bill summary is one tap deep** | `BillInfoModalSummary` with `ModalHeader/ModalBody/ModalFooter` `[MEASURED]` | Ours puts subtotal/fee/discount on the cart screen already; the cart should deep-link to a bill summary with the per-line maths. |

**Refuse, with reasons (extends Â§8):**

- **Server-driven UI (`/v1/layout/feed`, `BffPlpFeedContainer`,
  `BlurredContainer`).** A one-shop app does not need a layout API; it makes
  every screen a network dependency and puts merchandising decisions outside the
  repo. Refused again, with the measurement attached this time.
- **Wallet top-up (`blinkit Cash`, `Add Money and Place Order`).** Money held on
  behalf of customers is a licence, a reconciliation and a refund duty. A COD
  shop must not start one.
- **Pharmacy / prescription upload, Print Store, Ambulance, Paan, tobacco
  consent, Airtel OAuth, second cart, cart sharing, referral store.** All
  `[MEASURED]` in the shipped app, all a different business from one grocery
  shop on one street. Listed so nobody rediscovers them and mistakes them for
  gaps. `A1`â€“`A10` in Â§7 remain the plan.
- **`BlurredContainer`.** Blur-as-loading is a second loading vocabulary; our
  skeletons are already in `DESIGN.md`.
- **A 3 px radius, two weights, `Okra`.** Blinkit's system is not ours to copy:
  `DESIGN.md` owns ours, and `KUNIGAL.md` owns the voice. The transferable part
  is the *discipline* â€” one base colour, one soft shadow, a named scale â€” not the
  values.

### 11.6 One-paragraph answer to "what makes us fall behind"

Nothing structural. Blinkit's advantage is **breadth of services** (pharma,
print, wallet, ambulance, pan-India catalogue) and **server-driven
merchandising**, and both are wrong for a shop on one street. What it does better
than us is **small, repeated courtesy**: a can't-find-it door two taps from the
search the customer just typed, an offer that states its own scope, upload
states that are named instead of silent, a confirmation page that repeats the
address, and the ETA sitting in the location bar rather than only at checkout.
Those five are `A14`, `A15`, `A16`, `A18` and `A19` and they are the ones worth
building.
