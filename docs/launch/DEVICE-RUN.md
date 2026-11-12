# The device run — everything needed, in order

**Status: ready as of 2026-11-11.** Sign-in works (a phone OTP was issued and
verified against the live project and a real session came back), the shelf has
six demo products, RLS is proved against a real session, and all gates are green.

> ## Expo Go is a dead end on this project — use a development build
>
> The project is on **Expo SDK 57**. Expo Go is now on **SDK 58**, and Expo ships
> Expo Go for the **latest SDK only**. There is no SDK 57 Expo Go to install, on
> iOS or Android — the `expo.dev/go?sdkVersion=57` URL just redirects to the
> latest. The error is unambiguous:
>
> ```
> Project is incompatible with this version of Expo Go
> The installed version of Expo Go is for SDK 58.0.0.
> The project you opened uses SDK 57.
> ```
>
> Upgrading to SDK 58 is a real migration — React Native 0.86 to 0.88, the Strict
> TypeScript API becomes the default, expo-router's navigation core is reworked,
> several React Native APIs are removed — and it is **Phase 8 work**, not a
> pre-device-run change.
>
> The correct path is the one Expo's own docs recommend for production projects:
> **a development build**. It is also strictly better here, because it runs the
> native modules Expo Go cannot, including the location screens.
> `apps/mobile/eas.json` now has a `development` profile for it.

---

## 1. Build the dev client (~15 min, free Expo account)

An Android phone is the easy start — **no Apple account, no store listing, and it
also runs the location screens.** (iOS works too but needs an Apple Developer
account for a physical device.)

```bash
npx eas-cli login          # or create a free account at expo.dev/signup
npx eas-cli build --profile development --platform android
```

First run prompts to create an EAS project — say yes. It builds in the cloud and
prints a URL; open that on the phone and install the APK. You now have your own
app with the dev tools built in.

## 2. Start Metro on the laptop

```bash
npm run mobile -- -c
```

`-c` clears the cache and you want it, because code has changed. Metro's heap is
already raised by `scripts/start-mobile.mjs` — no `NODE_OPTIONS` needed, and
`--tunnel` is unnecessary.

## 3. Open the app on the phone

Open the **dev client app** (not a browser). It finds Metro on the same Wi-Fi and
loads. Phone and laptop must be on the same network.

> The firewall is already fine: Node has an inbound **Allow** rule on the
> **Public** profile, which is what a phone hotspot is classified as. You do not
> need admin rights to change the network category.

## 4. Set the three test numbers, then sign in once as each

Test numbers live in the Supabase dashboard — **Authentication → Sign In /
Providers → Phone → Test Phone Numbers and OTPs**:

```
919611990869=123456,919000000002=123456,919000000003=123456
`

Then **sign in once as each number** — that is what creates the `auth.users` row
each role needs. Account tab → Sign out between each.

> The phone field was fixed on 2026-11-11: it used to eat a leading `9`, so
> typing `96…` displayed `6…`. If you still see that, the Metro cache is stale.



## What to walk through, and what's expected

### Customer (9611990869) — the important one

1. **Home** — the greeting, the location pill (should read `· 20 min`), the hero
   ETA, six products, both languages via the switch.
2. **Search** — type `ಹಾಲು` and `milk`; the Kannada name must match too. Then
   type something absent (`xyz`) and you should get the **"we don't have this,
   ring the shop"** row (A14).
3. **Product page** — the pack chips ("also in 1 kg"), the unit price (₹/kg).
4. **Cart** — change quantities, watch the free-delivery nudge change, try Save
   for later.
5. **Checkout** — add an address with **pincode 572130**, drop a door pin by
   long-pressing the map. COD only; Razorpay doesn't exist yet.
6. **Order** — the confirmation card should repeat item count, total, who and
   ETA. Then cancel it, which puts the stock back.

**Known-empty, and correct:** no orders before you place one, no favourites, the
offers rail empty (no coupons exist yet).

### Rider (9000000003)

The pool. Assign yourself, move `placed → confirmed → packing →
out_for_delivery`, then **delivered** or **failed** with a reason. The rider's own
phone dying mid-delivery is the designed fallback, not a bug.

### Owner (9000000002)

**Today** — the shop door card opens and closes the shop; close it and the
customer's checkout should refuse with "the shop is closed". **Shelf** — edit a
price and watch it change on the customer's phone. **Team** — set a role.
**Coupons** — create one with a per-customer cap, then check the Home offers rail
says "2 times per person".

---

## What is NOT ready, so you don't report it as a bug

- **No photos.** The six demo products have no `image_url` on purpose — the app's
  image fallback (the product emoji / placeholder) is what you're looking at.
- **Rider positions untested.** The location screens need the consent flow on a
  real GPS; Expo Go can exercise consent but the throttled fix loop has never run.
- **Map never rendered.** Pinch, the door-pin long-press and the OSRM route are
  proved as code and as arithmetic only.
- **No notifications.** Push is the next build, not this one.
- **Crash reporting** only captures JS errors in this build; native crashes need
  an EAS build.

---

## Cleaning up after the run

```bash
supabase db query --remote --file supabase/demo-catalogue-remove.sql --yes
```

That deletes exactly the six demo products and nothing else — the IDs are
deterministic, so a product you add by hand from the Shelf tab cannot be caught.

**Remove the three test numbers before launch**, and **CAPTCHA is still not
wired** — until it is, the OTP endpoint can be hammered.
