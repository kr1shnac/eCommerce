# Getting real sign-in working: the SMS path

**Status 2026-11-11: phone auth is OFF on the hosted project.** Probed directly:

```
POST /auth/v1/otp  {"phone":"+919000000001"}
→ 400 phone_provider_disabled  "Unsupported phone provider"
```

So **no customer, rider or owner can sign in at all.** This is the single
remaining launch blocker. Everything else on the list is either done or cosmetic.

There are two ways through, and you should do the first one **today**, because it
takes ten minutes and unblocks the device run immediately.

---

## Step 1 — Today, ~10 minutes: a test number so the app works end to end

This lets you sign in on a real phone with a code you choose, sends no SMS, and
costs nothing. Use it to prove the whole app on a device while the real SMS
wiring is being sorted out.

In the dashboard: **Authentication → Sign In / Providers → Phone**

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

> **Remove the test number before you launch.** Anybody who knows the number and
> the code can sign in as that user. It is a development door, and it must be
> shut.

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

- **CAPTCHA.** Supabase's own production checklist requires it, and it is the
  difference between a bad actor running up your SMS bill and them not being able
  to. Turnstile (Cloudflare) is free. **This needs a code change in the app** —
  tell me when you want it and it is a small one, but do not launch without it.
- **The first sign-in.** Sign yourself up once, then set your own role:

  ```sql
  update public.profiles set role = 'admin'
   where id = (select id from auth.users where phone = '+91XXXXXXXXXX');
  ```

  After that the owner sets everyone else's roles from the Team tab in the app.
  Note this exact step is in `README.md` §4 — it has always been the plan.

---

## What to send me when it's done

1. A screenshot of the Phone provider screen showing it **enabled** and the
   provider chosen (hide the credentials).
2. Whether the test number is still in place or removed.

Then I'll probe `/auth/v1/otp` again and confirm it answers with something other
than `phone_provider_disabled`, and we'll know the door is open.
