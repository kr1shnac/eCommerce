-- =============================================================================
-- 35 · The offers rail states its own scope
-- =============================================================================
-- Migration 20261109000006 adds `usage_limit` and `per_customer_limit` to
-- `active_offers()`, so the Home rail can say "first 20 orders" or "2 times per
-- person" instead of leaving the customer to discover the refusal at checkout
-- (COMPETITOR-TEARDOWN §11.5, A13).
--
-- This suite proves:
--
--   1. the two new keys are present and NULL where there is no such cap;
--   2. a capped code reports its real cap;
--   3. which rows are offered is UNCHANGED — a code with no global headroom is
--      still not advertised, so the rail cannot grow a code it cannot honour;
--   4. the existing keys (code, descriptions, min_order_paise) are still there,
--      so nothing that already reads the function breaks;
--   5. the rail still works signed out.
-- =============================================================================

select test_result.begin_suite('35 offers scope');

-- The seeded codes: SAVE10 (percent, min Rs 199, no caps) and
-- KUNIGAL50 (flat Rs 50, min Rs 499, no caps). Give them real caps so there is
-- something to read back.
reset role;
update public.coupons
   set usage_limit = 20, per_customer_limit = 2
 where code = 'KUNIGAL50';

-- =============================================================================
-- 1. Both caps are reported, and absent when there is none.
-- =============================================================================

set role authenticated;
select test_result.sign_in('11111111-1111-1111-1111-111111111111');

do $$
declare
  v_codes     jsonb;
  v_kunigal50 jsonb;
begin
  v_codes := public.active_offers('00000000-0000-4000-8000-000000000001');

  perform test_result.eq(
    'two offers are still live for the shop today',
    jsonb_array_length(v_codes),
    2::bigint
  );

  select o into v_kunigal50
    from jsonb_array_elements(v_codes) as o
   where o ->> 'code' = 'KUNIGAL50';

  perform test_result.eq(
    'the capped code reports its shop-wide cap',
    (v_kunigal50 ->> 'usage_limit')::bigint,
    20::bigint
  );
  perform test_result.eq(
    'and its per-person cap',
    (v_kunigal50 ->> 'per_customer_limit')::bigint,
    2::bigint
  );

  -- The original keys are untouched.
  perform test_result.eq(
    'the minimum still rides along',
    (v_kunigal50 ->> 'min_order_paise')::bigint,
    49900::bigint
  );
  perform test_result.ok(
    'and so does the Kannada wording',
    v_kunigal50 ->> 'description_kn' is not null,
    v_kunigal50 ->> 'description_kn'
  );
end;
$$;

-- =============================================================================
-- 2. A code with no cap reports NULL, so the app shows no scope line.
-- =============================================================================

do $$
declare
  v_codes jsonb;
  v_save10 jsonb;
begin
  v_codes := public.active_offers('00000000-0000-4000-8000-000000000001');

  select o into v_save10
    from jsonb_array_elements(v_codes) as o
   where o ->> 'code' = 'SAVE10';

  perform test_result.ok(
    'an uncapped code reports NULL for the shop-wide cap',
    v_save10 ->> 'usage_limit' is null,
    coalesce(v_save10 ->> 'usage_limit', 'NULL')
  );
  perform test_result.ok(
    'and NULL for the per-person cap',
    v_save10 ->> 'per_customer_limit' is null,
    coalesce(v_save10 ->> 'per_customer_limit', 'NULL')
  );
end;
$$;

-- =============================================================================
-- 3. The WHERE clause is unchanged: a used-up code is still not advertised.
-- =============================================================================

reset role;
-- Two uses left, then one use: at 20 the code must fall off the rail.
update public.coupons set used_count = 19 where code = 'KUNIGAL50';

set role authenticated;

select test_result.eq(
  'with one use left, the code is still advertised',
  (select count(*)::bigint
     from jsonb_array_elements(public.active_offers('00000000-0000-4000-8000-000000000001')) o
    where o ->> 'code' = 'KUNIGAL50'),
  1::bigint
);

reset role;
update public.coupons set used_count = 20 where code = 'KUNIGAL50';

set role authenticated;

select test_result.eq(
  'used up, the code is no longer advertised',
  (select count(*)::bigint
     from jsonb_array_elements(public.active_offers('00000000-0000-4000-8000-000000000001')) o
    where o ->> 'code' = 'KUNIGAL50'),
  0::bigint
);

select test_result.eq(
  'and the rail is now one offer, not two',
  (select jsonb_array_length(public.active_offers('00000000-0000-4000-8000-000000000001'))),
  1::bigint
);

-- =============================================================================
-- 4. Still safe signed out: it is the marketing rail on the shop's front door.
-- =============================================================================

set role anon;

select test_result.eq(
  'a signed-out visitor still sees the one live offer',
  (select jsonb_array_length(public.active_offers('00000000-0000-4000-8000-000000000001'))),
  1::bigint
);

-- =============================================================================
-- 5. Put the fixture back.
-- =============================================================================

reset role;
update public.coupons
   set usage_limit = null, per_customer_limit = null, used_count = 0
 where code = 'KUNIGAL50';

select test_result.eq(
  'fixture restored: two offers, no caps',
  (select jsonb_array_length(public.active_offers('00000000-0000-4000-8000-000000000001'))),
  2::bigint
);
