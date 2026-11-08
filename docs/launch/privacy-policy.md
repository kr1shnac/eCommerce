# Privacy Policy — Kunigal Grocery (hosted draft)

> **Status: draft for publishing at `<shopname>.in/privacy` after
> `TODO(CA)` sign-off. Every field marked `TODO(…)` must be filled by the owner
> or the accountant — nothing here may be guessed.** This draft mirrors the
> notice already shipping **in-app in both languages** (`privacy.*` in
> `en.json`/`kn.json`), so the hosted page and the app say the same thing, and
> adds only what a hosted policy must additionally carry (who the controller is,
> how to contact them, who the third parties are, where the data is hosted).

**Last updated:** `TODO(OWNER)` (date of publication)

## English

### 1. Who this app belongs to

`TODO(OWNER)` Shop name, full street address, and the shop's phone number, as
they appear on the shop's signage. These must match the certificate/licence
documents. This app is the shop's own ordering app: one shop, one town, run by
the people who work the counter.

### 2. What we collect

| What | Why | When it is deleted |
|---|---|---|
| Your **phone number** | It is how you sign in (a one-time code by SMS) and how the shop or the rider reaches you | When you delete your account |
| The **name and delivery address** you give us | So the bag reaches you. The landmark matters more than the house number in this town; a **map pin** is optional and only if you drop one | When you delete your account, or when you edit/delete the address |
| Your **orders and their items** | To show you your history and to keep the shop's accounts (the order carries a snapshot of the address and prices so history cannot be rewritten later) | The bare record of past orders (order number, items, amounts) is kept after account deletion, without anything that says who you are — a shop must be able to show its sales |
| The **rider's location** while an order is on its way | So you can see who is coming and when | Deleted the moment the delivery closes; a position older than 10 minutes is never shown |
| **Product photos** the shop adds | The shelf you browse | With the product |
| **Crash reports** (if sending is enabled) | So a broken screen gets fixed, not just met with | Sentry's retention; these carry **no name, phone, address or cookies** |
| **Notification token** (if we add notifications) | To buzz your phone about your order | When you sign out or delete your account |

That is everything. **We do not run analytics. We do not show advertising. We do
not sell your information to anyone.**

### 3. Who sees it

The shop, and the rider carrying your order. The rider sees your address **only
while your order is on its way**. No advertising network, no data broker, no one
else.

### 4. Third parties the app genuinely talks to

| Service | What it sees | Why |
|---|---|---|
| **Supabase** (our database, sign-in and file storage) | Everything the shop holds, on their servers `TODO(OWNER)` confirm the project region (the closest region to Karnataka) | It is where the shop's data lives |
| **The SMS provider** that sends your sign-in code `TODO(OWNER)` name it once chosen | Your phone number, for the code | Sign-in |
| **Sentry** | Crash diagnostics with personal details stripped | Fixing bugs |
| **OpenStreetMap tiles and the OSRM router** | Map requests (which includes your internet address and the map area you looked at) | The map on the order screen |

We do not use these services for advertising, and we cannot sell your data we
never hold for sale.

### 5. Your rights, in one place

You can see what we hold (call the shop), correct it, and erase it. The **erase
button is inside the app**: Account → *Delete my account* — it works immediately,
and afterwards the shop's order history no longer says who you are. You can also
call the shop and ask us to do it for you.

### 6. Complaints

`TODO(OWNER)` A named contact person and phone number for complaints, and
`TODO(CA)` the grievance-officer details required under the Digital Personal Data
Protection Act 2023 and its 2025 Rules (a person may be the same shop owner; the
Rules require a reachable contact — the CA confirms the wording and any
additional disclosures).

### 7. Children

The app sells groceries; it is not directed at children and collects nothing
from them beyond an order a household places.

### 8. Changes

The shop updates this page when the app changes. The "last updated" date on this
page is the only thing that tells you it did; the notice inside the app changes
with it, in both languages.

---

## ಕನ್ನಡ (ಆಪ್‌ನಲ್ಲೇ ಇರುವ ನೋಟೀಸ್ — ಹೋಸ್ಟ್ ಮಾಡುವ ಪುಟಕ್ಕೆ ಇದನ್ನೇ ಬಳಸಿ)

`TODO(OWNER)` The Kannada version of the hosted page must be a faithful
Kannada rendering of the above — but the **in-app notice already exists in both
languages** (`privacy.*` in `kn.json`, written in the Kunigal voice: `ಫೋನ್ ಸಂಖ್ಯೆ,
ಡೆಲಿವರಿ ವಿಳಾಸ, ಆರ್ಡರ್‌ಗಳು`), so the hosted Kannada page should reuse those exact
sentences. Per the DPDP Rules the notice must be available in English **or** an
Eighth-Schedule language; Kannada is one, and this shop's customers should find
the Kannada copy first. The CA confirms the legal paragraphs (5–6) in Kannada.

---

### Publishing checklist

- [ ] `TODO(OWNER)` Shop name, address, phone filled in (§1) and matching the
      licence documents
- [ ] `TODO(OWNER)` Supabase region + SMS provider named (§4)
- [ ] `TODO(CA)` §5–6 wording checked against DPDP Act 2023 / Rules 2025
- [ ] `TODO(OWNER)` Kannada copy written/reviewed by a Kunigal local (M7)
- [ ] `DEV` Publish at `<shopname>.in/privacy`; put the URL in both store listings
      and point the app's privacy screen at it if a link is added
- [ ] `DEV` Set the "Last updated" date and keep the in-app copy in step
