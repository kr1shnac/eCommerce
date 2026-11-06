-- =============================================================================
-- 27 · refund_due_paise — the money the shop owes on one order
-- =============================================================================
-- The owner's Today tab has reported `refund_due_paise` since migration
-- 20261021000002: money the shop is holding but must give back, because an
-- order paid online was cancelled, failed or came back. The customer's own
-- order screen showed nothing, so the person owed the money was the last to
-- know.
--
-- WHERE THE NUMBER COMES FROM
--
-- This is a GENERATED column, computed by Postgres from the same row it sits
-- on: an online payment that is still `paid` on an order that is not going to
-- be delivered is exactly the shop's liability. The app never sends it and
-- cannot set it. `payment_status = 'refunded'` zeroes it by itself the moment
-- the shop marks the money returned — which is also why this column can be
-- trusted as "still owed", not "was ever paid".
--
-- The rule is copied faithfully from `shop_day_totals()`'s refund filter
-- (payment_method = 'online' and payment_status = 'paid' and status in
-- cancelled/failed/returned). That function is deliberately NOT rewritten here:
-- replacing its body would mean carrying a 300-line function through a
-- migration for one expression. The test (`26_refund_due_test.sql`) asserts the
-- two agree on a fixed day, so a future change to either is caught.
--
-- COD is excluded on purpose: a failed cash delivery means the cash was never
-- collected, so there is nothing to give back.
-- =============================================================================

alter table public.orders
  add column refund_due_paise integer
    generated always as (
      case
        when payment_method = 'online'
         and payment_status = 'paid'
         and status in ('cancelled', 'failed', 'returned')
        then total_paise
        else 0
      end
    ) stored;

comment on column public.orders.refund_due_paise is
  'Money the shop still owes on this order: total_paise when an online payment '
  'is still paid on a cancelled/failed/returned order, else 0. Generated — the '
  'app never writes it, and marking payment_status = refunded clears it.';
