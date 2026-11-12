-- =============================================================================
-- 37a · Payment methods: the values, on their own
--
-- `payment_method` was `('cod', 'online')` from the first migration. That is not
-- enough to answer the customer's question at the door or to reconcile the day:
-- "online" covers a UPI transfer, a card and a net-banking payment, and the shop
-- settles them differently.
--
-- The values are added in a file of their own because PostgreSQL will not let a
-- transaction USE a new enum value that the same transaction just added. The
-- functions that accept them are in the next file, which is a separate
-- transaction.
--
-- `online` is deliberately kept. It is what the first schema shipped, and an
-- order that already says `online` must keep meaning what it meant.
-- =============================================================================

alter type public.payment_method add value if not exists 'upi';
alter type public.payment_method add value if not exists 'card';
alter type public.payment_method add value if not exists 'netbanking';
alter type public.payment_method add value if not exists 'wallet';

comment on type public.payment_method is
  'How the customer pays. cod = cash at the door. upi = any UPI app (GPay, '
  'PhonePe, Paytm). card, netbanking, wallet = online. online = the original '
  'generic value, kept for rows written before the specific methods existed.';
