-- =============================================================================
-- 22 · Adding a product from the owner's phone (register M6)
--
-- Rule 9.7: a new function is not done until a test proves the forbidden case
-- fails. `create_product_from_shop()` adds the one write path that had never
-- existed — the owner, on their phone, adding a new product to the shelf.
--
-- The three things this file exists to prove, in order of how much they matter:
--
--   1. **THE KANNADA NAME CANNOT BE SKIPPED.** Every customer-visible string has a
--      Kannada twin, and `name_kn` was `not null` but an EMPTY STRING satisfied
--      that. One in three adults in Kunigal cannot comfortably read the English
--      name (KUNIGAL.md §1), so a blank Kannada label is a blank shelf label. The
--      function refuses a blank Kannada name, and refuses the English name copied
--      across — the exact shortcut a hurried owner would take, which looks
--      filled-in and is not Kannada.
--
--   2. **THE CLIENT NEVER NAMES THE SHOP.** `store_id` is not an argument; the
--      function finds the active store itself. A policy authorises on ROLE, not on
--      which shop, so a client-supplied `store_id` would let a signed-in owner
--      create a product in a shop they do not own.
--
--   3. **A NON-OWNER IS REFUSED LOUDLY.** A customer or rider gets `42501`, not
--      zero rows and no error — the failure mode that makes a save button lie.
--
-- It also pins the ordinary happy path, the pack rules, and that the derived
-- `unit` text can never disagree with the structured pack, because those are the
-- facts the rest of the app reads.
-- =============================================================================

select test_result.begin_suite('22 create product');

-- -----------------------------------------------------------------------------
-- 1. The door: nobody but the owner may add a product
-- -----------------------------------------------------------------------------

reset role;
set role authenticated;

-- A signed-out caller has no role at all. `is_admin()` is false, so the door holds.
select test_result.sign_out();
select test_result.refused(
  'a signed-out caller cannot add a product',
  $$ select public.create_product_from_shop('Test Item', 'ಟೆಸ್ಟ್', 1000, null) $$,
  '42501'
);

-- A customer. This is the case that matters most: the app ships to customers, and
-- the function must not be reachable from a customer's session.
select test_result.sign_in('11111111-1111-1111-1111-111111111111');
select test_result.refused(
  'a customer cannot add a product',
  $$ select public.create_product_from_shop('Test Item', 'ಟೆಸ್ಟ್', 1000, null) $$,
  '42501'
);

-- A rider, who is staff for delivery but not for the shelf.
select test_result.sign_in('22222222-2222-2222-2222-222222222222');
select test_result.refused(
  'a rider cannot add a product',
  $$ select public.create_product_from_shop('Test Item', 'ಟೆಸ್ಟ್', 1000, null) $$,
  '42501'
);

-- -----------------------------------------------------------------------------
-- 2. The owner CAN, and the row is what Postgres stored
-- -----------------------------------------------------------------------------

select test_result.sign_in('33333333-3333-3333-3333-333333333333');
select test_result.ok(
  'the owner can add a counted product',
  (
    select (public.create_product_from_shop(
      'Test Soap 22', 'ಟೆಸ್ಟ್ ಸೋಪು 22', 3500, null, 'piece', null, null, 4000, 15, '🧼'
    )).id is not null
  ),
  'the function returned a row'
);

-- The row that came back is the row in the table — not a hopeful echo of the input.
select test_result.eq(
  'the stored price is the paise the owner sent',
  (select price_paise::text from public.products where name_en = 'Test Soap 22'),
  '3500'
);

select test_result.eq(
  'the stored Kannada name is the Kannada name',
  (select name_kn from public.products where name_en = 'Test Soap 22'),
  'ಟೆಸ್ಟ್ ಸೋಪು 22'
);

-- A counted product is 'piece' with no pack, and the free text says "1 piece".
select test_result.eq(
  'a counted product stores piece / no pack / "1 piece"',
  (
    select sold_by::text || '/' || coalesce(pack_size::text, 'none') || '/' || unit
      from public.products where name_en = 'Test Soap 22'
  ),
  'piece/none/1 piece'
);

-- A new product goes on the shelf active, or the owner would have to hunt for it
-- to switch it on — the opposite of "add it now, while you are looking at it".
select test_result.ok(
  'a newly added product is on the shelf immediately',
  (select is_active from public.products where name_en = 'Test Soap 22')
);

-- -----------------------------------------------------------------------------
-- 3. A weighed product, and the derived pack text
-- -----------------------------------------------------------------------------

select test_result.ok(
  'the owner can add a weighed product',
  (
    select (public.create_product_from_shop(
      'Test Rice 22', 'ಟೆಸ್ಟ್ ಅಕ್ಕಿ 22', 6500, null, 'measure', 1, 'kg', 8000, 20, '🍚'
    )).id is not null
  ),
  'the function returned a row'
);

-- This is the assertion that keeps one fact in one place: `unit` is DERIVED from
-- (pack_size, pack_unit), so it can never drift from the pack the app compares
-- sizes on. If a future edit lets the caller type `unit`, this fails.
--
-- The text mirrors the declared unit exactly: a pack entered as "1 kg" reads
-- "1 kg". The function does NOT silently rewrite 1000 g into 1 kg — that would
-- lose how the shop writes its own shelf, and the shop's own words are the ones a
-- customer reads. (The VIEW normalises for comparison; the text does not.)
select test_result.eq(
  'the pack text is derived from the structured pack, not typed',
  (select unit from public.products where name_en = 'Test Rice 22'),
  '1 kg'
);

select test_result.eq(
  'a weighed product stores measure / 1 kg',
  (
    select sold_by::text || '/' || pack_size::text || '/' || pack_unit::text
      from public.products where name_en = 'Test Rice 22'
  ),
  'measure/1.000/kg'
);

-- A pack declared in grams keeps grams: the function must not quietly re-express
-- it in kilos. The shop wrote "500 g" on the shelf, and that is what the customer
-- must read back.
select test_result.ok(
  'a pack declared in grams is not rewritten as kilos',
  (
    select (public.create_product_from_shop(
      'Test Tomato 22', 'ಟೆಸ್ಟ್ ಟೊಮೆಟೊ 22', 1800, null, 'measure', 500, 'g', 2400, 40, '🍅'
    )).unit = '500 g'
  ),
  'the shop''s own unit is preserved'
);

-- A fractional pack is allowed, because a shop may sell 1.5 kg — and the derived
-- text must say so without trailing zeros.
select test_result.ok(
  'the owner can add a 1.5 kg pack',
  (
    select (public.create_product_from_shop(
      'Test Ghee 22', 'ಟೆಸ್ಟ್ ತುಪ್ಪ 22', 90000, null, 'measure', 1.5, 'kg', null, 5, null
    )).unit = '1.5 kg'
  ),
  'the derived text drops the trailing zeros'
);

-- The bug this pins: the first draft trimmed trailing zeros with a plain
-- `rtrim(..., '0')`, which turns a 100 g pack into "1 g" — a hundred-fold lie about
-- what the customer gets. A whole number must survive intact.
select test_result.ok(
  'a 100 g pack reads "100 g", not "1 g"',
  (
    select (public.create_product_from_shop(
      'Test Chilli 22', 'ಟೆಸ್ಟ್ ಮೆಣಸಿನಕಾಯಿ 22', 900, null, 'measure', 100, 'g', null, 30, null
    )).unit = '100 g'
  ),
  'whole numbers are not trimmed'
);

select test_result.ok(
  'a 250 g pack reads "250 g"',
  (
    select (public.create_product_from_shop(
      'Test Dal 22', 'ಟೆಸ್ಟ್ ಬೇಳೆ 22', 5000, null, 'measure', 250, 'g', null, 12, null
    )).unit = '250 g'
  ),
  'the trailing zero of 250 survives'
);

-- -----------------------------------------------------------------------------
-- 4. The Kannada name cannot be skipped — the whole point of M6
-- -----------------------------------------------------------------------------

select test_result.refused(
  'a blank Kannada name is refused',
  $$ select public.create_product_from_shop('Test Blank 22', '   ', 1000, null) $$,
  '23514'
);

select test_result.refused(
  'the English name copied into the Kannada field is refused',
  $$ select public.create_product_from_shop('Test Copy 22', 'Test Copy 22', 1000, null) $$,
  '23514'
);

-- The refusal must be specific: the screen translates the reason, so a generic
-- failure would leave the owner guessing which field was wrong. These two checks
-- raise and inspect the actual message.
do $$
declare
  v_message text;
begin
  begin
    perform public.create_product_from_shop('Test Msg 22', '', 1000, null);
    v_message := 'NO ERROR RAISED';
  exception when others then
    v_message := sqlerrm;
  end;
  perform test_result.ok(
    'the refusal message tells the owner the Kannada name is missing',
    v_message ilike '%kannada%',
    v_message
  );

  begin
    perform public.create_product_from_shop('Test Msg 23', 'Test Msg 23', 1000, null);
    v_message := 'NO ERROR RAISED';
  exception when others then
    v_message := sqlerrm;
  end;
  perform test_result.ok(
    'the refusal message tells the owner to write in Kannada, not copy',
    v_message ilike '%in kannada%' or v_message ilike '%copied%',
    v_message
  );
end $$;

-- A real Kannada name with a Latin brand word in it is still accepted: 'Aashirvaad
-- ಗೋಧಿ ಹಿಟ್ಟು' is how a shop actually writes it, and refusing it would be the
-- rule becoming an obstacle rather than a guard.
select test_result.ok(
  'a Kannada name containing a Latin brand word is still accepted',
  (
    select (public.create_product_from_shop(
      'Test Atta 22', 'Test ಬ್ರಾಂಡ್ ಗೋಧಿ ಹಿಟ್ಟು', 4500, null
    )).id is not null
  ),
  'the function accepted it'
);

-- -----------------------------------------------------------------------------
-- 5. The other refusals the screen relies on
-- -----------------------------------------------------------------------------

select test_result.refused(
  'a blank English name is refused',
  $$ select public.create_product_from_shop('   ', 'ಟೆಸ್ಟ್', 1000, null) $$,
  '23514'
);

select test_result.refused(
  'a null price is refused',
  $$ select public.create_product_from_shop('Test NoPrice 22', 'ಟೆಸ್ಟ್', null, null) $$,
  '23514'
);

select test_result.refused(
  'a weighed product with no pack is refused',
  $$ select public.create_product_from_shop('Test NoPack 22', 'ಟೆಸ್ಟ್', 1000, null, 'measure', null, null) $$,
  '23514'
);

select test_result.refused(
  'a weighed product with a zero pack is refused',
  $$ select public.create_product_from_shop('Test ZeroPack 22', 'ಟೆಸ್ಟ್', 1000, null, 'measure', 0, 'g') $$,
  '23514'
);

-- A duplicate English name must be refused in words, not by leaking a constraint
-- name — `unique (store_id, name_en)` is what actually stops it.
select test_result.refused(
  'a duplicate English name is refused',
  $$ select public.create_product_from_shop('Test Soap 22', 'ಟೆಸ್ಟ್ ಬೇರೆ', 1000, null) $$,
  '23505'
);

-- -----------------------------------------------------------------------------
-- 6. The shop is chosen server-side, and it is a real one
-- -----------------------------------------------------------------------------

select test_result.ok(
  'the product landed in the active shop, chosen by the server',
  (
    select p.store_id = (select id from public.stores where is_active = true order by created_at limit 1)
      from public.products p where p.name_en = 'Test Soap 22'
  ),
  'store_id matches the active store'
);

select test_result.ok(
  'the function has no store_id argument to misuse',
  (
    select not exists (
      select 1 from pg_proc
       where proname = 'create_product_from_shop'
         and pg_get_function_arguments(oid) ilike '%store_id%'
    )
  ),
  'no store_id in the signature'
);

-- -----------------------------------------------------------------------------
-- 7. A customer can read the new product immediately
-- -----------------------------------------------------------------------------
-- The whole point of adding it from the phone is that the customer sees it. If RLS
-- hid it, the owner would have created a product nobody could buy.

select test_result.sign_out();
select test_result.sign_in('11111111-1111-1111-1111-111111111111');
select test_result.ok(
  'a customer can see the product the owner just added',
  (
    select count(*) = 1 from public.products where name_en = 'Test Soap 22' and is_active
  ),
  'the customer can read it'
);

-- -----------------------------------------------------------------------------
-- Clean up our own fixtures (tests 20 and 21 do the same).
-- -----------------------------------------------------------------------------

reset role;

delete from public.products
 where name_en in (
   'Test Soap 22', 'Test Rice 22', 'Test Ghee 22', 'Test Atta 22',
   'Test Chilli 22', 'Test Dal 22', 'Test Tomato 22'
 );
