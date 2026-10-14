# DESIGN.md — the look of the app, and why

This is the reasoning behind every colour, size and radius in the app. The
numbers live in `apps/mobile/src/constants/theme.ts`; this file is the *why*.

Read `KUNIGAL.md` first — it is the authority on who we build for and on the
Kannada voice. This file only decides how that audience is served visually.

---

## 1. Who is looking at the screen

One taluk town, one shop. That single sentence decides almost everything below.

- **Roughly one in three adults cannot comfortably read a sentence.** So colour,
  icons, pictures and numbers carry meaning. Words confirm; they do not lead.
- **Mostly budget Android phones**, held in one hand, often in the midday sun or
  a dim kitchen at night, on patchy 4G.
- **Older eyes are the norm**, not the exception.
- Many people already use Swiggy/Zepto/Blinkit, so the *shape* of a quick-shop
  is half-familiar; the words and pictures are what make it theirs.

The test for any screen: **a person who cannot read the label should still be
able to use it.**

---

## 2. Colour

### 2.1 The three colours, and the one job each has

| Token | Light | Dark | Its **one** job |
| --- | --- | --- | --- |
| `accent` | `#0F7B3E` | `#4ED08A` | "You can act here" — Add, Checkout, active tab. Exactly one green thing per screen. |
| `secondary` | `#E8890C` | `#F4B24A` | "Offer / look here" — discounts, deals. **Never body text.** |
| `text` | `#221B12` | `#F6F0E4` | Reading ink. |
| `background` | `#FFFBF3` | `#14110C` | The page. |
| `warning` | `#B26A05` | `#F0B657` | Offline, shop closed. |
| `danger` | `#C0392B` | `#FF6B5E` | Destructive only: cancel, out of stock. |

### 2.2 Why green (and not blue)

Two independent reasons that agree:

- **Category convention, India.** Grocery is warm everywhere here — BigBasket
  green, Blinkit yellow-green, Swiggy orange, Zomato red. **Blue reads as a bank,
  a government form or a courier** (Paytm, PhonePe). It is also cold, and cold is
  the wrong signal for food.
- **The town's own palette.** Kunigal's world is green — ragi, coconut, silk, the
  tree cover on NH-75 — and **marigold**, the flower on every shop board and
  temple. Hence a leaf green with a yellow bias, and marigold as the second.

### 2.3 Why cream and why charcoal (not white, not black)

- Pure `#FFFFFF` glares under this town's sun and is harsh for older eyes. Warm
  paper cream reads like a ledger page.
- Pure `#000000` on an OLED phone causes **halation** — text smears as you scroll.
  Modern dark themes (Material 3, iOS) use grey-charcoal surfaces instead.

### 2.4 The contrast audit (computed, not guessed)

| Pair | Ratio | Use |
| --- | --- | --- |
| `text` on `background` (light) | **16.8:1** | Body text, AAA |
| `accent` on `background` (light) | **5.2:1** | Buttons, links |
| `secondary` on `background` | **2.55:1** | ❌ **never text** |
| `onSecondary` on `secondary` (solid) | **5.6:1** | Discount pills |
| `secondaryInk` on `secondarySoft` | **4.84:1** | Soft marigold badge |
| `warningInk` on `warningSoft` | **5.63:1** | Offline pill |
| `successInk` on `successSoft` | **5.71:1** | Delivered pill |

**The `*Ink` rule.** A bright fill colour is almost never readable as *text on
its own pale wash* — marigold on marigold-soft is only 2.3:1. So every soft tint
has a darker `*Ink` token used for text/icon on it, verified ≥ 4.5:1. The bright
token is only ever a solid fill. This bug was found by computing the ratios
during the redesign, not by looking at it.

### 2.5 Meaning never rests on colour alone

Every status is **colour + icon + word**. `packing` is green **and** a bag
**and** "ಸಿದ್ಧವಾಗುತ್ತಿದೆ". That survives colour-blindness and low literacy.
See `lib/order-status.ts`.

---

## 3. Light and dark

Both palettes are complete and are chosen at runtime:

- **System / Light / Dark**, defaulting to **System** (follow the phone).
- The choice is stored on the device (`store/theme-store.ts`, AsyncStorage), so
  it belongs to the phone, not the account, and survives sign-out.
- `hooks/use-theme.ts` is the single source of the answer. The root
  `_layout.tsx` builds its navigation theme from the same palette, so the tab bar
  and the screens can never disagree.
- Dark mode is not "invert": accent desaturates, shadows give way to surface
  tiers, and the status-bar style flips.

---

## 4. Type, spacing, shape

- **Type** (`Type`): nothing below 12.5 px. Kannada is taller than Latin, so line
  heights run ~1.5×. A kid-bike rider reads a 22 px total, not a 12 px one.
- **Kannada face** (`constants/fonts.ts`): Noto Sans Kannada ships with the app
  (`assets/fonts`, loaded by `expo-font` before the first frame), matched to the
  `Type` weight by choosing the right `ThemedText type`. Android and iOS each
  ship a *different* Kannada face, so without this the same screen renders
  differently on two phones, and the language the shop actually speaks is the one
  that drifts. Latin keeps the system font; `code` (order numbers) stays
  monospaced in both languages. Each weight is its own file, so a screen selects a
  weight by `type`, never by setting `fontWeight` on the family.
- **Spacing** (`Spacing`): a 4-point scale. 16 is the standard gutter. No magic
  numbers in screens.
- **Radii** (`Radii`): cards `lg` (20), sheets `xl` (28), chips/buttons `pill`.
  Large, soft, Material-3-ish — friendly, not corporate.
- **Elevation** (`Elevation`): a whisper-soft `card` shadow and a deeper
  `floating` one for things that hover (footers, the basket bar).

---

## 5. Iconography and imagery

- **Photos first, emoji as the shop's own face.** A product with `image_url`
  shows the photo, cropped to fill the tile (`contentFit="cover"`) — real photos
  are the goal once the owner starts photographing the shelf. Until then the emoji
  is not a placeholder apology but a designed tile: the product's own `products.emoji`
  (falling back to the category `icon`) sits on a soft circular plate, tinted
  against the tile, with a hairline edge. A product that HAS a photo gets the
  photograph and nothing else: no corner tag, no plate. A sticker on top of a
  picture says the picture is decoration; a shelf of real photographs is what earns
  trust.
- **Emoji are a design language, not a fallback.** They carry sections too: a 🎁
  marks offers, 🔥 the deals rail, 🔁 "buy again", 💚 the shortlist, 🧺 the grid.
  `SectionHeader` takes an optional `emoji`, and the glyph is hidden from screen
  readers (the title already says what it is). This is deliberate for a town where
  roughly one in three adults cannot comfortably read a sentence (KUNIGAL.md §2):
  the picture lands before the word.
- **The horse** is Kunigal's own nickname ("Horse town"), so it is the shop's mark
  (`🐎` on the sign-in screen). It is deliberately *not* in the app bar: at 44px
  between two buttons a roundel reads as a sticker, and the wordmark says the name
  better. The mark belongs where the shop introduces itself, not on every screen.
- Icons are Ionicons; a status is always icon + colour + word.

---

## 6. The modern direction

**Material Design 3 (Material You) as the foundation, with Indian
quick-commerce layout conventions on top.**

- MD3 because Kunigal is Android-first and budget-phone-heavy: tonal surfaces,
  large expressive shapes, big numerals, chips, segmented buttons, real ripple —
  and accessibility *built into the spec*.
- Quick-commerce patterns (Blinkit / Zepto / Instamart) because they are what is
  actually popular here right now: a **sticky basket bar** ("3 items · ₹240 ·
  View basket"), horizontal category and deals rails, a 2-column grid, one-tap
  Add.
- **A real app bar on Home.** The wordmark (name over promise), the language chip
  and the bag stay in a bar that does not scroll, and the **search field lives
  in it** rather than inside the list. On a small phone, search that scrolls away
  is search you cannot reach; keeping it pinned is the single biggest "feels like a
  real app" change. The greeting, the delivery pill and the offers rail scroll
  beneath it. No brand roundel — see the horse note in §5.
- **The welcome is a panel, not a paragraph.** The greeting, the one-line question
  ("What do you need today?") and the destination pill sit together on a soft accent
  panel at the top of the list, so the first thing a customer sees is one designed
  block rather than three loose lines. When the app knows who is signed in, the
  greeting uses their name.

Deliberately **rejected**:

- **Glassmorphism / blur** — low contrast, and it janks on budget GPUs.
- **Neo-brutalism** — trendy, hostile to low-literacy users.
- **Heavy gradients / parallax** — battery and jank on 4G.

---

## 7. Accessibility and low literacy (rule 9.9, `KUNIGAL.md`)

- Every tap target ≥ 44×44, even when the icon inside is smaller.
- Every icon-only button has an `accessibilityLabel`.
- Never shrink text to make it fit.
- Three states on every data screen: **loading**, **empty**, **error + Retry** —
  written once in `components/state-message.tsx` so no screen forgets.
- Technical errors (`error.message`, Postgres codes) go to the console only.

---

## 8. Performance (rule 9.8)

- Long lists use `FlatList` with a stable `keyExtractor` (the row `id`).
- `AddToCart` subscribes to **one** product's quantity, not the whole cart, so
  tapping Add does not re-render every card.
- Images are sized by `aspectRatio` so layout never jumps.
- Home fetches the catalogue **once** and filters in memory — this shop has tens
  of products, so a category tap or a search is instant and needs no round trip.

---

## 9. Screen migration checklist

When converting a screen to this system:

1. Colours only from `useTheme()`; sizes only from `Spacing` / `Radii` / `Type`.
2. Text via `ThemedText`; DB text via `localizedName` / `localizedItemName`.
3. Groups of things go in a `Card`; the primary action is a `Button`; statuses
   are a `Badge` (icon + colour + word); headers use `IconButton`.
4. Loading / empty / error states from `state-message.tsx`.
5. New copy goes into **both** `en.json` and `kn.json`.
6. Confirm it reads correctly in **both** light and dark.
