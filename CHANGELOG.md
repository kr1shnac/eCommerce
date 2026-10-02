# Build log

Newest first. Append a dated section after each working session, and be honest in
it: what was verified and *how*, decisions with their reasons, bugs found, and
the gaps you know about. A future session reads this file first.

---

## 2026-10-03 — Fixed 02_place_order_test.sql; rebuilt the permissions test set

### The bug that was reported

`supabase/tests/02_place_order_test.sql` failed under `./supabase/tests/run.sh`.
Earlier notes in this repo guessed at the cause. This session did not guess; it
read the bytes and bisected the migrations.

**Root cause: the file was not SQL at all.** All 198 bytes of it were the stderr
output of a botched `git checkout`, saved over the test file:

```
fatal: path 'supabase/tests/02_place_order_test.sql' exists, but not '02_place_order_test.sql'
hint: Did you mean 'HEAD:supabase/tests/02_place_order_test.sql' aka 'HEAD:./02_place_order_test.sql'?
```

`od -c` confirmed there is not one byte of SQL in the file. Two stray artifacts
from that same session, `02_place_order_test.sql.clean` and
`02_place_order_test.sql.fixed`, held identical copies of the same garbage — the
".fixed" file was byte-identical to the committed version, so the previous fix
attempt had changed nothing. Both were deleted.

### Migration 20261003000002 was NOT the cause of this failure

Proved by moving the migration out of the way and re-running:

```
$ mv supabase/migrations/20261003000002_db_constraints.sql /tmp/
$ ./supabase/tests/run.sh
--- test 02_place_order_test.sql
    psql:.../02_place_order_test.sql:2: ERROR:  syntax error at or near "fatal"
    LINE 1: fatal: path 'supabase/tests/02_place_order_test.sql' exists,...
            ^
!!! test 02_place_order_test.sql failed
```

Byte-identical failure with the migration absent. The migration was moved back
immediately and `git status supabase/migrations/` was empty afterwards.

### The real second bug: a deleted block, committed broken

`git checkout HEAD -- ...` restored the 550-line file, which then failed with a
*genuine* syntax error at line 34. The cause was visible in the committed
history — `bfa7cc0` and `3569ec4` both contain the damage, so it predates this
session's work:

```
23: (blank)
24: (blank)
25: ;
26: $$;
```

Section 1 of the file had been deleted, leaving an orphan `;` and an orphan
`$$;`. Proof it was exactly one block: 16 `do $$` openers against 17 `$$;`
closers, and exactly one bare `;` line in the file.

Section 1 was reconstructed, not guessed at. Two things in the surviving file
proved what it must have contained:

1. Section 2 (`public.place_order(...)` at line 32 of the damaged file) has no
   `set role authenticated` and no `sign_in` of its own. It was relying on
   section 1 having left the session signed in, so section 1 held the role setup.
2. After restoring it, the first run failed with
   `null value in column "suite" of relation "assertions"`. `psql` gives each
   file a fresh session, so the suite name does not carry over from the fixtures
   file. Section 1 therefore also held
   `select test_result.begin_suite('02 place_order')`.

The reconstructed section 1 is the happy path: 2 x Tomato (1800) + 3 x Onion
(2600) = 11400 paise, over the 10000 minimum, into Asha's Kunigal address
(pincode 571915, zone fee 1500), total 12900. Eight assertions covering the
subtotal, the zone fee, the total, the order landing as `placed`, two line items
being written, and both stock decrements (40 -> 38, 60 -> 57). All eight pass.

**Honest caveat:** the *original* wording of section 1's assertions is
unrecoverable — it was deleted before the first commit. These are new assertions
written to match the file's style, not recovered text. They are not the original
happy-path test; they are a replacement for it.

### The real third bug: a test the new constraint silently broke

Once 02 ran, four failures appeared in `04_concurrency_test.sh` — all
`below_minimum`. That one *was* caused by migration 20261003000002, but not in
the way the first bug was:

```
$ psql -c "update public.products set stock_qty = 1, is_active = true, price_paise = 12000 where id = '...ffff';"
ERROR:  new row for relation "products" violates check constraint "products_mrp_paise_ge_price"
DETAIL:  Failing row contains (..., 12000, 1200, 1 kg, 1, ...)
```

The script raises the contested mango to 12000 paise so a single packet clears
the Rs 100 minimum, but the fixture mango is seeded at `mrp_paise = 1200`. The
new constraint requires `mrp_paise >= price_paise`, so the whole setup UPDATE was
refused — and the script runs `set -uo pipefail` with **no `-e`**, so it carried
on regardless. The price stayed at 1000, every caller was refused with
`below_minimum`, and the race under test never started. Four confusing assertion
failures a long way from a one-line setup problem.

**Fixed by changing the test data, not the constraint** (authorised): the setup
now sets `mrp_paise = 15000` alongside `price_paise = 12000`. No constraint was
dropped or weakened.

Also added a setup guard to that script, so this class of failure is loud next
time instead of surfacing four misleading assertion failures:

```
setup_price="$(psql_q -t -A -c "select price_paise from public.products where id = '$MANGO';")"
if [ "$setup_price" != "12000" ]; then ... exit 1; fi
assert 1 "race: the contested mango was really priced above the shop minimum"
```

### Tests re-created

The four `05_*` files from `bfa7cc0` / `3569ec4` were scaffolds, not tests. They
called `ASSERT(...)`, which is not a PL/pgSQL function anywhere in this project
(the harness provides `test_result.ok` / `eq` / `refused` / `touches`), so each
one aborted on its first statement. They also granted themselves admin by writing
`raw_user_meta_data.role`, which is not where roles live — `profiles.role` is,
and only an admin may change that (`profiles_guard_role`). They recorded nothing
into `test_result.assertions`, so even if they had run they would not have
counted. They were replaced, not merely deleted:

- `05_admin_writes_test.sql` — 27 assertions. Only the shop owner may write
  `products`, `categories`, `store_settings`, `delivery_zones`. For each table:
  customer refused, rider refused, owner allowed *and proved by row count*, then
  a final owner-level re-read proving nothing slipped in.
- `06_db_constraints_test.sql` — 16 assertions. `price_paise > 0`,
  `mrp_paise >= price_paise`, `stock_qty >= 0`, on INSERT and on UPDATE, plus a
  whole group proving the **shop owner cannot get past them either**. A CHECK
  constraint is not a permission; if the only thing stopping a negative price
  were the admin panel's input validation, one bad deploy would put one on the
  shelf.
- `07_settings_pincode_test.sql` — 25 assertions. Negative minimum order,
  delivery fee, free-delivery threshold and low-stock threshold; backwards
  opening hours; and pincode shape — 5 digits, 7 digits, letters, leading space,
  trailing space, empty, all rejected, 6 digits accepted.
- `08_product_images_storage_test.sql` — 22 assertions. The four
  `product-images` policies: public read, admin-only write/update/delete, and
  `bucket_id` checked so being an admin is not a pass into every bucket in the
  project.

Every refusal is pinned to a sqlstate (`23514` check_violation, `42501`
insufficient_privilege) so a test cannot pass on an unrelated error. Every
"this is allowed" case uses `test_result.inserted()` so the files cannot pass by
rejecting everything.

### Harness changes needed to make the storage tests real

`20261003000001_images_and_history.sql` wraps its entire body in
`if exists (storage schema) and exists (storage.buckets)`. On a throwaway
PostgreSQL neither exists, so **the migration did nothing and none of the
`product-images` policies were ever created.** Any storage test written against
it would have been theatre.

`support/00_auth_stub.sql` now provides a minimal `storage.buckets` and
`storage.objects` plus grants, alongside the existing `auth` stub, so the
migration's guarded block actually fires. The grants matter as much as the
tables: the stub grants insert/update/delete to `authenticated`, and 08's
"the shop owner really can upload a photo" assertion is what proves the
customers' refusals are policy refusals rather than missing-GRANT refusals.

Also added `test_result.inserted(label, sql)` to the harness — the counterpart to
`touches()` for the other direction. "This INSERT was allowed" and "this INSERT
worked" are different claims.

### A rule worth writing down for the next session

`refused()` is for statements that **raise**. `touches()` is for statements that
**quietly change nothing**. Getting this backwards produces a test that reports
"it was ALLOWED but should have been refused" for a perfectly well-locked-down
table: an `UPDATE` that RLS hides is not an error, it is a statement that matched
zero rows. Three assertions in 05 were wrong this way on the first run.

### Verification

All against real PostgreSQL 16, booted throwaway by `run.sh` every time.

- `npm run test:db` — **215 passed, 0 failed** (was 125 at the start of this
  session, and 4 failing before that).
- Two mutation checks, to prove the new tests can actually fail:
  - Removing `public.is_admin()` from `product_images_admin_write` →
    08 fails on `a customer cannot upload a photo`, `the rider cannot upload a
    photo`, and the cleanup assertion.
  - Removing `products_mrp_paise_ge_price` from 20261003000002 → 06 fails on
    exactly the three MRP assertions plus the "nothing invalid got in" check.
  - Both migrations were restored; `git diff supabase/migrations/` is empty.
- `npm run typecheck` — passes, zero errors, both apps.

### Not done, and why

- **`npm run lint` does not pass, and I did not fix it** — out of scope for this
  task by instruction. It fails with 15 errors and 4 warnings in `apps/admin`
  (`no-explicit-any` and `react-hooks/set-state-in-effect` in the categories and
  products pages) and 3 warnings in `apps/mobile/src/app/(tabs)/cart.tsx`. These
  are **pre-existing**: this session changed no file under `apps/` at all
  (`git status --short apps/` returns nothing). Rule 9.10 wants lint green; it
  is not, and the next session should treat that as outstanding.
- **No CHANGELOG.md existed** before this session, despite AGENTS.md §8
  requiring one. This file is its first entry, so the history before today is
  genuinely lost rather than merely misplaced.
- **Order flow, the admin panel's behaviour and all UI were not touched**, by
  instruction. The two `no-explicit-any` / `set-state-in-effect` clusters in the
  admin panel are the obvious next piece of work.
- `05_admin_writes_test.sql` leaves products 1800-3 and category 10000000-...-001
  at their seeded values by overwriting them with the same values. If a future
  migration changes those seeds, that file will fight it.
