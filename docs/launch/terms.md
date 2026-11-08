# Terms of Use — Kunigal Grocery (hosted draft)

> **Status: draft for `<shopname>.in/terms` after `TODO(CA)` sign-off.** A
> one-shop app needs terms that are short, plain and true — the in-app notice
> (`privacy.termsBody`, both languages) is the plain-language core; this page is
> the same statement with the parts a hosted page carries. Kannada copy notes at
> the bottom.

**Last updated:** `TODO(OWNER)` (date of publication)

## English

### 1. The shop, and what this app is

`TODO(OWNER)` Shop name, address, phone. This app lets you order from that one
shop for delivery in the town and pincodes it serves. Prices and stock shown
come from the shop and can change. **The price you are charged is the one
confirmed when you place the order** — the app only ever *shows* a price; the
shop's own till decides what you pay.

### 2. Placing an order

An order is an offer to buy, which the shop accepts by packing it and sending it.
The shop may decline an order it cannot fulfil (out of stock, outside the served
pincodes, a phone we cannot reach) and will tell you why. Delivery is only to the
pincodes shown at checkout.

### 3. Payment

**Cash on delivery when the rider arrives.** `TODO(OWNER+CA)` If online payment is
ever added (Razorpay/UPI), it will be described here exactly as it behaves —
including how refunds work, and the settlement time. No payment method is claimed
in this document before it exists in the app.

### 4. Delivery, and honest endings

A rider is assigned to every order and you can see their name, photo and call
them. A delivery can also **fail** — nobody home, wrong address, refused — and
the app says so plainly, with the reason, instead of quietly calling it
"delivered". If a delivery fails, nothing is charged and you can call the shop
and it will be sent again.

### 5. What you owe us — and what we owe you

Keep your phone reachable, and tell the shop if you change your number (the app
explains this path itself, because with sign-in-by-phone the number *is* the
account). The shop owes you: the goods as ordered, its licence numbers shown
where required, and your money back for anything paid but not delivered — the
order screen shows the amount owed when that happens.

### 6. Cancelling and deleting

You can cancel while the order is still `placed`, from the order screen. You can
delete your account and its data at any time — Account → *Delete my account* —
and past orders stop being about you without the shop losing its sales records.

### 7. The shop's property

The shop's name, logo and product information belong to the shop. The app itself
is `TODO(OWNER+DEV)` — decide the licence before this is shared (`LICENSE` in the
repository). Nothing here gives the shop rights over your data beyond §1 of the
privacy policy.

### 8. Governing law and contact

`TODO(CA)` The state and courts that govern (Karnataka is the obvious answer for
a Kunigal shop — the CA confirms the wording), and the contact email/phone for
anything to do with these terms. **Call the shop** remains the fastest route for
everything that is not a legal notice.

---

### Kannada

The in-app Kannada (`privacy.termsBody`) is already written in the shop's own
voice — `ಇಲ್ಲಿ ಕಾಣುವ ಬೆಲೆ ಮತ್ತು ಸಾಮಾನು ಅಂಗಡಿಯದ್ದು, ಬದಲಾಗಬಹುದು…` — and it is the
copy a Kunigal customer should read first. `TODO(OWNER)` Have the local reviewer
(M7) read both pages aloud before publishing; `TODO(CA)` confirms §8 in Kannada.

### Publishing checklist

- [ ] `TODO(OWNER)` Shop identity (§1, §8) filled in
- [ ] `TODO(CA)` §8 governing-law wording; confirm no section claims a payment
      method that does not exist yet
- [ ] `TODO(OWNER)` Kannada read-through and sign-off (M7)
- [ ] `DEV` Publish at `<shopname>.in/terms`, link from both listings
