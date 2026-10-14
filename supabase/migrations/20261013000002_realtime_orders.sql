-- =============================================================================
-- 08 · Realtime: let the app hear about order changes over a websocket
-- =============================================================================
-- Supabase streams row changes only for tables that are members of the
-- `supabase_realtime` publication. Without this, the app's channel subscribes
-- successfully and then sits in silence forever — which is exactly the bug where
-- a rider's waiting list only moved on the next 20-second poll instead of the
-- instant an order landed.
--
-- Why `orders` and not `order_items`: an order's lines are written together with
-- the order by place_order() and never change afterwards, so an event on the
-- orders row is enough to make every screen refetch. One stream, not two.
--
-- SECURITY (AGENTS.md §4 / ROADMAP §11)
--   Realtime Postgres Changes enforces RLS. The subscriber's own JWT is sent to
--   the Realtime server (supabase-js does this automatically through its
--   accessToken callback), and the server only delivers rows that subscriber may
--   SELECT. A signed-out (anon) socket is delivered nothing, because no policy
--   grants anon access to orders. The app still treats an event purely as a
--   doorbell — "something changed" — and re-reads through the normal
--   RLS-protected REST call, so the payload is never the source of truth.
--
-- Both blocks are guarded by existence checks because on a real Supabase project
-- the publication is created by the platform and already exists, while in the
-- throwaway PostgreSQL the database tests run against it does not. Creating it
-- when absent is what lets `supabase/tests/10_realtime_publication_test.sql`
-- actually prove the wiring instead of passing for the wrong reason.

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end
$$;
