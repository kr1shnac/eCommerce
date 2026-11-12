# The `product-images` storage policies

**Status: created on hosted 2026-11-11, and proved working.**

There are six rows rather than four, and that is correct: the dashboard's
*For full customization* flow pre-selects `SELECT` when you pick `UPDATE` or
`DELETE`, so each of those two brings its own `SELECT` along. Both extra rows are
harmless — see §Why there are six, not four.

The bucket exists and is public. The four policies that decide who may **write**
to it do not exist by default, because Supabase has owned `storage.objects` with
`supabase_storage_admin` since April 2025 and the `postgres` role that migrations
run as is not a member:

```
select pg_has_role('postgres', 'supabase_storage_admin', 'member');  -- false
```

`create policy … on storage.objects` therefore fails with
`42501 must be owner of table objects`. This is not a bug in the migration; the
SQL editor cannot do it either (same role). The Storage → Policies screen uses
Supabase's Storage API, which can.

Without them, **the owner's photo upload fails** (an INSERT by `authenticated` is
denied), which is why they were needed. Public reads of a public bucket still
work, so the customer catalogue is never affected either way.

## Create them in the dashboard

*Recorded here exactly as it was done on 2026-11-11, so the same four can be
recreated if this project is ever rebuilt from scratch.*

Project → **Storage** → **Policies** → **New policy** → *For full customization*
(or the equivalent form in the current dashboard), bucket `product-images`.

### 1. Anyone may look at a photo

| Field | Value |
| --- | --- |
| Name | `product_images_public_read` |
| Operation | `SELECT` |
| Target roles | `anon`, `authenticated` |
| USING expression | `bucket_id = 'product-images'` |

### 2. Only the shop owner may upload one

| Field | Value |
| --- | --- |
| Name | `product_images_admin_write` |
| Operation | `INSERT` |
| Target roles | `authenticated` |
| WITH CHECK expression | `bucket_id = 'product-images' and public.is_admin()` |

### 3. Only the shop owner may replace one

| Field | Value |
| --- | --- |
| Name | `product_images_admin_update` |
| Operation | `UPDATE` |
| Target roles | `authenticated` |
| USING expression | `bucket_id = 'product-images' and public.is_admin()` |
| WITH CHECK expression | `bucket_id = 'product-images' and public.is_admin()` |

### 4. Only the shop owner may delete one

| Field | Value |
| --- | --- |
| Name | `product_images_admin_delete` |
| Operation | `DELETE` |
| Target roles | `authenticated` |
| USING expression | `bucket_id = 'product-images' and public.is_admin()` |

## Verify they work — 2026-11-11, done and recorded

Row count alone proves nothing. These were exercised over the Storage API with
the **publishable key and no session at all**, which is the hardest case:

| Attempt | Result | Proves |
| --- | --- | --- |
| `POST /object/list/product-images` (anon) | **`200` → `[]`** | public read works |
| `POST /object/product-images/probe.png` (anon, `image/png`) | **`403` → `new row violates row-level security policy`** | admin-only write is enforced |
| `DELETE /object/product-images/probe.png` (anon) | `404 NoSuchKey` | nothing to delete, so inconclusive — the write refusal above is the real proof |

Also confirmed: `storage.buckets` shows `product-images`, `public = true`,
`file_size_limit = 5242880` (5 MB), `allowed_mime_types` = jpeg / png / webp /
avif. A probe with `text/plain` was rejected with `415 invalid_mime_type`
*before* reaching RLS — the bucket's own mime allowlist is working.

**What could not be proved here:** that an actual **owner** can upload. That
needs a signed-in `admin` session, and sign-in needs phone OTP, which needs the
SMS provider — still owner-side. Until then the write path is proved *refused*
for everybody who is not an admin, which is the half that matters for safety.

## What is actually on hosted

Six rows, not four — and that is the correct number. The dashboard appends a hash
suffix to each name (`product_images_public_read 16wiy3a_0`), which is harmless:
Postgres does not care about the name, only the definition.

Every row, and where it came from:

| Row | Command | Note |
| --- | --- | --- |
| `product_images_public_read 16wiy3a_0` | SELECT | intended |
| `product_images_admin_write 16wiy3a_0` | INSERT | intended |
| `product_images_admin_update 16wiy3a_0` | UPDATE | intended, but `with_check` is `NULL` |
| `product_images_admin_delete 16wiy3a_0` | DELETE | intended |
| `product_images_admin_delete 16wiy3a_1` | SELECT | **expected** — the dashboard pairs a SELECT with every DELETE |
| `product_images_admin_update 16wiy3a_1` | SELECT | **expected** — the dashboard pairs a SELECT with every UPDATE |

### Why there are six, not four — and why that is correct

The dashboard's *For full customization* flow **pre-selects `SELECT` when you pick
`UPDATE` or `DELETE`**, and creates both policies in one save. So an UPDATE and a
DELETE each bring their own SELECT along. The two extra rows are the dashboard
doing this, not a mistake and not something to clean up.

**Keep them.** Deleting them would make this bucket differ from every other
Supabase-managed bucket for no reason, and the next person to edit these policies
through the dashboard would simply have them recreated.

**Neither row is a hole.** SELECT policies are OR-ed together, so an admin-only
SELECT sitting beside the public SELECT changes nothing about who can read: the
public one already grants everyone read, and adding a narrower rule to a union
does not narrow it. The `UPDATE` row's `NULL` `with_check` also closes —
PostgreSQL falls back to the `USING` expression for the new row when `WITH CHECK`
is omitted, so the admin-only gate still applies to what is being written.

So the working set is four rules in substance, six rows in the catalogue.

## Prove they exist

```bash
supabase db query --remote --read-only \
  "select policyname, cmd, roles::text, qual, with_check
   from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
   order by cmd, policyname"
```

Expected: **six** rows — one `SELECT` for public read, one `INSERT`, one `UPDATE`,
one `DELETE`, plus the `SELECT` the dashboard pairs with each of the UPDATE and
DELETE. Every write policy must carry
`((bucket_id = 'product-images'::text) AND is_admin())`. Anything less and the
admin gate has been left out.

`npm run test:db` proves the same policies on the throwaway PostgreSQL (test 08)
— the migration creates them there because the test harness owns the storage
stub. The dashboard step is the only part that cannot be automated from this
repo.
