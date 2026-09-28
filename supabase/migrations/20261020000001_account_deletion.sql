-- =============================================================================
-- 16 · Account deletion (DPDP Act 2023 §12, and both app stores)
--
-- WHY THIS EXISTS
--
-- Every app store requires a way to delete your account from inside the app, and
-- the DPDP Act gives a data principal the right to erasure. Until this migration
-- there was no way to do it at all (register C5).
--
-- THE HARD PART, AND WHY IT IS NOT A DELETE
--
-- `orders.user_id` is `on delete restrict`, on purpose. An order is the shop's
-- book of account: a shopkeeper must be able to answer "how much did we sell on
-- the 12th" and "what happened to order KNG-01023" long after the customer has
-- gone. Deleting the customer cannot delete the shop's ledger.
--
-- So deletion ERASES THE PERSON and KEEPS THE PAPERWORK:
--
--   * `profiles`        — full_name and phone are cleared.
--   * `addresses`       — every row is deleted. These are pure personal data with
--                         no book-keeping value.
--   * `favourites`      — deleted (cascade from profiles when the auth user goes).
--   * `orders`          — KEPT, but no longer linked to a person: `user_id` is
--                         moved to the tombstone profile, and the address snapshot
--                         (`delivery_address`) has its name, phone, line1, line2
--                         and landmark replaced with the erasure placeholder. The
--                         order number, items, money and timestamps all remain,
--                         so the books still balance.
--   * `auth.users`      — deleted, so the phone number can sign up again as a new
--                         person with no memory of the old one.
--
-- THE TOMBSTONE
--
-- `user_id` is `not null` and orders must survive, so the rows need *some* owner.
-- A single, well-known "deleted customer" profile takes them. It is not a login:
-- it is a `customer` with no phone and no name, and the guard trigger below stops
-- it being given one. Every erased order in the system points at it, which is
-- exactly what makes the erasure verifiable — if the tombstone owns the order,
-- the person is gone.
--
-- WHY AN RPC AND NOT A CLIENT-SIDE DELETE
--
-- A client cannot do this: deleting from `auth.users` needs the service key, and
-- that must never be in the app (AGENTS.md §4). This function is `security
-- definer` and does the whole erasure in ONE transaction, so there is no state
-- where the addresses are gone but the auth user remains. It takes no arguments
-- and can only ever act on `auth.uid()`: it is impossible to call it for somebody
-- else, which is the property that matters most about it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The tombstone profile
-- -----------------------------------------------------------------------------
-- A fixed uuid so it can be referred to in tests and in the admin panel without
-- a lookup. Deliberately the all-zeros uuid with a suffix, so it is obvious in a
-- dump that it is not a real person.
create or replace function public.deleted_customer_id()
returns uuid
language sql
immutable
as $$ select '00000000-0000-0000-0000-000000000d1d'::uuid $$;

comment on function public.deleted_customer_id() is
  'The owner of every erased order. Not a person, not a login, not editable.';

-- The row itself is created on first use, by the deletion function, because
-- `profiles.id` references `auth.users(id)` and creating a matching auth user is
-- not something a migration should do. The deletion function therefore inserts
-- the tombstone into `profiles` with a matching (unusable) `auth.users` row.

-- -----------------------------------------------------------------------------
-- The guard: the tombstone is not a person and cannot become one
-- -----------------------------------------------------------------------------
-- Without this, an admin could rename the tombstone, or an unlucky collision
-- could turn it into a working account. It also refuses to let it be deleted:
-- every erased order in the system points at it, and deleting it would fail the
-- foreign key anyway, but a clear error beats a foreign-key error.
create or replace function public.profiles_guard_deleted()
returns trigger
language plpgsql
as $$
begin
  -- Only the tombstone row is interesting here.
  --
  -- The DELETE branch must return OLD, not NEW. In a BEFORE DELETE trigger NEW
  -- is NULL, and returning NULL cancels the delete — so `return new` here would
  -- silently make every profile undeletable, which is exactly what it did until
  -- test 16 caught it.
  if old.id <> public.deleted_customer_id() then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception
      'the deleted-customer tombstone owns erased orders and cannot be deleted'
      using errcode = 'restrict_violation';
  end if;

  -- It must stay nameless, phoneless and a plain customer. `role` in particular:
  -- if the tombstone ever became an admin, every erased order would become
  -- admin-writable.
  if new.full_name is not null or new.phone is not null
     or new.role <> 'customer' then
    raise exception
      'the deleted-customer tombstone must stay anonymous and non-staff'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_deleted
  before update or delete on public.profiles
  for each row execute function public.profiles_guard_deleted();

-- -----------------------------------------------------------------------------
-- Let the erasure through the order guard
-- -----------------------------------------------------------------------------
-- `guard_order_update()` (migration 05) blocks a customer from changing
-- `user_id` or `delivery_address`, which is exactly what an erasure has to do.
-- The guard cannot simply ask "is this delete_my_account()?" — a trigger sees a
-- row, not a call stack — so the erasure announces itself with a
-- transaction-local flag, and the guard (replaced below) accepts the change ONLY
-- when the flag is set AND the row's new shape is exactly an erasure.
--
-- The shape check is the part that matters. The flag alone would be a hole: any
-- customer could set it and rewrite their own delivery address. With the shape
-- check, the only update the flag unlocks is "anonymous owner, blanked address,
-- no notes" — money, status, items and timestamps must all be untouched.
--
-- `set_config(..., true)` is transaction-local, so the flag cannot leak out of
-- the statement that set it. This function is the read side of that flag.
create or replace function public.erasure_in_progress()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('kunigal.erasing_account', true), '') = 'on'
$$;

comment on function public.erasure_in_progress() is
  'True only inside delete_my_account()''s transaction. Lets the order guard '
  'accept the erasure shape without accepting anything else.';

-- The CURRENT body, taken from 20261013000001_rider_assignment.sql, with the
-- erasure clause added at the top of the checks. Everything the guard protected
-- before is still protected; the rider branch is copied verbatim, because a
-- half-remembered rewrite is how a guard quietly stops guarding.
create or replace function public.guard_order_update()
returns trigger
language plpgsql
as $$
declare
  v_old_rank integer;
  v_new_rank integer;
begin
  -- Admin: full control, nothing to check.
  if public.is_admin() then
    return new;
  end if;

  -- ---------------------------------------------------------------------------
  -- An erasure (see delete_my_account below).
  --
  -- Checked BEFORE the customer branch, because a customer erasing their own
  -- account is still, by role, a customer — and the customer branch would
  -- refuse the very update the erasure exists to make. It is permitted only in
  -- the exact shape the erasure produces, so the flag on its own unlocks
  -- nothing: money, status, items, timestamps and the order number must all be
  -- untouched, the new owner must be the tombstone, and the address snapshot
  -- must carry the `erased` marker.
  -- ---------------------------------------------------------------------------
  if public.erasure_in_progress()
     and new.user_id = public.deleted_customer_id()
     and new.address_id is null
     and (new.delivery_address ->> 'erased') = 'true'
     and new.notes is null
     and new.order_number is not distinct from old.order_number
     and new.store_id is not distinct from old.store_id
     and new.status is not distinct from old.status
     and new.payment_method is not distinct from old.payment_method
     and new.payment_status is not distinct from old.payment_status
     and new.subtotal_paise is not distinct from old.subtotal_paise
     and new.delivery_fee_paise is not distinct from old.delivery_fee_paise
     and new.discount_paise is not distinct from old.discount_paise
     and new.total_paise is not distinct from old.total_paise
     and new.placed_at is not distinct from old.placed_at
     and new.delivered_at is not distinct from old.delivered_at then
    return new;
  end if;

  -- ---------------------------------------------------------------------------
  -- Delivery partner
  -- ---------------------------------------------------------------------------
  if public.current_user_role() = 'delivery' then
    -- Fields a rider may never change, whatever else they do. This is the same
    -- list migration 05 protected, plus idempotency_key and assigned_at.
    if new.order_number  is distinct from old.order_number
       or new.user_id        is distinct from old.user_id
       or new.store_id       is distinct from old.store_id
       or new.address_id     is distinct from old.address_id
       or new.delivery_address is distinct from old.delivery_address
       or new.payment_method is distinct from old.payment_method
       or new.subtotal_paise is distinct from old.subtotal_paise
       or new.delivery_fee_paise is distinct from old.delivery_fee_paise
       or new.discount_paise is distinct from old.discount_paise
       or new.total_paise    is distinct from old.total_paise
       or new.notes          is distinct from old.notes
       or new.placed_at      is distinct from old.placed_at
       or new.idempotency_key is distinct from old.idempotency_key then
      raise exception 'A delivery partner cannot change the details of an order.'
        using errcode = '42501';
    end if;

    -- Assignment. Either this is a claim (unassigned -> me) or the order was
    -- already mine and must stay mine.
    if new.assigned_to is distinct from old.assigned_to then
      if old.assigned_to is not null then
        raise exception 'This order is already assigned to a rider.'
          using errcode = '42501';
      end if;
      if new.assigned_to is distinct from auth.uid() then
        raise exception 'A rider may only claim an order for themselves.'
          using errcode = '42501';
      end if;
      if new.assigned_at is distinct from old.assigned_at
         and new.assigned_at is null then
        raise exception 'Claiming an order must record the time.'
          using errcode = '42501';
      end if;
    else
      -- Not a claim: the order must already be assigned to this rider.
      if old.assigned_to is distinct from auth.uid() then
        raise exception 'This order is not assigned to you.'
          using errcode = '42501';
      end if;
      if new.assigned_at is distinct from old.assigned_at then
        raise exception 'A rider cannot change when an order was claimed.'
          using errcode = '42501';
      end if;
    end if;

    -- Status may only move FORWARD, never back, and never to cancelled.
    if new.status is distinct from old.status then
      if new.status = 'cancelled' then
        raise exception 'A rider cannot cancel an order.'
          using errcode = '42501';
      end if;

      v_old_rank := case old.status
                      when 'placed'           then 1
                      when 'confirmed'        then 2
                      when 'packing'          then 3
                      when 'out_for_delivery' then 4
                      when 'delivered'        then 5
                      else 0
                    end;
      v_new_rank := case new.status
                      when 'placed'           then 1
                      when 'confirmed'        then 2
                      when 'packing'          then 3
                      when 'out_for_delivery' then 4
                      when 'delivered'        then 5
                      else 0
                    end;

      if v_new_rank <= v_old_rank then
        raise exception 'An order moves forward one step at a time.'
          using errcode = '42501';
      end if;
    end if;

    -- delivered_at is set when (and only when) the order is delivered.
    if new.status = 'delivered' then
      if new.delivered_at is null then
        raise exception 'Record the delivery time when marking an order delivered.'
          using errcode = '42501';
      end if;
    elsif new.delivered_at is distinct from old.delivered_at then
      raise exception 'Only a delivered order may record a delivery time.'
        using errcode = '42501';
    end if;

    return new;
  end if;

  -- ---------------------------------------------------------------------------
  -- Customer: may cancel, but only while the order is still unconfirmed, and
  -- may not touch any money, identity or assignment field while doing it.
  -- (Unchanged from migration 05, plus assigned_to/assigned_at must stay put.)
  -- ---------------------------------------------------------------------------
  if old.status = 'placed'
     and new.status = 'cancelled'
     and new.user_id is not distinct from old.user_id
     and new.store_id is not distinct from old.store_id
     and new.address_id is not distinct from old.address_id
     and new.delivery_address is not distinct from old.delivery_address
     and new.payment_method is not distinct from old.payment_method
     and new.payment_status is not distinct from old.payment_status
     and new.subtotal_paise is not distinct from old.subtotal_paise
     and new.delivery_fee_paise is not distinct from old.delivery_fee_paise
     and new.discount_paise is not distinct from old.discount_paise
     and new.total_paise is not distinct from old.total_paise
     and new.notes is not distinct from old.notes
     and new.placed_at is not distinct from old.placed_at
     and new.delivered_at is not distinct from old.delivered_at
     and new.assigned_to is not distinct from old.assigned_to
     and new.assigned_at is not distinct from old.assigned_at then
    return new;
  end if;

  raise exception 'Customers may only cancel an order that is still placed.';
end;
$$;

-- -----------------------------------------------------------------------------
-- delete_my_account()
-- -----------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user       uuid := auth.uid();
  v_tombstone  uuid := public.deleted_customer_id();
  v_addresses  integer := 0;
  v_orders     integer := 0;
  v_role       public.user_role;
  v_auth_users integer := 0;
begin
  -- 1. You must be signed in, and you can only ever delete yourself. There is no
  --    parameter, so there is nothing to forge.
  if v_user is null then
    raise exception 'not signed in' using errcode = 'insufficient_privilege';
  end if;

  if v_user = v_tombstone then
    raise exception 'the deleted-customer tombstone cannot delete itself'
      using errcode = 'insufficient_privilege';
  end if;

  select p.role into v_role from public.profiles p where p.id = v_user;
  if v_role is null then
    raise exception 'no profile for this account' using errcode = 'no_data_found';
  end if;

  -- 2. An admin deleting the only admin would lock the shop out of its own
  --    panel. A second admin must exist first (register H9 — the same gap, seen
  --    from the other side).
  if v_role = 'admin' then
    if (select count(*) from public.profiles p where p.role = 'admin') < 2 then
      raise exception
        'this is the only admin: add a second admin before deleting this account'
        using errcode = 'restrict_violation';
    end if;
  end if;

  -- 3. Make sure the tombstone exists. It needs an auth.users row because
  --    profiles.id references it. The row has no confirmed identity of any kind
  --    and no way to be signed into.
  --
  --    The column list is built from the catalogue rather than written out,
  --    because Supabase's real `auth.users` has `instance_id`, `aud`, `role` and
  --    `updated_at` while the local test stub deliberately has only the columns
  --    the migrations need. Writing them out would make this migration
  --    untestable, and an untestable deletion routine is the last thing that
  --    should exist (rule 9.7).
  declare
    v_cols text[] := array['id'];
    v_vals text[] := array[quote_literal(v_tombstone::text)];
  begin
    if exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'users'
                  and column_name = 'instance_id') then
      v_cols := v_cols || 'instance_id';
      v_vals := v_vals || quote_literal('00000000-0000-0000-0000-000000000000');
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'users'
                  and column_name = 'aud') then
      v_cols := v_cols || 'aud';
      v_vals := v_vals || quote_literal('authenticated');
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'users'
                  and column_name = 'role') then
      v_cols := v_cols || 'role';
      v_vals := v_vals || quote_literal('authenticated');
    end if;
    if exists (select 1 from information_schema.columns
                where table_schema = 'auth' and table_name = 'users'
                  and column_name = 'updated_at') then
      v_cols := v_cols || 'updated_at';
      v_vals := v_vals || 'now()';
    end if;

    execute format(
      'insert into auth.users (%s) values (%s) on conflict (id) do nothing',
      array_to_string(v_cols, ', '),
      array_to_string(v_vals, ', ')
    );
  end;

  insert into public.profiles (id, full_name, phone, role, preferred_language)
  values (v_tombstone, null, null, 'customer', 'en')
  on conflict (id) do nothing;

  -- 4. Keep the orders, strip the person out of them. The address snapshot is
  --    the only place the delivery details survive, so it is rewritten in place;
  --    the money, items and timestamps are untouched and the books still balance.
  --
  --    The flag tells `guard_order_update()` that this update is an erasure. It
  --    is transaction-local, so it is gone before this function returns.
  --
  --    THIS MUST RUN BEFORE THE ADDRESSES ARE DELETED. `orders.address_id` is
  --    `on delete set null`, so removing an address makes Postgres issue its own
  --    UPDATE on the order — an UPDATE the guard sees, and refuses, because it
  --    is not the erasure shape. Setting `address_id = null` here first means the
  --    cascade later has nothing to change.
  perform set_config('kunigal.erasing_account', 'on', true);

  update public.orders o
     set user_id = v_tombstone,
         address_id = null,
         delivery_address = jsonb_build_object(
           'erased', true,
           'full_name', 'Deleted customer',
           'phone',    '',
           'line1',    '',
           'line2',    '',
           'landmark', '',
           'city',     coalesce(o.delivery_address ->> 'city', 'Kunigal'),
           'state',    coalesce(o.delivery_address ->> 'state', 'Karnataka'),
           'pincode',  coalesce(o.delivery_address ->> 'pincode', '')
         ),
         notes = null
   where o.user_id = v_user;
  get diagnostics v_orders = row_count;

  perform set_config('kunigal.erasing_account', 'off', true);

  -- 5. Erase the addresses. They are personal data and nothing else, and the
  --    orders no longer point at any of them, so no cascade can fire here.
  delete from public.addresses a where a.user_id = v_user;
  get diagnostics v_addresses = row_count;

  -- 6. The auth user. Cascades to favourites and to the profile row. Must be
  --    last: steps 4 and 5 need `v_user` to still be a real profile.
  delete from auth.users u where u.id = v_user;
  get diagnostics v_auth_users = row_count;

  return jsonb_build_object(
    'addresses_erased', v_addresses,
    'orders_anonymised', v_orders,
    'accounts_erased', v_auth_users
  );
end;
$$;

comment on function public.delete_my_account() is
  'Erases the calling user: addresses deleted, orders anonymised to the '
  'tombstone, auth user removed. Keeps the shop''s books. One transaction.';

-- Only signed-in people may even reach it, and it can only act on itself.
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
