# KUNIGAL.md — who this is for, and how we speak to them

**Status:** living document. `ROADMAP.md` is *what* we build; this file is *who
we build it for* and *the exact voice* of every word the customer reads. When a
translation decision is argued about, the answer lives here.

**Last written:** 2026-10-13.

---

## 1. The place, in facts (not vibes)

Researched from the public record so the voice is grounded, not invented:

- **Kunigal**, Taluk headquarters of Kunigal taluk, **Tumakuru district**,
  Karnataka. ~**34,155** people in the town, ~**1,91,628** across the rural
  taluk (2011 census). 773 m elevation, on **NH-75** (Bengaluru–Mangaluru) and
  **SH-33** (Tumakuru–Maddur); a railway station on the Bengaluru–Hassan line;
  **70 km from Bengaluru**.
- **Literacy ≈ 69%** (men 74%, women 64%). One in three adults in the town and
  fewer in the surrounding hoblis cannot comfortably read a full sentence. That
  is the single most important number in this file.
- **PIN 572130**, telephone code 08132, vehicle code KA-06.
- Nicknamed **"Horse town"** — the stud farm begun under Hyder Ali and Tipu
  Sultan still breeds racehorses. **Kunigal Kere** (the lake) is the second
  largest in Karnataka. Nearby: Huliyurdurga, Hutridurga, the Yediyur
  Siddhalingeshwara temple (a big pilgrim draw), the Marconahalli dam.
- **How people earn:** ragi and millet farming, **coconut** groves, **sericulture
  (silk)**, **beedi rolling**, and a large number of small shops and traders.
  A weekly **ಸಂತೆ** (shanthe / market) culture. Modern name: *Nartanapuri*.
- **Language:** Kannada first, effectively Kannada only for most customers.
  The dialect is the **Tumakuru / old-Mysuru** variety of standard Kannada —
  not a far-away dialect, but spoken and plain, not literary.

## 2. What this means for the product

| Fact | Consequence for the app |
| --- | --- |
| Kannada is the default, not a setting | Kannada loads first; English is the switch, not the reverse. |
| ~1 in 3 cannot read a full sentence | Icons + numbers must carry the meaning. Short words. Big touch targets (44 px floor is a floor). Kannada text never smaller than English. |
| Low order values, cash economy | COD is the primary path, UPI next. Never assume a card. |
| Patchy 4G on NH-75 and in hoblis | Offline-first reading, safe retries, one banner not a modal per request. |
| One shop, one town, ~5–6 riders | The phone is support. "Call the shop" is a real feature, not a dead end. |
| Farming / market life | Words like **ಸಾಮಾನು**, **ಸಂತೆ**, **ಕೆರೆ** are familiar; **ಉತ್ಪನ್ನ**, **ವರ್ಗೀಕರಣ** are not. |

**Implemented 2026-10-13:** `src/i18n/index.ts` now sets `DEFAULT_LANGUAGE = 'kn'`,
so a fresh install starts in Kannada and English is a remembered one-tap switch.
The device locale is deliberately ignored — a factory-English phone in Kunigal
usually belongs to a Kannada reader.

## 3. The voice: "the shop's own helper"

Write Kannada the way a **friendly shop assistant in Kunigal** actually talks to
a customer at the counter. Not a government notice. Not a Bangalore IT app.

Nine rules:

1. **Speak, don't write an order.** `ರದ್ದು ಮಾಡಿ`, `ಸೇರಿಸಿ`, `ಕರೆ ಮಾಡಿ`,
   `ಹಾಕಿ` — not passives like `ರದ್ದುಗೊಳಿಸಲಾಗಿದೆ`, `ನಮೂದಿಸಲಾಗಿದೆ`.
2. **Plain verbs beat formal verbs.**
   `ಬಂದಿದೆ` over `ಸ್ವೀಕರಿಸಲಾಗಿದೆ`. `ಬರಲಿಲ್ಲ` over `ಲೋಡ್ ಆಗಲಿಲ್ಲ`.
3. **Loanwords are Kannada here when the town uses them.** `ಆರ್ಡರ್`, `ಬಿಲ್`,
   `ಡೆಲಿವರಿ`, `ಮೊಬೈಲ್`, `ಸ್ಟಾಕ್`, `ಏರಿಯಾ`, `ರೈಡರ್`. Do **not** purify these into
   Sanskritised substitutes nobody says out loud.
4. **Do not purify away the shop words.** It is **ಸಾಮಾನು**, not `ಉತ್ಪನ್ನ`. It is
   **ಕಿರಾಣಿ ಸಾಮಾನು**. A category is a **ವಿಭಾಗ**. The bag is a **ಬುಟ್ಟಿ**.
5. **"ನೀವು" always.** Respectful, plural, never the singular `ನೀನು`.
6. **Say the number, then the thing.** `10 ನಿಮಿಷಗಳಲ್ಲಿ`, `{amount} ಹಣ`.
7. **Never leak the machinery.** No `Supabase`, no `.env`, no stack words on a
   customer screen. Those live only on the developer setup screen.
8. **Short.** A tab label is one word. A button is two words. If it does not fit
   a small shop phone screen it is the wrong word, not a smaller font.
9. **Same warmth in both languages.** The English must read like a kind shop too,
   not a corporate string. Neither language is a "translation" of the other.

## 4. The Kunigal glossary (decisions, with reasons)

This table is the contract. Left column = the concept. Right = the word we ship,
and why.

| Concept | Ship this | Why not the obvious alternative |
| --- | --- | --- |
| Home tab | **ಅಂಗಡಿ** | It *is* the shop front. `ಮುಖಪುಟ` ("main page") is web-speak nobody says. |
| Cart | **ಬುಟ್ಟಿ** | The paneer/vegetable basket everyone carries. Warm, exact. |
| Orders | **ಆರ್ಡರ್‌ಗಳು** | The town already says `ಆರ್ಡರ್`. |
| Checkout | **ಮುಂದುವರಿಸಿ** | "Continue". `ಚೆಕ್‌ಔಟ್` is a hotel word; `ಆರ್ಡರ್ ಮಾಡಿ` is reserved for the final tap. |
| Place order | **ಆರ್ಡರ್ ಮಾಡಿ** | The action, plainly. |
| Delivery fee | **ಡೆಲಿವರಿ ಶುಲ್ಕ** | Universally understood. |
| Cash on delivery | **ಬಂದಾಗ ನಗದು** | What the rider is handed. |
| Out of stock | **ಮುಗಿಯಿತು** | What the shopkeeper says. `ಸ್ಟಾಕ್ ಇಲ್ಲ` is the fallback, not the lede. |
| Sold out (item) | **ಮುಗಿಯಿತು** | Short enough for a card badge. |
| Items / goods | **ಸಾಮಾನು / ವಸ್ತು** | `ಸಾಮಾನು` for the shopping, `ವಸ್ತು` for one line. |
| Category | **ವಿಭಾಗ** | Common in shops; `ವರ್ಗ` is falling out of speech. |
| Pincode | **ಪಿನ್ ಕೋಡ್** | Spoken form. |
| Area / street | **ಏರಿಯಾ / ರಸ್ತೆ** | `ಬಡಾವಣೆ` is not how Kunigal speaks. |
| Landmark | **ಗುರುತು** | "A mark to find the house." |
| Default address | **ಮುಖ್ಯ ವಿಳಾಸ** | `ಡಿಫಾಲ್ಟ್` is a settings word, not a street word. |
| Discount | **ರಿಯಾಯಿತಿ** | The word on every shop board. |
| Offer / deal | **ಆಫರ್** | The word on every banner and in speech. `ವಿಶೇಷ` works as an adjective, but `ಆಫರ್` alone is what a customer says. |
| Coupon code | **ಕೋಡ್** | "Code" is understood; `ರಿಯಾಯಿತಿ ಕೋಡ್` in full when a sentence needs it. Not `ಕೂಪನ್`, which is catalogue-speak. |
| You saved | **ಉಳಿತಾಯ ಆಯಿತು** | "A saving happened" — plain, already-done. Not `ನೀವು ಉಳಿಸಿದ್ದೀರಿ`, which sounds like a bank. |
| Placed (status) | **ಆರ್ಡರ್ ಆಗಿದೆ** | Reads as a sentence, as a chip. |
| Confirmed | **ಅಂಗಡಿ ಒಪ್ಪಿಕೊಂಡಿದೆ** | "The shop accepted it." Reassures. |
| Packing | **ಸಿದ್ಧವಾಗುತ್ತಿದೆ** | "It is getting ready." |
| Out for delivery | **ಡೆಲಿವರಿಗೆ ಹೊರಟಿದೆ** | "It has left for delivery." |
| Delivered | **ಮನೆ ಸೇರಿದೆ** | "It reached home." Warmer than `ತಲುಪಿಸಲಾಗಿದೆ`. |
| Cancelled | **ರದ್ದಾಗಿದೆ** | Plain, already-done form. |

## 5. Improvisations (deliberate, not literal)

The brief was explicit: this is not a translation exercise. These are places
where the Kannada **says something better than a literal rendering** of the
English, and the English should be improved to match where it is weak:

- **Home subtitle.** En: "Groceries & essentials in 10 minutes."
  Kn: *"10 ನಿಮಿಷಗಳಲ್ಲಿ ಕಿರಾಣಿ ಸಾಮಾನು, ಮನೆ ಬಾಗಿಲಿಗೆ"* — "groceries, to your
  doorstep, in 10 minutes". The doorstep is what a customer pictures.
- **Category heading.** En: "Shop by category." Kn: *"ವಿಭಾಗಗಳು"*. Kannada does
  not need the instruction verb; the chips already read as a choice.
- **Confirmation line.** En: "Order placed successfully." Kn: *"ಆರ್ಡರ್
  ಆಗಿದೆ"*. No ceremony.
- **Reorder.** En: "Reorder." Kn: *"ಮತ್ತೆ ಆರ್ಡರ್ ಮಾಡಿ"* — "order again", which
  is what a person says.
- **Rider greeting.** *"ನಮಸ್ಕಾರ {name}"* — the ordinary respectful hello.
- **Empty states** reassure rather than report: *"ಬುಟ್ಟಿ ಖಾಲಿಯಾಗಿದೆ"* ("the
  basket is empty"), not "no items found".

## 6. Screen-by-screen intent

- **Home.** "The shop is open, here is what we have, what do you want?"
  The address pill names the customer's own area, not a generic town. Live offers
  appear before the shelves — a code is the reason to fill a basket — but never
  while the customer is searching.
- **Cart.** "This is your basket, this is the total, continue when ready."
- **Checkout.** "Where to, how you will pay, any code you have, any word for the
  shop, then ಆರ್ಡರ್ ಮಾಡಿ." The code is the customer's own words; the discount
  that appears is the shop's, and it says how much was saved.
- **Orders.** "Where is my bag" first (status in words a person says), then the
  number to read out, then reorder.
- **Rider.** Brisk and practical, like a work instruction on a bike phone mount.
- **Admin.** The owner is busy standing at the counter: it is a board, not a
  dashboard. Every label is an action.

## 7. How a new string is written (checklist)

1. Read the **English** only to know the *meaning*, never the *sentence*.
2. Find the situation in the table in §4. If the situation is new, add a row
   here **with the reason** before shipping the string.
3. Say it out loud as the shop assistant. If you would not say it at the
   counter in Kunigal, rewrite it.
4. Add **both** languages in the same commit (`AGENTS.md` rule 9.5), single-brace
   placeholders, `_one`/`_other` plurals.
5. Run `npm run check:i18n`. It rejects a stray `{{...}}`, a missing Kannada key,
   and an untranslated identical value.

## 8. Open gaps (honest)

- **Voice is not yet in the app's ears.** There is no text-to-speech, and with
  ~31% low literacy that is the biggest unfilled accessibility gap for this
  specific town. Tracked in `ROADMAP.md`, not yet built.
- **No dialect review.** This voice is written in plain old-Mysuru Kannada. It
  should be read once by a Kunigal local before launch; wording may shift
  (`ಬುಟ್ಟಿ` vs a local preference) without any code change, because every string
  is a key.
