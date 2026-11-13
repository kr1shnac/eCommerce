# Getting real sign-in working: the SMS path

**Status 2026-11-11: phone auth is OFF on the hosted project.** Probed directly:

```
POST /auth/v1/otp  {"phone":"+919000000001"}
→ 400 phone_provider_disabled  "Unsupported phone provider"
```

So **no customer, rider or owner can sign in at all.** This is the single
remaining launch blocker. Everything else on the list is either done or cosmetic.

> **Two projects now, and the rule that separates them (owner directive,
> 2026-11-13).** Create a **staging** Supabase project first. Everything in
> Step 1 — the dummy provider, the test numbers — happens on **staging, and
> only on staging**. The live project gets the real provider (Step 2) and
> **nothing from this step, ever**: its only test number is the one plain
> customer reviewer number described at the bottom, added by hand, only when
> the owner asks, with an expiry. No test number on the live project may ever
> be given the `admin` or `delivery` role — a test number is a door that
> bypasses SMS, and a door with the owner's powers is the worst door there is.

---

## Step 1 — Today, ~10 minutes: a test number so the app works end to end (STAGING ONLY)

This lets you sign in on a real phone with a code you choose, sends no SMS, and
costs nothing. Use it to prove the whole app on a device while the real SMS
wiring is being sorted out. **Every click below is in the STAGING dashboard.**

In the **staging** dashboard: **Authentication → Sign In / Providers → Phone**

1. **Toggle Phone to enabled.**
2. **Pick any SMS provider** and enter dummy values (e.g. Twilio with
   `AC00000000000000000000000000000000` / any token / any sender).
   Auth needs a provider *configured* even though it never sends anything to a
   test number.
3. **Test Phone Numbers and OTPs** — add, exactly like this, no `+`:

   ```
   919000000001=123456
   ```

4. **Test OTPs Valid Until** — set a date (the dashboard requires one).
   Pick something before launch, not after.
5. **Save.**

Then on the phone: sign in with **9000000001** and code **123456**. The
`+91` is added by the app itself (`normalisePhone()` in `login.tsx`), so type the
10 digits only.

> **Staging keeps its test numbers; the live project never gets one.** On
> staging the test numbers are fixtures — they are how every device run signs
> in, and staging holds no real customers, so a known code costs nothing. The
> live project's only exception is at the bottom of this file.

### While you're on that screen, change two settings

| Setting | Where | Change to | Why |
|---|---|---|---|
| **OTP expiry** | Phone provider | **10 minutes** (default is 1 hour) | An hour-old code in a village is a stale code. 10 minutes is long enough to walk to signal and short enough to stay safe. |
| **Rate limit for OTP requests** | Authentication → Rate Limits | leave at **60s** | The app's resend countdown is 60s to match. **If you lower it here, tell me and I'll lower the app's countdown to match** — otherwise the button appears before the server will accept a tap, and the customer is told "too many attempts" for waiting exactly as long as they were told to. |

---

## Step 2 — The real SMS provider (India: this is the long one)

For Indian numbers, **every commercial SMS — including OTP — must carry a TRAI
DLT registration.** This is not optional and it is the reason the whole thing
takes days rather than minutes. In order:

### 2a. DLT entity registration (2–7 working days, usually)

Register the **business** on any operator's DLT portal — Jio, Airtel, Vodafone
Idea and BSNL each run one and they share the ledger, so registering once is
enough. You will need:

- PAN of the business (or the proprietor)
- GST certificate, **or** a declaration if not GST-registered
- Address proof of the shop
- Authorised signatory's ID

### 2b. Sender ID (the "header")

A **6-letter alphabetic ID**, e.g. `KNGBAZ`. It is what shows above the SMS
instead of a phone number. Registered on the same portal.

### 2c. Template registration

The **exact message text**, approved before use. For login, something like:

```
Dear Customer, {#var#} is your OTP for Kunigal Bazaar sign-in. Valid for
{#var#} minutes. Do not share this with anyone. - KNGBAZ
```

The `{#var#}` markers must be declared and must match what Supabase actually
sends, or the operator drops the message. Supabase sends a fixed 6-digit code and
its own wording, so **check the template against Supabase's real message format
before submitting it** — a mismatch here is the single most common reason OTP
silently never arrives.

### 2d. Pick a provider and connect it

| Provider | Notes for India |
|---|---|
| **TextLocal** | Indian company, DLT-native, cheapest for domestic SMS, and the operator connections are already there. Community-supported by Supabase — works, but less battle-tested than Twilio. **Recommended for one shop.** |
| **Twilio** | Global, most reliable, best docs. Needs your DLT registration + sender ID + approved template wired to it. ~₹0.30–0.60 per SMS. You can also send via **WhatsApp** instead of SMS with Twilio, which sidesteps DLT entirely — worth considering. |
| **Vonage** | Global, similar shape to Twilio, no WhatsApp option. |

Paste the credentials into the same **Phone provider** screen.

---

## Two more things before real launch

- **CAPTCHA — now built, and this bullet is the one to read carefully.** The
  app-side gate is done and proved (`check:captcha`): a fresh token on the send,
  the resend and the verify, none of them skipped. **What is left is yours, and
  the order matters more than the doing.**

  1. Turnstile (Cloudflare, free) → *Add site* → copy the **Site Key** into
     `apps/mobile/.env` as `EXPO_PUBLIC_CAPTCHA_SITE_KEY=0x...` and restart with
     `npm run mobile -- -c`. On its own this changes nothing a customer sees,
     which is exactly why it is safe to do first.
  2. Only then, in Supabase: Authentication → Providers → Phone → *Enable
     CAPTCHA protection*, and paste the **Secret Key**.

  **Do not swap those two.** Once the switch is on, Supabase demands a token on
  every code request. Switching it on before the app can send one locks out
  **every customer**, not just the script the gate was built to stop. Full
  detail, and the one-click undo, is `PRODUCTION.md` §16.
- **The first sign-in.** Sign yourself up once — with your **own real phone**,
  never a test number — then set your own role:

  ```sql
  update public.profiles set role = 'admin'
   where id = (select id from auth.users where phone = '+91XXXXXXXXXX');
  ```

  After that the owner sets everyone else's roles from the Team tab in the app.
  Note this exact step is in `README.md` §4 — it has always been the plan.
  On the **live** project this SQL is the one and only role promotion that ever
  touches a number from this file's world, and it must be the shopkeeper's own
  phone. A test number is never promoted to `admin` or `delivery` on any
  project — on staging you may, because staging teaches nothing to a stranger;
  on the live project it would hand a bypass-SMS door the keys to the shop.

---

## The live project's list — shorter, and the owner's call

The live project (Kunigal Bazaar, `argahiagpywluxpqtnpp`) gets:

1. The **real provider** (Step 2, DLT and all), and **never** the dummy values
   from Step 1.
2. **No test numbers** — with one exception, added by hand, and only when the
   owner asks for it:
   - **ONE** plain customer reviewer number (a real phone somebody actually
     holds), entered in *Test Phone Numbers and OTPs* with the shortest expiry
     the dashboard accepts, and removed the day the review is done.
   - It stays a plain `customer` forever. No `update profiles set role` against
     it, ever — the reviewer tests the shop's front door, not the owner's.

If a test number is ever found on the live project outside that exception,
remove it the same hour and treat every order it placed as suspect: a number
that bypasses SMS is a number that bypasses every other gate too.

---

## What to send me when it's done

1. A screenshot of the STAGING Phone provider screen showing it **enabled** and
   the provider chosen (hide the credentials).
2. Confirmation that the **live** project has no test number at all (the
   reviewer number comes later, and only on your say-so).

Then I'll probe `/auth/v1/otp` again and confirm it answers with something other
than `phone_provider_disabled`, and we'll know the door is open.
