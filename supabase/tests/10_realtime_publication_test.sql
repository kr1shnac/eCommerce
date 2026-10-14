-- =============================================================================
-- 10 · Realtime wiring: is `orders` actually published?
--
-- Rule 9.7: a schema change is not done until a test proves it. This one is small
-- but it guards a failure that is invisible until a phone is in someone's hand:
-- if `orders` is not a member of the `supabase_realtime` publication, every
-- Realtime channel subscribes successfully and then never receives a single
-- event. There is no error, no crash, and the fallback poll hides it for up to a
-- minute — so nothing but an explicit assertion will catch a regression.
--
-- It also asserts the shape of the publication rather than merely that it
-- exists, because "the publication exists" is not the thing the app depends on.
-- =============================================================================

select test_result.begin_suite('10 realtime publication');

-- -----------------------------------------------------------------------------
-- The publication the Realtime server reads from.
-- -----------------------------------------------------------------------------

select test_result.ok(
  'the supabase_realtime publication exists',
  exists (select 1 from pg_publication where pubname = 'supabase_realtime')
);

-- -----------------------------------------------------------------------------
-- `orders` is a member, so an INSERT/UPDATE is streamed to subscribers.
-- -----------------------------------------------------------------------------

select test_result.ok(
  'orders is published to realtime',
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  )
);

-- -----------------------------------------------------------------------------
-- The row must still be RLS-visible to the subscriber for Realtime to deliver
-- it. This is what stops a customer from hearing about somebody else's order:
-- anon and other customers cannot SELECT these rows, so Realtime never sends
-- them the change. The policy itself is proved in 01_baseline_rls_test.sql;
-- here we only pin the filter the Realtime server applies.
-- -----------------------------------------------------------------------------

select test_result.ok(
  'orders still has RLS enabled (realtime filters by it)',
  (select relrowsecurity from pg_class where oid = 'public.orders'::regclass)
);

select test_result.ok(
  'orders has a primary key (realtime needs a replica identity)',
  exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indrelid
    where c.oid = 'public.orders'::regclass
      and i.indisprimary
  )
);
