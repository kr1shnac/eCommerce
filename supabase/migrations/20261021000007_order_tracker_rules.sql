-- =============================================================================
-- 18b · The order tracker's rules, one transaction after the enum
-- =============================================================================
-- Split out of `20261021000001_order_tracker.sql` on 2026-11-09.
--
-- That migration adds two values to `public.order_status` (`failed`, `returned`)
-- and then constrains them. PostgreSQL will not let a transaction USE a value it
-- added in the same transaction:
--
--   ERROR: unsafe use of new value "failed" of enum type order_status
--   SQLSTATE 55P04
--
-- psql autocommits every statement, so `npm run test:db` never saw this. The
-- Supabase CLI wraps a whole migration file in one transaction, so the hosted
-- push failed at the first CHECK and rolled the file back. This is the
-- documented fix: add the value, commit, then use it.
--
-- Nothing is lost by the split. These three statements run before every later
-- migration and before every test, and test 18 still asserts that a `failed`
-- order without a reason is refused.
-- =============================================================================

-- 1. A terminal failure must say why. The customer sees a translated sentence
--    built from `failure_reason`; an unexplained failure would show them nothing.
alter table public.orders
  add constraint orders_failed_has_reason
    check (status not in ('failed', 'returned') or failure_reason is not null);

-- 2. A live order must NOT carry a reason. Without this, a rider could leave a
--    stale reason on an order that later succeeds, and the customer's screen
--    would contradict the status.
alter table public.orders
  add constraint orders_failure_only_when_failed
    check (status in ('failed', 'returned')
           or (failure_reason is null and failure_note is null));

-- 3. The owner's board and the pilot's paper ledger both ask "what failed
--    today?", so the partial index only holds terminal failures.
create index orders_failed_idx
  on public.orders (status, placed_at desc)
  where status in ('failed', 'returned');
