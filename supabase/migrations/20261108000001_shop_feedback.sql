-- =============================================================================
-- 31 · shop_feedback_totals() and shop_feedback_reasons() — the shop reads its
--      own answers.
--
-- WHY THIS EXISTS
-- ---------------
-- `order_feedback` (migration 20261106000001) collects one honest answer per
-- delivered order: was everything right, and if not, which of six things went
-- wrong. Every one of those reasons maps to an action the owner can take — so
-- until now the app has been collecting the answer and showing it to nobody.
-- The register's own promise ("each reason maps to something the owner can do")
-- is only true if the owner can see the reasons.
--
-- SCOPE, SAID PLAINLY
-- -------------------
-- This is NOT a rating. There is no average, no score and no star count, and
-- there never will be: this table has 34 products and a handful of deliveries a
-- day, and an average over that is a number that looks like information. These
-- two functions return **counts of things that happened**, which is the only
-- aggregate the data can honestly support:
--
--   * how many bags arrived right, and how many did not (a ratio, not a rating);
--   * which of the six reasons occurred, most first (the action list).
--
-- WHAT IT DELIBERATELY DOES NOT RETURN
-- -----------------------------------
-- A per-product or per-item count of complaints. `reason` is per ORDER — a
-- "missing_item" does not say *which* item was missing — so attributing it to a
-- product would be an inference the data does not make. It also does not
-- per-rider it: `late` and `wrong_address` are about the route, not the person
-- carrying it. Both would be invented, and an invented breakdown is worse than
-- none because it looks like evidence.
--
-- THE RULES
-- ---------
--   1. staff only. `is_staff()` is admin + delivery, checked INSIDE the
--      function before a row is read, so a customer's own SELECT on
--      `order_feedback` is the only other read path and it stays theirs.
--   2. one window, 30 days by default, because a pilot shop answering a
--      handful a day has no "today" to report and an empty screen teaches
--      nobody anything. The window is a parameter, not a constant, so the day
--      the shop wants a week it can ask for one.
--   3. a reason with no rows is not returned at all — never a zero line, which
--      would read as "this happened zero times", the way a product with no
--      rating must not show "0".
--
-- Rule 9.7: `supabase/tests/29_shop_feedback_test.sql` proves the forbidden
-- cases fail.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The two numbers.
-- -----------------------------------------------------------------------------

create or replace function public.shop_feedback_totals(
  p_since timestamptz default now() - interval '30 days'
)
returns table (
  answered     bigint,
  ok_count     bigint,
  wrong_count  bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*)::bigint                                        as answered,
    count(*) filter (where f.was_ok)::bigint                as ok_count,
    count(*) filter (where not f.was_ok)::bigint            as wrong_count
  from public.order_feedback f
  where f.created_at >= coalesce(p_since, now() - interval '30 days')
  -- The staff test is a HAVING, not a WHERE: with a WHERE the aggregate still
  -- returns one row of zeroes to somebody who is not staff, and "zero bags
  -- complained" is a claim this function has no right to make about anybody
  -- but the shop. With a HAVING there is no group at all, so a customer gets
  -- NO row — the fail-closed shape, and the one the app's three-state rule can
  -- render.
  having public.is_staff();
$$;

comment on function public.shop_feedback_totals(timestamptz) is
  'For staff: how many delivered bags were reported right and how many were '
  'not, in a window (30 days by default). Not a rating and not an average — '
  'the two counts a single shop can honestly carry. Returns NO ROW at all to '
  'anybody who is not staff, rather than a row of zeroes.';

-- -----------------------------------------------------------------------------
-- 2. The action list: which of the six reasons occurred, most first.
--
--    A reason with no rows is absent, not zero. `is_staff()` is inside the
--    WHERE rather than the `case`, so a caller who is not staff gets an empty
--    result rather than a refusal — the same shape as `rider_directory`, where
--    an empty answer is the safe one for a screen that may render it anyway.
--    The app never calls these as a customer, and the test asserts both shapes.
-- -----------------------------------------------------------------------------

create or replace function public.shop_feedback_reasons(
  p_since timestamptz default now() - interval '30 days'
)
returns table (
  reason  text,
  seen    bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select f.reason::text, count(*)::bigint as seen
  from public.order_feedback f
  where f.created_at >= coalesce(p_since, now() - interval '30 days')
    and f.reason is not null
    and public.is_staff()
  group by f.reason
  order by seen desc, f.reason asc;
$$;

comment on function public.shop_feedback_reasons(timestamptz) is
  'For staff: the six fixed complaint reasons and how many times each occurred '
  'in the window, most first. A reason that did not occur returns no row at '
  'all, never a zero.';

-- Neither function is callable by anyone who has not signed in, and the app
-- only ever calls them from the owner's Today tab.
revoke all on function public.shop_feedback_totals(timestamptz) from public, anon;
revoke all on function public.shop_feedback_reasons(timestamptz) from public, anon;
grant execute on function public.shop_feedback_totals(timestamptz) to authenticated, service_role;
grant execute on function public.shop_feedback_reasons(timestamptz) to authenticated, service_role;
