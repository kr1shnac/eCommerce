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
| Node.js | 20.19+ or 22+ | 22 LTS is what CI uses; `node -v` to check |
| npm | 10+ | ships with Node |
| Git | any | for cloning and for the `.gitattributes` line-ending rules |
| Expo Go app | latest | on your Android phone, from the Play Store |
| Android Studio | optional | only for an emulator on your PC |
| Supabase project | free tier is fine | you need the project URL + publishable/anon key |
| PostgreSQL | 16 recommended | **only** for `npm run test:db`; the runner boots its own throwaway cluster and finds PostgreSQL automatically |

macOS is required only for running on an iPhone. Everything else works on
Windows, macOS and Linux. **Moving this project to a new machine?** Read
[`HANDOFF.md`](./HANDOFF.md) first — it is the checklist for what to carry over
(the `.env` files are deliberately not in Git) and what is still unfinished.

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
2. Open **Project Settings → API** (or **Data API**).
3. Copy the **Project URL** and the **public** key. Supabase now calls it the
   **publishable** key (`sb_publishable_...`); older projects call it the
   **anon public** key. Either works — both apps accept both names.
4. Open `apps/mobile/.env` and paste them in:

   ```ini
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_....your-public-key....
   ```

   `apps/mobile/.env` is git-ignored. `apps/mobile/.env.example` is the
   committed template.

5. Open `apps/admin/.env` and paste the same two values with the admin panel's
   names (also git-ignored; `apps/admin/.env.example` is the template):

   ```ini
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_....your-public-key....
   ```

> **Never put the `service_role` / `sb_secret_...` key in either app.** Anything
> named `EXPO_PUBLIC_*` or `NEXT_PUBLIC_*` ships to the user, and a secret key
> bypasses every Row Level Security policy.

> **Never put the `service_role` key in this file.** Anything in an
> `EXPO_PUBLIC_` variable is compiled into the shipped app and can be read by
> anyone who installs it. `service_role` bypasses every security policy.

---

## 4. Create the database

### Option A — dashboard (no extra tools, recommended)

1. Go to **SQL Editor → New query**.
2. Open every file in `supabase/migrations/` and run them **in filename order**.
   The list is simply `ls supabase/migrations` sorted
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
   20261014000002_favourites.sql
   20261014000003_address_one_default.sql
   20261014000004_coupons.sql
   20261020000001_account_deletion.sql
   20261020000002_shop_identity.sql
   20261021000001_order_tracker.sql
   20261021000002_shop_totals.sql
   20261021000003_product_guard.sql
   20261021000004_pack_sizes.sql
   20261021000005_create_product.sql
   20261021000006_my_name.sql
   20261026000001_rider_positions.sql
   ```

   That is the whole list. If the hosted project already has some of them,
   apply only the missing ones; never edit a migration that has already run.

3. Open `supabase/seed.sql`, paste it, **Run**. This adds 1 store, 8 categories,
   34 products (English + Kannada names, a per-product `emoji`), 2 coupons, 4
   delivery zones and the store settings.
4. **Table Editor** should now show `products` with 34 rows.
5. *(Optional, development only)* Open `supabase/demo.sql`, paste it, **Run**.
   **Never run it on a production project.** It needs your profile to exist, so
   sign in once in the app first. It dresses the first customer profile (falling
   back to the first profile of any role) so every screen is alive:

   - **25 orders** — the recent ones cover every status (2 waiting to be accepted,
     one each of confirmed / packing / out for delivery, 2 delivered, 1 cancelled)
     and the rest are delivered history spread over the last few weeks, so the
     owner's totals and the customer's order list both have something to show.
     The in-flight ones are already assigned to a rider if one exists;
   - **one order carrying a coupon discount** (KUNIGAL50), so the discount line
     is visible somewhere — the number comes from the database, not the file;
   - **5 favourites**, so the Home **Saved** rail is not empty;
   - **a second (Work) address**, so checkout's address picker has a choice.

   It is safe to re-run: it deletes its own orders first (the ones with
   `idempotency_key like 'demo-order-%'`) and rewrites the shortlist, so a
   second run replaces the sample data rather than stacking it.

   **To remove the demo data later** (this keeps the catalogue, coupons, zones
   and settings):

   ```sql
   delete from public.orders     where idempotency_key like 'demo-order-%';
   delete from public.favourites where user_id = '<the demo customer uuid>';
   -- then delete the extra "Work" address in the app's Addresses screen.
   ```

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

### On Windows specifically

- Use **Node 22 LTS**. If `npm` is blocked by PowerShell's execution policy, run
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once, or use `npm.cmd`.
- Windows Defender Firewall may ask about Node.js the first time Metro starts.
  Allow it on **private networks**, otherwise the phone cannot reach the dev
  server. Phone and laptop must be on the same Wi-Fi.
- If the QR code still cannot connect, Metro can tunnel:
  `npx expo start --tunnel` (adds `@expo/ngrok` on first use).
- Clone to a short path such as `C:\dev\eCommerce`. Deep `node_modules` paths can
  exceed the old 260-character Windows limit.
- `npm run test:db` needs the PostgreSQL **binaries**, not a running service.
  Install PostgreSQL 16 (EDB installer) and the runner finds
  `C:\Program Files\PostgreSQL\16\bin` itself. If it is somewhere else, set
  `PGBIN` for that terminal. See `HANDOFF.md` §4 for the exact commands.

---

## 6. What you should see

**Home tab**
- Header: the shop's horse mark and wordmark, a **sun/moon** theme toggle and an
  **English / ಕನ್ನಡ** switcher.
- A row of category chips: **All**, then 8 categories with emoji icons.
- A two-column grid of product cards. Each card shows a large tile: a real
  photograph where one has been sourced (28 of the 34 products, loaded by
  `supabase/demo-images.sql` in development), and the product's own emoji as the
  fallback where it has not — the emoji is not a stopgap, it is why a tomato
  still looks like a tomato on a phone whose owner cannot read the name. The card
  then shows the product name, the pack size, and a green price such as
  **₹18.00** with a struck-through MRP and a discount badge.
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
npm run lint          # eslint in both apps + nine chained safety checks
npm run check:i18n    # en/kn key parity + every key used in code exists
npm run check:session # the signed-in session survives an app restart
npm run check:auth-doors # a release build has no dev login, the review build has one
npm run check:view    # the address/time helpers all three faces share
npm run check:persist # only public shop data is written to the device
npm run check:speech  # the Kannada speech rules and spoken-price formatter
npm run check:packs   # pack sizes and the money arithmetic that must never round
npm run check:storage # only src/lib/storage.ts may touch AsyncStorage
npm run check:location # only src/lib/location.ts may touch expo-location
npm run check:tracking # the rider throttle, staleness and ETA rules
npm run test:db        # all database tests against a throwaway PostgreSQL 16
```

`npm run test:db` works on Windows, macOS and Linux. It starts its own
PostgreSQL cluster in the OS temp directory on a free localhost port, applies
every migration in filename order, loads the seed and fixtures, runs all 23 SQL
test files plus the two-session concurrency race, and deletes the cluster. It never
touches the PostgreSQL service installed on the machine, and it does not need
Docker. If PostgreSQL is not installed, it prints the installer link and exits
without changing anything.

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
- **Getting it onto a phone and into a store is its own plan.** See
  [`PRODUCTION.md`](./PRODUCTION.md) — the phases, the Play/App Store calendar,
  and the statutory work (privacy policy, FSSAI, Legal Metrology, GST, DPDP) that
  has to happen before a public release. `apps/mobile/eas.json` holds the build
  profiles.
