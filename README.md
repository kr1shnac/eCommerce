# Kunigal Grocery — delivery app

Groceries and essentials delivery for Kunigal, Karnataka. An Expo app for
shoppers, a Next.js panel for the shop owner, and a Supabase (Postgres) backend
with Row Level Security.

English and Kannada are supported from day one. All money is stored as integer
paise — never rupees, never floats.

---

## 1. Requirements

| Need | Version | Notes |
| ---- | ------- | ----- |
| Node.js | 20.19+ or 22+ | `node -v` to check |
| npm | 10+ | ships with Node |
| Expo Go app | latest | on your Android phone, from the Play Store |
| Android Studio | optional | only for an emulator on your PC |
| Supabase project | free tier is fine | you need the project URL + anon key |

macOS is required only for running on an iPhone. Everything else works on
Windows, macOS and Linux.

---

## 2. Install

From the **repository root**:

```bash
npm install
```

This is an npm workspace, so one install covers the mobile app and the admin
panel. Do **not** run `npm install` inside `apps/`.

---

## 3. Point the app at your Supabase project

1. Create a project at <https://supabase.com> (or use an existing one).
2. Open **Project Settings → Data API**.
3. Copy the **Project URL** and the **anon public** key.
4. Open `apps/mobile/.env` and paste them in:

   ```ini
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi....your-anon-key....
   ```

   `apps/mobile/.env` is git-ignored. `apps/mobile/.env.example` is the
   committed template.

> **Never put the `service_role` key in this file.** Anything in an
> `EXPO_PUBLIC_` variable is compiled into the shipped app and can be read by
> anyone who installs it. `service_role` bypasses every security policy.

---

## 4. Create the database

### Option A — dashboard (no extra tools, recommended)

1. Go to **SQL Editor → New query**.
2. Open every file in `supabase/migrations/` and run them **in filename order**.
   There are 14 files; the list is simply `ls supabase/migrations` sorted
   alphabetically:

   ```
   20261002000001_foundation.sql
   20261002000002_profiles.sql
   20261002000003_catalog.sql
   20261002000004_addresses.sql
   20261002000005_orders.sql
   20261002000006_row_level_security.sql
   20261002000007_grants_and_indexes.sql
   20261002000008_place_order.sql
   20261002000009_line_item_price_guard.sql
   20261003000001_images_and_history.sql
   20261003000002_db_constraints.sql
   20261013000001_rider_assignment.sql
   20261013000002_realtime_orders.sql
   20261014000001_product_emoji.sql
   ```

3. Open `supabase/seed.sql`, paste it, **Run**. This adds 1 store, 8 categories
   and 34 products with English + Kannada names and a per-product `emoji`.
4. **Table Editor** should now show `products` with 34 rows.
5. *(Optional, development only)* Open `supabase/demo.sql`, paste it, **Run**.
   It needs your profile to exist, so sign in once in the app first. It creates
   8 orders across every status, assigns some to a rider, and gives the customer
   a Kunigal address — enough to make all three faces look alive. **Never run it
   on a production project.** Safe to re-run; it cleans up its own orders first.

### Option B — Supabase CLI

```bash
npm install -g supabase
supabase login
supabase init
supabase link --project-ref YOUR-PROJECT-REF
supabase db push
psql "$DATABASE_URL" -f supabase/seed.sql
```

### Option C — local Supabase (free, no cloud project)

```bash
npm install -g supabase
supabase start          # Docker required
supabase db reset       # applies every migration + seed.sql
```

### Choose your role (admin, rider, or customer)

Sign up once in the app, then in **SQL Editor** set the role. It decides which
face of the app that account sees:

```sql
update public.profiles
set role = 'admin'          -- 'admin' = shop owner, 'delivery' = rider
where id = '<paste-the-user-uuid-here>';
```

You can find the uuid in **Authentication → Users**. After the first owner
exists, they can set everyone else's role from the app's **Team** tab.

---

## 5. Run the mobile app

### On a real Android phone (easiest)

1. Install **Expo Go** from the Play Store.
2. Phone and computer on the **same Wi-Fi network**.
3. From the repo root:

   ```bash
   npm run mobile
   ```

4. Scan the QR code in the terminal with the Expo Go app.
5. Press `a` in the terminal to open on a connected device instead of scanning.

### On an Android emulator

1. Install [Android Studio](https://developer.android.com/studio) and create an
   AVD (Pixel 7, API 34+).
2. Start the emulator.
3. From the repo root:

   ```bash
   npm run mobile:android
   ```

### On iOS (macOS only)

```bash
npm run mobile:ios
```

### In a browser (fastest way to check the layout)

```bash
npm run mobile:web
```

### Both apps at once

```bash
npm run dev          # mobile dev server + admin panel on http://localhost:3000
```

> After editing `.env`, restart with `npm run mobile -- -c`. The `-c` clears
> the Metro cache, because env values are inlined at bundle time.

---

## 6. What you should see

**Home tab**
- Header: the shop's horse mark and wordmark, a **sun/moon** theme toggle and an
  **English / ಕನ್ನಡ** switcher.
- A row of category chips: **All**, then 8 categories with emoji icons.
- A two-column grid of product cards. Each card shows a large emoji tile (the
  shop has no product photos on purpose — a tomato has to *look* like a tomato),
  the product name, the pack size, and a green price such as **₹18.00** with a
  struck-through MRP and a discount badge.
- Add an item and a **basket bar** rises from the bottom — "3 items · ₹120 →
  View basket" — so paying is always one tap away from the shelf.
- Pull down to refresh.

**Other tabs**
- **Cart** — add items from Home, adjust quantities, see the subtotal and any
  "your cart changed" notices. **Checkout** chooses an address (or adds one),
  shows the delivery fee, and places the order with one big green button.
- **Orders** — your order history with status badges and filters
  (All / Active / Done); tap one for its tracker, items and total, or **Reorder**.
- **Account** — your profile, the **Appearance** switch (System / Light / Dark),
  the **English / ಕನ್ನಡ** switcher, and Call-the-shop.

**Light and dark.** Every screen is designed twice. Light is a warm cream page
with white cards; dark is a soft charcoal, not black. Follow the phone by
default, or pin it in Account.

**Try this**
1. Tap **Dairy & Milk** — the grid filters to 4 products.
2. Tap **ಕನ್ನಡ** in Account, then go back to Home — every name, chip and tab
   label is now in Kannada, and the choice survives an app restart.
3. Find **Paneer** — it is seeded with `stock_qty = 0` on purpose and shows a
   red "Out of stock" label.
4. Stop the dev server, or turn off Wi-Fi — Home shows a "Could not load the
   catalogue" message with a **Retry** button.

**The two staff faces** (same app, different login)
- Sign in as a user whose `profiles.role = 'delivery'` → the **Deliveries**
  screen: a waiting pool to accept from, your own deliveries with a single
  "next step" button and a Call button, and today's delivered count.
- Sign in as `profiles.role = 'admin'` → the **shop board**: live orders, rider
  assignment, and a **Team** tab to set people's roles. The storefront icon in
  the header switches to the customer view.

---

## 7. Everyday commands

```bash
npm run mobile        # Expo dev server
npm run mobile:android
npm run mobile:ios
npm run mobile:web
npm run admin         # Next.js on http://localhost:3000
npm run dev           # both at once

npm run typecheck     # tsc --noEmit in both apps
npm run lint          # eslint in both apps, then the i18n key check
npm run check:i18n    # en/kn key parity + every key used in code exists
npm run test:db       # all database tests against a throwaway PostgreSQL 16
```

---

## 8. How the code is organised

See [`AGENTS.md`](./AGENTS.md) for the full rules. The short version:

- **Money is integer paise.** `apps/mobile/src/lib/money.ts` is the only place
  paise become a rupee string.
- **Two languages, no hard-coded strings.** UI text lives in
  `apps/mobile/src/i18n/locales/{en,kn}.json`; database text has `name_en` and
  `name_kn` columns. Components use `t('key')` and `localizedName(row)`.
- **Security is in the database, not the app.** Every table has Row Level
  Security; a customer can only read their own addresses and orders.
- **Multiple shops are already supported.** Every product, order and setting row
  carries a `store_id`, so adding a second shop is data, not a rewrite.
