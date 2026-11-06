-- =============================================================================
-- 27 · The delivery code: the bag changes hands, and the app knows it did
-- =============================================================================
-- Register T5 of SCALE-AND-TRACKING.md. Every one of Blinkit, Zepto, Swiggy and
-- Zomato closes a delivery with a code the customer reads to the rider. It is
-- not ceremony: it is the only point in the whole flow where the shop learns
-- that the RIGHT bag reached the RIGHT door, and it stops the two failures the
-- rider currently has to choose between at a locked gate:
--
--   * pressing "delivered" when nobody took the bag (corrupts the books,
--     and the customer keeps waiting), or
--   * leaving the order in "out for delivery" all evening.
--
-- The shape here follows `rider_positions` (migration 20261026000001) on
-- purpose: the table is invisible to every client, every read goes through one
-- security-definer function, every write through another, and a trigger owns
-- the one rule a policy cannot express — "a rider may not say delivered without
-- the customer's code".
--
-- WHAT THIS MIGRATION ADDS
--
--   1. `order_delivery_codes` — one 4-digit code per live delivery. RLS on,
--      no policies, privileges revoked: the safe default.
--   2. A code is issued automatically when an order first reaches
--      `out_for_delivery`, and destroyed when it leaves that state, so a code
--      never outlives the delivery it was issued for.
--   3. `my_delivery_code(order_id)` — the customer reads their OWN code (and
--      the owner may read it to help on the phone). A rider cannot call it,
--      which is the whole point.
--   4. `complete_delivery(order_id, code)` — the assigned rider, with the right
--      code, closes the order. Five wrong tries locks it; the owner then uses
--      the documented direct-update escape hatch.
--   5. `guard_delivery_code` — a BEFORE UPDATE trigger. A delivery partner
--      cannot reach `delivered` unless `complete_delivery()` set the
--      transaction-local proof for THIS order id. Admin is exempt.
--
-- WHY A PLAINTEXT CODE
--
-- The customer must be able to READ the code back on their own screen hours
-- later, so it cannot be hashed. The protection is not the column, it is: the
-- table is unreachable from the app, the read function serves only the order's
-- own customer, the write function serves only the assigned rider, and five
-- wrong guesses close the door. A 4-digit code with a 5-try limit is 1-in-2000
-- per delivery, not 1-in-10000, and both sides are the same two people meeting
-- in person.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. A 4-digit code, generated on the server.
-- -----------------------------------------------------------------------------
-- Leading zeros are kept ("0042" is as valid as "4821"), because stripping them
-- would silently shrink the space and make the pad look broken to the customer.
create or replace function public.new_delivery_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select lpad((floor(random() * 10000))::integer::text, 4, '0');
$$;

comment on function public.new_delivery_code() is
  'A fresh zero-padded 4-digit delivery code. Server-side only; no client role '
  'is granted execute.';

revoke all on function public.new_delivery_code() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. The code itself. One row per live delivery.
-- -----------------------------------------------------------------------------

create table if not exists public.order_delivery_codes (
  -- The order is the key. Two customers may coincidentally get the same digits;
  -- that is harmless because a code is only ever checked against its own order.
  order_id   uuid primary key references public.orders (id) on delete cascade,

  code       text not null check (code ~ '^[0-9]{4}$'),

  -- Wrong guesses. The cap is mirrored in complete_delivery(), which refuses to
  -- increment past it. Scoped to the delivery, not the rider: a reassigned order
  -- keeps the code and the count, because the customer's code did not change.
  attempts   integer not null default 0 check (attempts between 0 and 5),

  created_at timestamptz not null default now()
);

comment on table public.order_delivery_codes is
  'One live 4-digit handover code per out-for-delivery order. Written only by '
  'the issue trigger and complete_delivery(), read only through '
  'my_delivery_code(). Invisible to every client role on purpose.';
comment on column public.order_delivery_codes.attempts is
  'Wrong guesses so far. 5 means locked; the owner can still close the order by '
  'updating it directly (the documented admin escape hatch).';

-- Direct access is closed. RLS enabled with no policies, then the table
-- privileges are revoked as well — the same belt-and-braces as rider_positions.
alter table public.order_delivery_codes enable row level security;
revoke all on public.order_delivery_codes from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Issue a code when the bag goes out, destroy it when the delivery ends.
-- -----------------------------------------------------------------------------
-- An AFTER trigger, not a column default or a client call: a code that the
-- phone had to remember to request is a code that a broken build does not
-- create. The INSERT branch covers the admin/fixture path that creates an order
-- already out for delivery; production orders are always created `placed`.
create or replace function public.issue_delivery_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'out_for_delivery' then
      insert into public.order_delivery_codes (order_id, code)
      values (new.id, public.new_delivery_code())
      on conflict (order_id) do nothing;
    end if;
    return null;
  end if;

  if new.status is not distinct from old.status then
    return null;
  end if;

  if new.status = 'out_for_delivery' then
    insert into public.order_delivery_codes (order_id, code)
    values (new.id, public.new_delivery_code())
    on conflict (order_id) do nothing;
  elsif old.status = 'out_for_delivery' then
    -- Delivered, cancelled, failed or returned: the code has no further use and
    -- keeping it would be a secret with no owner.
    delete from public.order_delivery_codes where order_id = new.id;
  end if;

  return null;
end;
$$;

comment on function public.issue_delivery_code() is
  'Issues a delivery code when an order enters out_for_delivery and deletes it '
  'when the order leaves. Security definer because clients cannot touch the '
  'table the code lives in.';

drop trigger if exists orders_issue_delivery_code on public.orders;
create trigger orders_issue_delivery_code
  after insert or update of status on public.orders
  for each row execute function public.issue_delivery_code();

-- Existing live deliveries (a real deployment applying this mid-day) need a
-- code too, or every rider currently on the road would be locked out.
insert into public.order_delivery_codes (order_id, code)
select o.id, public.new_delivery_code()
from public.orders o
where o.status = 'out_for_delivery'
on conflict (order_id) do nothing;

-- -----------------------------------------------------------------------------
-- 4. The customer reads their own code.
-- -----------------------------------------------------------------------------
-- A rider must NEVER be able to call this: reading the code would make the
-- handover meaningless. The check is the order's customer, or the owner (who
-- may need to read it out on the phone when a customer has closed the screen).
create or replace function public.my_delivery_code(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_user_id uuid;
  v_status  public.order_status;
  v_code    text;
begin
  if v_uid is null then
    raise exception 'Sign in to read a delivery code.'
      using errcode = '42501';
  end if;

  select o.user_id, o.status into v_user_id, v_status
  from public.orders o
  where o.id = p_order_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  -- The customer of THIS order, or the shop owner. Not another customer, and
  -- deliberately not a rider (whose role is 'delivery', not 'admin').
  if v_user_id is distinct from v_uid and not public.is_admin() then
    raise exception 'This is not your order.'
      using errcode = '42501';
  end if;

  if v_status <> 'out_for_delivery' then
    -- Not an error: the code is shown only while the bag is on its way, and the
    -- screen asks on every render.
    return jsonb_build_object('ok', false, 'error', 'not_available');
  end if;

  select c.code into v_code
  from public.order_delivery_codes c
  where c.order_id = p_order_id;

  if v_code is null then
    return jsonb_build_object('ok', false, 'error', 'not_available');
  end if;

  return jsonb_build_object('ok', true, 'code', v_code);
end;
$$;

comment on function public.my_delivery_code(uuid) is
  'The caller''s own delivery code for an out-for-delivery order. Takes the '
  'order id, never a user id. Refuses riders and other customers; the owner may '
  'read any order''s code to help on the phone.';

revoke all on function public.my_delivery_code(uuid) from public, anon;
grant execute on function public.my_delivery_code(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. The rider closes the delivery with the code.
-- -----------------------------------------------------------------------------
-- Returns jsonb rather than raising for the ordinary "that was the wrong
-- digits" case, so the rider screen can say how many tries are left without
-- parsing a Postgres error string. Real permission failures still raise 42501.
create or replace function public.complete_delivery(
  p_order_id uuid,
  p_code     text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_clean      text := nullif(btrim(coalesce(p_code, '')), '');
  v_assigned   uuid;
  v_status     public.order_status;
  v_code       text;
  v_attempts   integer;
  v_delivered  timestamptz;
begin
  if v_uid is null then
    raise exception 'Sign in before completing a delivery.'
      using errcode = '42501';
  end if;

  -- Only the assigned rider uses this path. The owner has a direct update as
  -- the documented escape hatch; allowing both would mean two ways to close an
  -- order with two different sets of rules.
  if public.current_user_role() is distinct from 'delivery' then
    raise exception 'Only the assigned rider can complete a delivery.'
      using errcode = '42501';
  end if;

  -- Lock the order first. Two taps on the same order (or a retry racing the
  -- first request) serialise here instead of both trying to consume the code.
  select o.assigned_to, o.status into v_assigned, v_status
  from public.orders o
  where o.id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  if v_assigned is distinct from v_uid then
    raise exception 'This order is not assigned to you.'
      using errcode = '42501';
  end if;

  if v_status <> 'out_for_delivery' then
    return jsonb_build_object('ok', false, 'error', 'not_out_for_delivery');
  end if;

  select c.code, c.attempts into v_code, v_attempts
  from public.order_delivery_codes c
  where c.order_id = p_order_id
  for update;

  if not found then
    -- Only reachable for an order that predates this migration and somehow
    -- missed the backfill. Tell the rider plainly; the owner closes it.
    return jsonb_build_object('ok', false, 'error', 'no_code');
  end if;

  if v_attempts >= 5 then
    return jsonb_build_object('ok', false, 'error', 'locked');
  end if;

  -- A letter, a blank or a 2-digit guess cannot match, so it is not counted as
  -- a try — otherwise a rider's fat finger would burn the customer's attempts.
  if v_clean is null or v_clean !~ '^[0-9]{4}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_code',
                              'attempts_left', 5 - v_attempts);
  end if;

  if v_clean <> v_code then
    update public.order_delivery_codes
       set attempts = attempts + 1
     where order_id = p_order_id;

    if v_attempts + 1 >= 5 then
      return jsonb_build_object('ok', false, 'error', 'locked');
    end if;

    return jsonb_build_object('ok', false, 'error', 'wrong_code',
                              'attempts_left', 5 - (v_attempts + 1));
  end if;

  -- The proof the BEFORE UPDATE guard looks for. Transaction-local, and bound
  -- to THIS order id, so the same transaction cannot close a second order.
  perform set_config('delivery.otp_verified', p_order_id::text, true);

  update public.orders
     set status = 'delivered',
         delivered_at = now()
   where id = p_order_id
  returning delivered_at into v_delivered;

  -- The AFTER trigger deletes the row as the status leaves out_for_delivery;
  -- this delete states the same guarantee in the one place a reader looks.
  delete from public.order_delivery_codes where order_id = p_order_id;

  return jsonb_build_object('ok', true, 'delivered_at', v_delivered);
end;
$$;

comment on function public.complete_delivery(uuid, text) is
  'Closes an out-for-delivery order as delivered when the caller is the '
  'assigned rider and p_code matches. Five wrong tries lock the code; the '
  'owner can then update the order directly.';

revoke all on function public.complete_delivery(uuid, text) from public, anon;
grant execute on function public.complete_delivery(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. The guard: a rider cannot say delivered without the code.
-- -----------------------------------------------------------------------------
-- A separate trigger rather than a rewrite of guard_order_update(), following
-- the precedent set by guard_picked_up_at(): that function is the allowlist for
-- every order column and re-creating it to add one rule is how a guard silently
-- loses another.
--
-- Trigger order is alphabetical, so this one fires before guard_order_update;
-- it only ever looks at a status change to 'delivered' and is a no-op otherwise.
create or replace function public.guard_delivery_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status or new.status <> 'delivered' then
    return new;
  end if;

  -- The shop owner may always close an order: they are the person who fields
  -- the phone call when a customer's screen is dead. This is the documented
  -- escape hatch, and it is deliberately visible in this function.
  if public.is_admin() then
    return new;
  end if;

  -- Only the delivery branch is new here; the customer branch was already
  -- refused by guard_order_update and stays refused for the same reason.
  if public.current_user_role() = 'delivery'
     and current_setting('delivery.otp_verified', true) is distinct from new.id::text then
    raise exception 'Enter the delivery code from the customer before completing this order.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.guard_delivery_code() is
  'Refuses a delivery partner''s move to delivered unless complete_delivery() '
  'verified the customer''s code for this exact order in this transaction. '
  'Admins are exempt (the documented escape hatch).';

drop trigger if exists orders_guard_delivery_code on public.orders;
create trigger orders_guard_delivery_code
  before update on public.orders
  for each row execute function public.guard_delivery_code();
