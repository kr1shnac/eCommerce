# Store listing kit — Play + Apple

**Status:** draft copy and questionnaire answers, 2026-11-09. `TODO(OWNER)`
marks what only the client can decide. **Re-check every console rule on the day
of submission — store rules move** (`PRODUCTION.md` §9 was checked 2026-10-19).

> The **app name** can be tuned; the **app identifier** (`in.kunigal.grocery`) is
> permanent after the first upload — see `LAUNCH-REGISTER.md` §2.

---

## 1. Listing copy

### App name (≤30 chars)
- `TODO(OWNER)` Choose **once**: `Kunigal Grocery` today; if the shop's real name
  is different, use it — customers search by the shop they know, not the town.
  Kannada listing title: **ಕುಣಿಗಲ ಗ್ರೋಸರಿ** (or the shop's own name in Kannada).

### Short description (≤80 chars)
- EN: `The shop on your street, on your phone. Order in Kannada, pay cash when it arrives.`
- KN: `ನಿಮ್ಮ ರಸ್ತೆಯ ಅಂಗಡಿ, ನಿಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ. ಕನ್ನಡದಲ್ಲಿ ಆರ್ಡರ್ ಮಾಡಿ, ಸಾಮಾನು ಬಂದಾಗ ನಗದು ಕೊಡಿ.`

### Full description (≤4000 chars) — draft, EN
```
Kunigal Grocery is the ordering app for one shop on one street — the shop you
already buy from, now on your phone.

• Browse the shop's shelf in Kannada or English, with real prices and real stock
• Add to cart, choose your address, and pay cash when the rider arrives
• See who is delivering: your rider's name, photo, and a call button
• Follow your order: placed → packed → on the way → delivered
• Reorder last month's rice and oil in two taps
• Works on a patchy connection: the last known shelf is still there when the
  signal is gone

One shop, one town, one phone number to call. No membership, no ads, no surprises
at the total.
```

### Full description — draft, KN
```
ಕುಣಿಗಲ ಗ್ರೋಸರಿ — ಒಂದೇ ರಸ್ತೆಯ ಅಂಗಡಿಯ ಆರ್ಡರ್ ಆಪ್. ನೀವು ಈಗಾಗಲೇ ಕೊಂಡುಕೊಳ್ಳುತ್ತಿರುವ
ಅಂಗಡಿ, ಈಗ ನಿಮ್ಮ ಫೋನ್‌ನಲ್ಲಿ.

• ಅಂಗಡಿಯ ಸಾಮಾನು ಕನ್ನಡ ಅಥವಾ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ನೋಡಿ — ನಿಜವಾದ ಬೆಲೆ, ನಿಜವಾದ ಸ್ಟಾಕ್‌ನಲ್ಲಿ
• ಬುಟ್ಟಿಗೆ ಹಾಕಿ, ವಿಳಾಸ ಆಯ್ಕೆ ಮಾಡಿ, ಡೆಲಿವರಿ ಹುಡುಗ ಬಂದಾಗ ನಗದು ಕೊಡಿ
• ಯಾರು ಬರುತ್ತಾರೆ ಎಂದು ತಿಳಿಯಿರಿ — ರೈಡರ್‌ನ ಹೆಸರು, ಛಾಯಾಚಿತ್ರ, ಕರೆ ಮಾಡುವ ಬಟನ್
• ಆರ್ಡರ್ ಅನ್ನು ಗಮನಿಸಿ: ಆರ್ಡರ್ ಆಗಿದೆ → ಸಿದ್ಧ → ದಾರಿಯಲ್ಲಿ → ಮನೆ ಸೇರಿದೆ
• ಹಿಂದಿನ ಆರ್ಡರ್ ಅನ್ನು ಎರಡು ಒತ್ತುವಿಕೆಯಲ್ಲಿ ಮತ್ತೆ ಪಡೆಯಿರಿ
• ನೆಟ್‌ವರ್ಕ್ ಕಡಿತವಾಗಿದ್ದರೂ ಕೆಲಸ ಮಾಡುತ್ತದೆ — ಕடನೆಯ ಬಾರಿ ನೋಡಿದ ಸಾಮಾನು ಇನ್ನೂ ಇರುತ್ತದೆ

ಒಂದೇ ಅಂಗಡಿ, ಒಂದೇ ಪಟ್ಟಣ, ಫೋನ್ ಮಾಡಲು ಒಂದೇ ಸಂಖ್ಯೆ. ಸದಸ್ಯತ್ವವೆಂದರೆ ಏನೂ ಇಲ್ಲ,
ಜಾಹೀರಾತು ಇಲ್ಲ, ಒಟ್ಟು ಬಿಲ್‌ನಲ್ಲಿ ಆಶ್ಚರ್ಯ ಇಲ್ಲ.
```

`TODO(OWNER)` Read both aloud; swap the shop's real name in if it differs.

### Screenshots (the actual blocker)
- [ ] `DEV` **Blocked on the first device run** — nothing has ever rendered on a
      phone (register C4). Capture on a real Android phone, in **Kannada**
      (system language), on the shop's own 4G.
- [ ] Minimum 2, aim 6–8 phone screenshots: shop home, product, cart, checkout,
      live order with the rider card, order tracker. No splash screens, no empty
      states, no dev banners — both stores refuse them.
- [ ] 2–3 English screenshots for the `en-IN` listing.
- [ ] Feature graphic **1024×500** (`DEV`, theme colours + shop name — draftable
      today from `theme.ts`).
- [ ] Icon: exists (`assets/images/icon.png`); verify the 512 px export at
      submission time.

---

## 2. Data-safety / App-Privacy declaration

Answer from the code, not from intent (`LAUNCH-REGISTER.md` §5 has the table):

| Question | Answer | Evidence |
|---|---|---|
| Does the app collect data? | **Yes** | Phone number; name + delivery address (incl. optional map pin); order history; rider GPS during a delivery; product photos; crash diagnostics |
| Is it shared with third parties? | **Yes — for app functionality only** | Supabase (hosting), SMS provider (sign-in code), Sentry (crashes, PII stripped), OSM/OSRM (map) |
| Is any of it for advertising? | **No** | No ads SDK in the app |
| Encrypted in transit? | **Yes** | Supabase TLS; HTTPS throughout |
| Can users request deletion? | **Yes, in-app, immediately** | `delete_my_account()` + the Account screen; plus the hosted deletion URL |
| Are payments taken? | **Not at launch (COD only)** | `TODO(OWNER)` If Razorpay ships, this declaration changes and must be re-answered |
| Location | **Approximate/precise, while a rider is delivering, deleted when the delivery closes** | `rider_positions`, `record_my_position()` |
| Photos | **Owner-only, product photos** | Supabase Storage |
| Device IDs / advertising ID | **No** | |

`TODO(OWNER)` read and confirm this — a declaration that over- or under-states
what the app does is a rejection, and understating is a policy problem, not a
typo.

---

## 3. Content rating (IARC) — draft answers

Shopping app; no violence, no gambling, no user-generated content visible to
other users, no ads, no in-app purchases at launch. Expected: **Everyone / 3+**.
`TODO(DEV)` Answer the questionnaire at submission and paste the result here.

---

## 4. Links and contact the listings need

| Field | Value |
|---|---|
| Privacy policy URL | `https://<shopname>.in/privacy` — `TODO(OWNER)` domain |
| Account-deletion URL | `https://<shopname>.in/delete-account` (explains the in-app path) — **Play requires it for apps with account creation** |
| Terms URL (optional, recommended) | `https://<shopname>.in/terms` |
| Support email | `TODO(OWNER)` A shop-owned email the shop actually reads |
| Support phone | The shop's counter number (`store_settings.support_phone`) |
| Demo/reviewer login | Customer-only account, credentials in Play Console → App content, **never public** (register C8) |

---

## 5. Play-specific, in submission order

1. `TODO(OWNER)` Confirm the account's **creation date and type** (personal vs
   organisation) — this decides whether the **12-testers-for-14-days** gate
   applies (`LAUNCH-REGISTER.md` §6). Recruit the testers immediately; it is the
   calendar, not the work.
2. `DEV` Build → internal/closed track → install the APK on the owner's phone →
   walk the whole flow in Kannada → capture the screenshots.
3. `DEV` Data-safety form, content rating, target audience (choose honestly), ads
   declaration: **no ads**.
4. `TODO(OWNER)` Store listing contact + URLs live on the domain.
5. Production access → review (usually ≤ a week once the gate clears).

## 6. Apple-specific (only if iOS is in scope for launch)

- `TODO(OWNER)` Apple Developer Program ($99/yr); an **organisation** enrolment
  needs a **D-U-N-S number** — start it weeks early, it is paperwork.
- `TODO(CA+OWNER)` App Privacy "nutrition labels" — the same answers as §2.
- Export compliance: the app uses only standard HTTPS/TLS — answer accordingly
  (and honestly; do not guess at submission time).
- Guideline 4.2 risk for a single-shop app: the mitigation is the listing itself —
  an unmistakably working shop, with a real phone number and real orders, not a
  wrapper. `[UNVERIFIED]` in `PRODUCTION.md` §9 — treat as a risk, not a fact.
- `TODO(DEV)` iOS has **no location permission string at all** — there is no
  `NSLocationWhenInUseUsageDescription` in `app.json` (checked 2026-11-09), and the
  location watcher will present the system prompt with no explanation or be
  refused outright depending on the OS version. It needs a bundled Kannada and
  English string before an iOS build asks a rider for a fix (`InfoPlist.strings`
  via a config plugin, or the `infoPlist` block). **Do not ship an iOS build
  without it.**
