-- =============================================================================
-- 37b · Payment methods: the switch, and the settlement path
--
-- The app may offer a method only when the shop can actually take the money.
-- There is no payment gateway connected (Razorpay is a later, owner-side step),
-- so `online_payments_enabled` defaults to FALSE and `place_order()` refuses an
-- online method while it is false. The checkout still SHOWS the methods, greyed
-- with one honest sentence, so the customer knows what is coming rather than
-- meeting a button that does nothing.
--
-- When the owner connects a gateway and flips the switch, the same path starts
-- accepting them. Nothing in the app changes.
--
-- Until then, a UPI transfer made directly to the shop is settled by the owner
-- with `mark_online_payment_paid()`. That is a real, auditable write — not a
-- client saying "trust me, I paid".
-- =============================================================================

alter table public.store_settings
  add column if not exists online_payments_enabled boolean not null default false;

comment on column public.store_settings.online_payments_enabled is
  'True only when a working payment gateway (or a staffed manual UPI desk) is '
  'ready. place_order() refuses non-cash methods while this is false.';

-- -----------------------------------------------------------------------------
-- Marking an online payment as received.
--
-- Used when the customer pays the shop's UPI id and the owner sees the credit.
-- The strict state checks are the point:
--   * the method must actually be an online one (a COD order is settled by
--     `mark_cod_collected()`, which is a different fact);
--   * a cancelled / failed / returned order cannot be marked paid — that money
--     would have to be refunded immediately;
--   * a second tap returns the stored row unchanged rather than writing twice.
-- -----------------------------------------------------------------------------

create or replace function public.mark_online_payment_paid(
  p_order_id  uuid,
  p_reference text
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_ref   text := nullif(trim(coalesce(p_reference, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Only the shop can mark a payment as received.'
      using errcode = '42501';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;

  if not found then
    raise exception 'That order does not exist.' using errcode = 'P0002';
  end if;

  if v_order.payment_method = 'cod' then
    raise exception 'This is a cash order. Use mark_cod_collected().'
      using errcode = '22023';
  end if;

  if v_order.status in ('cancelled', 'failed', 'returned') then
    raise exception 'A % order cannot be marked paid.', v_order.status
      using errcode = '22023';
  end if;

  -- Safe retry: already paid, nothing to write.
  if v_order.payment_status = 'paid' then
    return v_order;
  end if;

  if v_order.payment_status = 'refunded' then
    raise exception 'This payment was already refunded.' using errcode = '22023';
  end if;

  if v_ref is null then
    raise exception 'A payment reference is required.' using errcode = '22023';
  end if;

  update public.orders
     set payment_status    = 'paid',
         payment_reference = v_ref,
         updated_at        = now()
   where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

comment on function public.mark_online_payment_paid(uuid, text) is
  'Admin-only: record that an online payment (UPI/card/netbanking/wallet) was '
  'received, with its reference. Refuses cash orders and closed orders. Safe to '
  'retry.';

revoke execute on function public.mark_online_payment_paid(uuid, text) from public, anon;
grant execute on function public.mark_online_payment_paid(uuid, text) to authenticated, service_role;
