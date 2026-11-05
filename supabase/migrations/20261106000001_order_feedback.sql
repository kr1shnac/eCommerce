-- =============================================================================
-- 26 · order_feedback — the customer's one question after the bag arrives
-- =============================================================================
-- Blinkit and Zepto close their second loop with a rating. A star average is
-- useless to a shop with one street: it cannot tell the owner WHICH order went
-- wrong or why. So this is not a rating. It is a record:
--
--   * did everything arrive as ordered?        `was_ok` (boolean)
--   * if not, what was wrong?                  one fixed `reason`
--
-- Six reasons, chosen so each one maps to a different action the owner can
-- take: re-send it (`missing_item`, `wrong_item`), replace it (`damaged`), call
-- the rider (`late`), fix the address on file (`wrong_address`), or read the
-- phone number (`other`). There is deliberately no free-text note and no score:
-- a number nobody acts on is worse than no number.
--
-- THE RULES, all enforced here and not in the app:
--   1. one feedback row per order — `order_id` is the primary key;
--   2. only the order's own customer may write it, and only once the order is
--      `delivered` (a bag that never arrived has a failure reason instead);
--   3. it is a record, not a conversation: no UPDATE and no DELETE policy, so a
--      customer cannot change their answer later and quietly rewrite history;
--   4. the shop and the rider can read every row (the point of collecting it);
--   5. an erased account takes its feedback with it — `user_id` cascades from
--      `profiles`, which `delete_my_account()` removes.
--
-- Rule 9.7: this ships with `supabase/tests/25_order_feedback_test.sql`, which
-- proves each refusal below rather than assuming it.
-- =============================================================================

create table public.order_feedback (
  -- The natural key. One bag, one answer — a second INSERT is a duplicate-key
  -- error, not a second opinion.
  order_id   uuid        primary key references public.orders (id) on delete cascade,
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  was_ok     boolean     not null,
  -- NULL when `was_ok`. Required when something went wrong, so "not ok" can
  -- never be a dead end the owner cannot act on.
  reason     text        check (
                           reason is null
                           or reason in ('missing_item', 'damaged', 'late',
                                         'wrong_address', 'wrong_item', 'other')
                         ),
  created_at timestamptz not null default now(),

  -- The two columns answer each other:
  --   ok         => no reason
  --   something  => exactly one reason
  constraint order_feedback_reason_matches_answer
    check (
      (was_ok and reason is null)
      or (not was_ok and reason is not null)
    )
);

comment on table public.order_feedback is
  'One "was everything right?" answer per delivered order. Inserted by the '
  'order''s own customer, readable by staff, never updated or deleted (an '
  'erased account cascades its rows away).';

comment on column public.order_feedback.was_ok is
  'True when the order arrived complete and correct. False always carries a reason.';

comment on column public.order_feedback.reason is
  'missing_item | damaged | late | wrong_address | wrong_item | other. NULL when was_ok.';

-- Account deletion removes the profile, which scans this table by user_id.
-- (`order_id` already has an index as the primary key.)
create index order_feedback_user_id_idx on public.order_feedback (user_id, created_at desc);

alter table public.order_feedback enable row level security;

-- -----------------------------------------------------------------------------
-- Write: your own delivered order, once.
--
-- The EXISTS is the whole permission model in one line, and it holds even if
-- the app sends a different order_id than the screen showed: `o.user_id` must
-- be the caller, so a guessed order number belonging to somebody else matches
-- no row and the INSERT is refused (42501) rather than silently ignored.
-- -----------------------------------------------------------------------------
create policy "you can answer for your own delivered order"
  on public.order_feedback for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.orders o
      where o.id = order_id
        and o.user_id = auth.uid()
        and o.status = 'delivered'
    )
  );

-- -----------------------------------------------------------------------------
-- Read: your own answer, or every answer if you run the shop.
--
-- `is_staff()` is admin + delivery. A rider seeing "the bag was damaged" on
-- their own delivery is the correction loop working, not a privacy leak: the
-- row carries no address, no phone and no money.
-- -----------------------------------------------------------------------------
create policy "read your own feedback, staff read all"
  on public.order_feedback for select
  to authenticated
  using (user_id = auth.uid() or public.is_staff());

-- No UPDATE policy and no DELETE policy, on purpose. Grants (file 07 and the
-- default privileges) still let an authenticated role issue the statement, so
-- the refusal is "zero rows changed", which the test asserts with touches().
-- Making the table immutable in RLS is what stops a customer from turning a
-- "damaged" complaint into "all fine" after the shop has already refunded it.
