# Delete your account (hosted page draft)

> **Status: draft for `<shopname>.in/delete-account`.** Google Play requires
> apps that allow account creation to provide a reachable **account-deletion
> URL** in the listing. The app already deletes the account and its data from
> inside the app, immediately, in both languages — this page is the web door for
> anyone who asks for it from a browser or a store listing. `TODO(OWNER)` fill
> the bracketed details before publishing; the delete button in the app needs no
> browser.

---

## English

# Delete your account — `TODO(OWNER)` `[Shop name]`

You can delete your account from the app itself, and it happens immediately:

1. Open **Kunigal Grocery** on your phone.
2. Go to **Account** (ಖಾತೆ).
3. Tap **Delete my account** (ಖಾತೆ ಅಳಿಸಿ) and confirm.

**What gets erased:** your name, your phone number, your saved addresses, your
saved items and favourites, and any location shared while an order was on its
way. After deletion the sign-in code that was sent to your number no longer opens
an account.

**What stays, and why:** the shop keeps the bare record of past orders — the
order number, the items and the amounts — because a shop must be able to show its
sales. After deletion those records no longer say who you are.

**Prefer to ask us to do it?** Call the shop on `TODO(OWNER)` `[shop phone]` with
your phone number, and we will delete it for you.

**Questions or complaints:** `TODO(OWNER)` `[complaint contact — the DPDP
grievance contact chosen with the CA, see privacy-policy.md §6]`.

---

## ಕನ್ನಡ

# ನಿಮ್ಮ ಖಾತೆ ಅಳಿಸಿ — `TODO(OWNER)` `[ಅಂಗಡಿಯ ಹೆಸರು]`

ಆಪ್‌ನಲ್ಲೇ ನಿಮ್ಮ ಖಾತೆ ಅಳಿಸಬಹುದು, ಮತ್ತು ಅದು ಕೂಡಲೇ ಆಗುತ್ತದೆ:

1. ಫೋನ್‌ನಲ್ಲಿ **ಕುಣಿಗಲ ಗ್ರೋಸರಿ** ತೆರೆಯಿರಿ.
2. **ಖಾತೆ** ಪುಟಕ್ಕೆ ಹೋಗಿ.
3. **ಖಾತೆ ಅಳಿಸಿ** ಒತ್ತಿ, ದೃಢಪಡಿಸಿ.

**ಏನು ಅಳಿಸಿಹೋಗುತ್ತದೆ:** ನಿಮ್ಮ ಹೆಸರು, ಫೋನ್ ಸಂಖ್ಯೆ, ಉಳಿಸಿದ ವಿಳಾಸಗಳು, ಉಳಿಸಿದ
ಸಾಮಾನು ಮತ್ತು ಇಷ್ಟದ ಐಟಂಗಳು, ಮತ್ತು ಆರ್ಡರ್ ದಾರಿಯಲ್ಲಿದ್ದಾಗ ಹಂಚಿಕೆಯಾದ ಸ್ಥಳ.

**ಏನು ಉಳಿಯುತ್ತದೆ, ಏಕೆ:** ಹಿಂದಿನ ಆರ್ಡರ್‌ಗಳ ಬರಿ ದಾಖಲೆ — ಆರ್ಡರ್ ಸಂಖ್ಯೆ, ಸಾಮಾನು ಮತ್ತು
ಮೊತ್ತ — ಉಳಿಯುತ್ತದೆ, ಏಕೆಂದರೆ ಅಂಗಡಿ ತನ್ನ ಮಾರಾಟ ತೋರಿಸಬೇಕು. ಅಳಿಸಿದ ಮೇಲೆ ಆ ದಾಖಲೆಗಳಲ್ಲಿ
ನೀವು ಯಾರು ಎಂದು ಇರುವುದಿಲ್ಲ.

**ನಾವು ಅಳಿಸಬೇಕೆಂದರೆ:** ನಿಮ್ಮ ಫೋನ್ ಸಂಖ್ಯೆ ಹೇಳಿ ಅಂಗಡಿಗೆ ಕರೆ ಮಾಡಿ —
`TODO(OWNER)` `[ಅಂಗಡಿಯ ಫೋನ್]` — ನಾವು ಅಳಿಸಿ ಹಾಕುತ್ತೇವೆ.

**ಪ್ರಶ್ನೆ ಅಥವಾ ದೂರು:** `TODO(OWNER)` `[ದೂರು ಸಂಪರ್ಕ]`.

---

### Publishing checklist

- [ ] `TODO(OWNER)` Shop name, phone, complaint contact filled in (both languages)
- [ ] `DEV` Publish at `<shopname>.in/delete-account`; put the URL in the Play
      listing's **account-deletion** field and in the data-safety declaration
- [ ] `DEV` The URL must stay reachable for the life of the app — fold it into the
      same hosting as the privacy policy, one renewal, one owner
