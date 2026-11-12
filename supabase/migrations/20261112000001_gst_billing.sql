-- =============================================================================
-- 36 · GST billing: rates on the shelf, a snapshot on the line, one invoice
--
-- The shop may or may not be GST-registered. `stores.gstin` already says which
-- (migration 20261020000002). This migration makes the money side follow:
--
--   1. every product carries a GST rate and, when the shop knows it, an HSN
--      code. The rate is a per-product fact, because a grocery basket mixes
--      0% fresh produce with 5% packaged staples and 18% on a bucket;
--   2. every ORDER LINE snapshots the rate and the HSN at the moment of sale,
--      exactly like the name and the price. A later rate change must never
--      rewrite an invoice that has already been issued;
--   3. `order_invoice()` is the ONE place the arithmetic lives. The app renders
--      its answer; it never recomputes tax from a product row.
--
-- Money rule (AGENTS.md §2, Rule 1) still holds: everything here is integer
-- paise. The only division is `round(...)` to the nearest paisa, done once per
-- line, and the invoice's own totals are sums of those integers.
--
-- Prices in an Indian shop are MRP-INCLUSIVE. So the tax is EXTRACTED from the
-- line total, not added to it:
--
--     taxable = round(net * 10000 / (10000 + rate_bp))
--     tax     = net - taxable
--
-- That keeps `taxable + tax = what the customer actually paid`, which is the
-- only property an invoice must never break.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. The shelf: a rate per product, and the HSN when the shop knows it.
--
-- The default is 0, deliberately. Guessing a rate would put a false tax figure
-- on a customer's bill; 0 says "the owner has not classified this yet", and the
-- invoice prints it as 0%. `set_product_gst()` below is the write path.
-- -----------------------------------------------------------------------------

alter table public.products
  add column if not exists gst_rate_bp integer not null default 0,
  add column if not exists hsn_code    text;

alter table public.products
  drop constraint if exists products_gst_rate_bp_valid,
  add constraint products_gst_rate_bp_valid
    check (gst_rate_bp in (0, 500, 1200, 1800, 2800)),
  drop constraint if exists products_hsn_code_valid,
  add constraint products_hsn_code_valid
    check (hsn_code is null or hsn_code ~ '^[0-9]{4,8}$');

comment on column public.products.gst_rate_bp is
  'GST rate in basis points: 0, 500 (5%), 1200 (12%), 1800 (18%), 2800 (28%). '
  'The shelf price is INCLUSIVE of this tax. 0 means "not classified yet", '
  'which prints as 0% rather than inventing a rate.';
comment on column public.products.hsn_code is
  'HSN classification, 4 to 8 digits. Null when the shop has not recorded it; '
  'an invoice then shows a dash, never a made-up code.';

-- The shop's own state decides CGST+SGST versus IGST. A single-town delivery is
-- always intra-state, but the column exists so the rule is stated rather than
-- assumed. 29 is Karnataka.
alter table public.stores
  add column if not exists state_code text not null default '29',
  add column if not exists state_name text not null default 'Karnataka';

alter table public.stores
  drop constraint if exists stores_state_code_valid,
  add constraint stores_state_code_valid check (state_code ~ '^[0-9]{2}$');

comment on column public.stores.state_code is
  'Two-digit GST state code (29 = Karnataka). Decides CGST+SGST vs IGST.';
comment on column public.stores.state_name is
  'State name as written in addresses, used to detect an inter-state supply.';

-- Delivery is a service, taxed at 18% when the shop charges a fee for it.
alter table public.store_settings
  add column if not exists delivery_gst_rate_bp integer not null default 1800;

alter table public.store_settings
  drop constraint if exists store_settings_delivery_gst_valid,
  add constraint store_settings_delivery_gst_valid
    check (delivery_gst_rate_bp in (0, 500, 1200, 1800, 2800));

comment on column public.store_settings.delivery_gst_rate_bp is
  'GST rate applied to the delivery fee, in basis points. 1800 = 18%.';

-- -----------------------------------------------------------------------------
-- 2. The order line: a frozen copy of the tax facts, and the derived paise.
-- -----------------------------------------------------------------------------

alter table public.order_items
  add column if not exists gst_rate_bp integer not null default 0,
  add column if not exists hsn_code    text;

comment on column public.order_items.gst_rate_bp is
  'The product''s GST rate at the moment of sale, copied by trigger. Frozen: a '
  'later rate change must not rewrite an issued invoice.';
comment on column public.order_items.hsn_code is
  'The product''s HSN at the moment of sale, copied by trigger. Null when the '
  'shop had not recorded one.';

-- There is deliberately NO `taxable_paise` / `tax_paise` column here.
--
-- `line_total_paise` is itself a generated column, and PostgreSQL forbids a
-- generated column from referencing another one — but the real reason is
-- better: a line's taxable value depends on the ORDER's coupon discount, which
-- is allocated across lines. Storing a per-line figure computed without the
-- discount would be a second, wrong answer sitting next to the right one.
-- `order_invoice()` below is the only place that arithmetic lives.

-- The line cannot be told what rate it had: it copies the product's rate at the
-- moment of insert. A client that could send its own rate could send 0% and pay
-- no tax, which is the same class of hole as sending its own price.
create or replace function public.snapshot_item_tax()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.product_id is not null then
    select p.gst_rate_bp, p.hsn_code
      into new.gst_rate_bp, new.hsn_code
      from public.products p
     where p.id = new.product_id;
  end if;

  return new;
end;
$$;

comment on function public.snapshot_item_tax() is
  'Copies the product GST rate and HSN onto the order line. Overwrites anything '
  'the insert supplied, so a client cannot choose its own tax rate.';

drop trigger if exists order_items_snapshot_tax on public.order_items;
create trigger order_items_snapshot_tax
  before insert on public.order_items
  for each row execute function public.snapshot_item_tax();

-- -----------------------------------------------------------------------------
-- 3. The invoice number.
--
-- A GST invoice needs a consecutive serial per financial year (1 April to
-- 31 March). The number is assigned when the order row is written, in IST, so
-- an order placed at 00:30 on 1 April gets the new year's series.
--
-- It is a sequence rather than a counter table on purpose: a rolled-back order
-- leaves a gap either way, and a sequence cannot hand the same number to two
-- concurrent orders. The shop's books must reconcile to the order table, which
-- is the property that matters.
-- -----------------------------------------------------------------------------

create sequence if not exists public.invoice_number_seq as bigint start 1;

create or replace function public.financial_year_label(p_at timestamptz)
returns text
language sql
stable
as $$
  select case
    when extract(month from (p_at at time zone 'Asia/Kolkata')) >= 4
      then extract(year from (p_at at time zone 'Asia/Kolkata'))::integer::text
           || '-'
           || lpad(((extract(year from (p_at at time zone 'Asia/Kolkata'))::integer + 1) % 100)::text, 2, '0')
    else (extract(year from (p_at at time zone 'Asia/Kolkata'))::integer - 1)::text
           || '-'
           || lpad((extract(year from (p_at at time zone 'Asia/Kolkata'))::integer % 100)::text, 2, '0')
  end
$$;

comment on function public.financial_year_label(timestamptz) is
  'Indian financial-year label in IST: 2026-11-12 -> 2026-27, 2027-04-01 -> 2027-28.';

create or replace function public.next_invoice_number(p_at timestamptz)
returns text
language sql
volatile
as $$
  select 'INV/' || public.financial_year_label(p_at) || '/'
       || lpad(nextval('public.invoice_number_seq')::text, 6, '0')
$$;

-- `payment_reference` and `is_express` are added here, with the invoice columns,
-- because the invoice PRINTS them. The functions that WRITE them arrive in the
-- next migrations; the columns are part of the document's shape.
alter table public.orders
  add column if not exists invoice_number text,
  add column if not exists place_of_supply_state_code text,
  add column if not exists is_intra_state boolean not null default true,
  add column if not exists payment_reference text,
  add column if not exists is_express boolean not null default false;

alter table public.orders
  drop constraint if exists orders_invoice_number_key,
  add constraint orders_invoice_number_key unique (invoice_number);

comment on column public.orders.invoice_number is
  'INV/<financial year>/<serial>. Assigned once, on insert, and never rewritten.';
comment on column public.orders.is_intra_state is
  'True when the delivery address state matches the shop state. Decides '
  'CGST+SGST versus IGST on the invoice.';

-- Backfill the orders that already exist, in placement order, so the books are
-- continuous from the first order rather than starting mid-ledger.
do $$
declare
  v_row record;
begin
  for v_row in
    select o.id, o.placed_at
      from public.orders o
     where o.invoice_number is null
     order by o.placed_at, o.order_number
  loop
    update public.orders
       set invoice_number = public.next_invoice_number(v_row.placed_at)
     where id = v_row.id;
  end loop;
end;
$$;

create or replace function public.orders_billing_defaults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_name text;
begin
  if new.invoice_number is null then
    new.invoice_number := public.next_invoice_number(coalesce(new.placed_at, now()));
  end if;

  select s.state_code, s.state_name
    into v_code, v_name
    from public.stores s
   where s.id = new.store_id;

  new.place_of_supply_state_code := coalesce(v_code, '29');

  -- An empty state is a local address written before the field was filled in.
  -- Treat it as intra-state rather than inventing an inter-state supply.
  new.is_intra_state :=
    coalesce(trim(new.delivery_address ->> 'state'), '') = ''
    or lower(trim(new.delivery_address ->> 'state')) = lower(coalesce(v_name, ''));

  return new;
end;
$$;

drop trigger if exists orders_billing_defaults on public.orders;
create trigger orders_billing_defaults
  before insert on public.orders
  for each row execute function public.orders_billing_defaults();

-- -----------------------------------------------------------------------------
-- 4. The invoice itself.
--
-- One function, one arithmetic. It answers the order's OWNER or any staff
-- member, and answers "not found" to everybody else rather than revealing that
-- an order id exists.
--
-- A coupon discount is allocated across the goods in proportion to each line,
-- with the rounding remainder given to the last line. That is what makes
-- `sum(taxable) + sum(tax) = total_paise` exact even when the discount does not
-- divide evenly. Delivery is not discounted (the shop's coupon reduces the
-- basket), so it is added as its own taxed line afterwards.
-- -----------------------------------------------------------------------------

create or replace function public.order_invoice(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid           uuid := auth.uid();
  v_order         public.orders%rowtype;
  v_store         public.stores%rowtype;
  v_settings      public.store_settings%rowtype;
  v_tax_invoice   boolean;
  v_lines         jsonb := '[]'::jsonb;
  v_goods_taxable bigint := 0;
  v_goods_tax     bigint := 0;
  v_del_taxable   bigint := 0;
  v_del_tax       bigint := 0;
  v_cgst          bigint := 0;
  v_sgst          bigint := 0;
  v_igst          bigint := 0;
  v_total_tax     bigint := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_logged_in');
  end if;

  select * into v_order from public.orders o where o.id = p_order_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_order.user_id <> v_uid and not public.is_staff() then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_store from public.stores s where s.id = v_order.store_id;
  select * into v_settings from public.store_settings ss where ss.store_id = v_order.store_id;

  -- An unregistered shop issues a bill of supply, not a tax invoice. Printing
  -- CGST on a document with no GSTIN would be a false document.
  v_tax_invoice := v_store.gstin is not null;

  with base as (
    select oi.id,
           oi.product_name_en,
           oi.product_name_kn,
           oi.hsn_code,
           oi.unit,
           oi.quantity,
           oi.price_paise,
           oi.line_total_paise,
           oi.gst_rate_bp,
           sum(oi.line_total_paise) over () as subtotal
      from public.order_items oi
     where oi.order_id = p_order_id
  ),
  raw as (
    select b.*,
           case when b.subtotal = 0 then 0::bigint
                else (v_order.discount_paise::bigint * b.line_total_paise) / b.subtotal
           end as disc_floor
      from base b
  ),
  alloc as (
    select r.*,
           r.disc_floor
             + case when row_number() over (order by r.id desc) = 1
                    then v_order.discount_paise - sum(r.disc_floor) over ()
                    else 0
               end as disc
      from raw r
  ),
  priced as (
    select a.*,
           (a.line_total_paise - a.disc) as net_paise,
           case when v_tax_invoice
                then round((a.line_total_paise - a.disc)::numeric * 10000
                           / (10000 + a.gst_rate_bp))::bigint
                else (a.line_total_paise - a.disc)::bigint
           end as taxable_paise
      from alloc a
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'name_en', p.product_name_en,
               'name_kn', p.product_name_kn,
               'hsn_code', p.hsn_code,
               'unit', p.unit,
               'quantity', p.quantity,
               'price_paise', p.price_paise,
               'line_total_paise', p.line_total_paise,
               'discount_paise', p.disc,
               'net_paise', p.net_paise,
               'gst_rate_bp', p.gst_rate_bp,
               'taxable_paise', p.taxable_paise,
               'tax_paise', p.net_paise - p.taxable_paise
             )
             order by p.product_name_en, p.id
           ),
           '[]'::jsonb
         )
    into v_lines
    from priced p;

  select coalesce(sum((l ->> 'taxable_paise')::bigint), 0),
         coalesce(sum((l ->> 'tax_paise')::bigint), 0)
    into v_goods_taxable, v_goods_tax
    from jsonb_array_elements(v_lines) l;

  if v_order.delivery_fee_paise > 0 then
    v_del_taxable := case when v_tax_invoice
      then round(v_order.delivery_fee_paise::numeric * 10000
                 / (10000 + v_settings.delivery_gst_rate_bp))::bigint
      else v_order.delivery_fee_paise::bigint
    end;
    v_del_tax := v_order.delivery_fee_paise - v_del_taxable;
  end if;

  if v_tax_invoice then
    v_total_tax := v_goods_tax + v_del_tax;

    if v_order.is_intra_state then
      -- The odd paisa goes to SGST, so CGST + SGST is exactly the tax.
      v_cgst := v_total_tax / 2;
      v_sgst := v_total_tax - v_cgst;
    else
      v_igst := v_total_tax;
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'invoice_number', v_order.invoice_number,
    'order_number', v_order.order_number,
    'order_id', v_order.id,
    'placed_at', v_order.placed_at,
    'order_status', v_order.status,
    'is_tax_invoice', v_tax_invoice,
    'is_intra_state', v_order.is_intra_state,
    'place_of_supply_state_code', v_order.place_of_supply_state_code,
    'seller', jsonb_build_object(
      'name', v_store.name,
      'address_line', v_store.address_line,
      'city', v_store.city,
      'phone', v_store.phone,
      'gstin', v_store.gstin,
      'fssai_number', v_store.fssai_number,
      'state_code', v_store.state_code
    ),
    'buyer', jsonb_build_object(
      'full_name', v_order.delivery_address ->> 'full_name',
      'phone', v_order.delivery_address ->> 'phone',
      'line1', v_order.delivery_address ->> 'line1',
      'line2', v_order.delivery_address ->> 'line2',
      'landmark', v_order.delivery_address ->> 'landmark',
      'city', v_order.delivery_address ->> 'city',
      'state', v_order.delivery_address ->> 'state',
      'pincode', v_order.delivery_address ->> 'pincode'
    ),
    'payment_method', v_order.payment_method,
    'payment_status', v_order.payment_status,
    'payment_reference', v_order.payment_reference,
    'is_express', v_order.is_express,
    'lines', v_lines,
    'delivery', jsonb_build_object(
      'fee_paise', v_order.delivery_fee_paise,
      'taxable_paise', v_del_taxable,
      'tax_paise', v_del_tax,
      'gst_rate_bp', v_settings.delivery_gst_rate_bp
    ),
    'totals', jsonb_build_object(
      'subtotal_paise', v_order.subtotal_paise,
      'discount_paise', v_order.discount_paise,
      'taxable_paise', v_goods_taxable + v_del_taxable,
      'cgst_paise', v_cgst,
      'sgst_paise', v_sgst,
      'igst_paise', v_igst,
      'tax_paise', v_total_tax,
      'total_paise', v_order.total_paise,
      'round_off_paise', 0
    ),
    'notes', v_order.notes
  );
end;
$$;

comment on function public.order_invoice(uuid) is
  'The one GST arithmetic in the system. Returns the order as an invoice: lines, '
  'discount allocated proportionally, taxable and tax per line, CGST/SGST or '
  'IGST, and the grand total. Answers the order owner or staff only.';

-- -----------------------------------------------------------------------------
-- 5. The write path for the tax facts.
--
-- A separate RPC from `update_product_from_shop()` on purpose: a rate is a
-- once-a-year classification, not the daily price/stock edit, and adding
-- parameters to a function with defaults creates an ambiguous overload.
-- -----------------------------------------------------------------------------

create or replace function public.set_product_gst(
  p_product_id uuid,
  p_gst_rate_bp integer,
  p_hsn_code    text default null
)
returns public.products
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_product public.products;
begin
  if not public.is_admin() then
    raise exception 'Only the shop can change a product''s tax rate.'
      using errcode = '42501';
  end if;

  if p_gst_rate_bp is null or p_gst_rate_bp not in (0, 500, 1200, 1800, 2800) then
    raise exception 'GST rate must be one of 0, 5, 12, 18 or 28 percent.'
      using errcode = '22023';
  end if;

  if p_hsn_code is not null and p_hsn_code !~ '^[0-9]{4,8}$' then
    raise exception 'HSN must be 4 to 8 digits, or empty.'
      using errcode = '22023';
  end if;

  update public.products
     set gst_rate_bp = p_gst_rate_bp,
         hsn_code    = nullif(trim(p_hsn_code), ''),
         updated_at  = now()
   where id = p_product_id
  returning * into v_product;

  if not found then
    raise exception 'That product is not on this shop''s shelf.'
      using errcode = 'P0002';
  end if;

  return v_product;
end;
$$;

comment on function public.set_product_gst(uuid, integer, text) is
  'Admin-only: set one product''s GST rate (basis points) and optional HSN. '
  'Raises instead of silently matching zero rows.';

revoke execute on function public.set_product_gst(uuid, integer, text) from public, anon;
grant execute on function public.set_product_gst(uuid, integer, text) to authenticated, service_role;

revoke execute on function public.order_invoice(uuid) from public, anon;
grant execute on function public.order_invoice(uuid) to authenticated, service_role;

revoke execute on function public.financial_year_label(timestamptz) from public, anon;
grant execute on function public.financial_year_label(timestamptz) to authenticated, service_role;
