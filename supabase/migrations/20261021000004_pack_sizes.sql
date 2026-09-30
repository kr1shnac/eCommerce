-- =============================================================================
-- M4 · What a "unit" of a product actually is
-- =============================================================================
-- Register M4 was written as "quantity is integer — loose weights cannot be sold",
-- and the obvious fix looks like making `quantity` a `numeric(10,3)`. That fix is
-- WRONG here, and this migration exists to explain why and do the right thing.
--
-- WHY DECIMAL QUANTITY WAS REJECTED
--
--   `order_items.line_total_paise` is `generated always as (price_paise * quantity)
--   stored` and is an INTEGER (migration 20261002000005, and AGENTS Rule 1: money
--   is always integer paise).
--
--   Make `quantity` numeric and that generated expression becomes fractional.
--   Postgres would round it — and then `total_paise = subtotal_paise +
--   delivery_fee_paise - discount_paise` (a CHECK) would be comparing a client-sent
--   total against a *rounded* sum of rounded line totals. Two roundings that can
--   disagree by a paisa, on a constraint whose whole purpose is that they never
--   disagree. `place_order()` computes `v_subtotal = price_paise * qty` as a bigint,
--   so it would round differently again.
--
--   The failure mode is the exact one Rule 9.1 exists to prevent: a total that is
--   off by a paisa, intermittently, on some orders. Nobody would ever find it.
--
--   There is also a plain-language argument. "0.5 of a tomato" is not a thing a
--   customer says. In this shop the words are **half a kilo** and **a quarter** —
--   and a half-kilo is a *packet*, priced as a packet.
--
-- WHAT THE SEED ACTUALLY SHOWS (this is the whole insight)
--
--   Tomato   ₹18 / 500 g
--   Onion    ₹26 / 1 kg
--   Chilli   ₹9  / 100 g
--
--   The shop **already sells by pack**, and every price is a whole number of paise.
--   What was missing is not decimals — it is that `unit` is free text ('500 g',
--   '1 kg', 'packet'), so the app cannot tell that Tomato and Onion are the same
--   kind of thing in different pack sizes. It cannot offer "also in 1 kg", and it
--   cannot say what 3 × Tomato weighs.
--
-- THE FIX: make the unit STRUCTURED, not fractional.
--
--   * `products.sold_by`  — 'piece' (count it) or 'measure' (weigh it out).
--   * `products.pack_size`/`pack_unit` — the pack as a number and a unit, so
--     '500 g' is stored as (500, 'g') and can be compared and converted.
--   * `quantity` stays an INTEGER count of packs. Rule 1 is untouched, the
--     generated column stays exact, and no paisa is ever rounded.
--
--   The customer-facing win is real: for a 'measure' product the app can offer a
--   "1 kg" alternative and say "3 × 500 g = 1.5 kg" — which is what a shopkeeper
--   says — without a single fractional paise anywhere.
--
-- ORDER: numeric quantity was considered and rejected on the record, because a
-- future session will otherwise "simplify" this back to decimals. Do not.

begin;

-- -----------------------------------------------------------------------------
-- 1. The two enums
-- -----------------------------------------------------------------------------
-- `sold_by` drives presentation only: a 'piece' product gets a plain stepper, a
-- 'measure' product gets pack-size chips. It deliberately does NOT change how
-- money is computed — the server already ignores everything the client sends
-- (Rule 9.1) and this adds no new client-supplied number.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'product_sold_by') then
    create type public.product_sold_by as enum ('piece', 'measure');
  end if;
end $$;

-- The unit a pack is measured in. A closed list, not free text, so 'g' and 'kg'
-- can be converted and compared. 'ml'/'l' are separate from 'g'/'kg' because grams
-- of milk and millilitres of milk are not the same number.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'pack_unit') then
    create type public.pack_unit as enum ('g', 'kg', 'ml', 'l', 'piece');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 2. The columns
-- -----------------------------------------------------------------------------
alter table public.products
  add column if not exists sold_by   public.product_sold_by not null default 'piece',
  add column if not exists pack_size numeric(10, 3),
  add column if not exists pack_unit public.pack_unit;

comment on column public.products.sold_by is
  'How the shop sells it: piece = counted (2 packets, 3 soaps); measure = weighed or poured (rice, dal, milk). Presentation only — it never changes how money is computed.';
comment on column public.products.pack_size is
  'The size of ONE pack, in pack_unit. Tomato sold as a 500 g pack is (500, ''g''). NULL for a plain piece product. Never fractional money — this is weight, not price.';
comment on column public.products.pack_unit is
  'The unit pack_size is measured in. See pack_size.';

-- A 'measure' product must say what the pack is, or the app cannot offer an
-- alternative size. A 'piece' product normally has none, but a 200 ml bottle of
-- water IS both — so pack_size is allowed but not required for 'piece'.
alter table public.products
  drop constraint if exists products_pack_fields_agree;
alter table public.products
  add constraint products_pack_fields_agree check (
    (sold_by = 'measure' and pack_size is not null and pack_size > 0 and pack_unit is not null)
    or (sold_by = 'piece')
  );

-- pack_size is a weight/volume, so it can never be negative or zero. (Covered by
-- the check above for 'measure'; this catches a stray 'piece' row with a negative.)
alter table public.products
  drop constraint if exists products_pack_size_positive;
alter table public.products
  add constraint products_pack_size_positive check (pack_size is null or pack_size > 0);

-- -----------------------------------------------------------------------------
-- 3. Teach the shelves about the enumeration
-- -----------------------------------------------------------------------------
-- The product guard freezes identity columns so a mis-tap cannot repoint a
-- product at another shop (migration 20261021000003). `sold_by`/`pack_size`/
-- `pack_unit` ARE identity — changing "500 g" to "1 kg" changes what the customer
-- thinks they are buying, so it belongs to the same freeze as name and store.
--
-- The guard is re-created here rather than edited there, because that migration is
-- already applied. Same behaviour, three more frozen columns.
-- The freeze above is right for the app, but it would also stop the seed and a
-- later data migration from normalising rows — they run as `postgres`, so they do
-- not look like a "client", and freezing identity for them means no data migration
-- can ever change what a pack is. So there is a second, narrower door: a
-- transaction-local flag set only by code that is deliberately rewriting product
-- identity (the seed, a backfill), never by the app.
--
-- It is checked BEFORE the freeze and after the stock-move branch. Unlike
-- `kunigal.moving_stock` there is no shape restriction, because the whole purpose
-- is to allow a shape change — but a customer cannot reach it: the flag is only
-- ever set with `set_config(..., true)` inside a server-side statement, and the
-- non-admin client branch above raises before this point regardless of the flag.
do $$
begin
  if not exists (
    select 1 from pg_proc where proname = 'identity_edit_in_progress'
  ) then
    create function public.identity_edit_in_progress()
    returns boolean
    language sql
    stable
    as $fn$
      select coalesce(current_setting('kunigal.editing_identity', true), '') = 'on'
    $fn$;
  end if;
end $$;

comment on function public.identity_edit_in_progress() is
  'True only inside the seed or a deliberate data migration. Lets a backfill normalise product identity (sold_by, pack_size, pack_unit) without weakening the freeze the app sees.';

create or replace function public.guard_product_update()
returns trigger
language plpgsql
as $$
declare
  v_client boolean;
begin
  -- Is this an ordinary signed-in client (the app), or internal code (a
  -- migration, a fixture, place_order's stock move)?
  v_client :=
    public.current_user_role() <> 'admin'
    and auth.uid() is not null
    and current_user = 'authenticated';

  -- A non-admin client may not write to products at all. RLS already hides the
  -- row, so an UPDATE matches zero rows and raises NOTHING — a save button built
  -- on that reports success while saving nothing. Refuse loudly instead.
  if v_client then
    raise exception
      'a non-admin may not update products'
      using errcode = '42501';
  end if;

  -- Stock moves done by the order functions are exempt, but ONLY for stock_qty.
  -- A flag alone would be a hole any customer could borrow.
  if public.stock_move_in_progress() then
    if new.id            is distinct from old.id
      or new.store_id    is distinct from old.store_id
      or new.name_en     is distinct from old.name_en
      or new.name_kn     is distinct from old.name_kn
      or new.price_paise is distinct from old.price_paise
      or new.mrp_paise   is distinct from old.mrp_paise
      or new.is_active   is distinct from old.is_active
      or new.sold_by     is distinct from old.sold_by
      or new.pack_size   is distinct from old.pack_size
      or new.pack_unit   is distinct from old.pack_unit
    then
      raise exception
        'a stock move may only change stock_qty'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Identity is frozen even for the admin. Moving a product to another shop would
  -- silently repoint existing order history; one shop, so a second is a deliberate
  -- migration, not a tap. Renaming is a bigger decision than a shelf edit.
  --
  -- The pack fields belong in this list (register M4). Selling "1 kg" of rice and
  -- selling "5 kg" of rice at the same price are two different products; if a
  -- mis-tap could change `pack_size` on an ordinary shelf save, the customer would
  -- be charged the 1 kg price for 5 kg, and nothing in the flow would look wrong.
  -- So changing what the pack IS requires a deliberate path, not a price edit.
  --
  -- A deliberate backfill (the seed, a data migration) sets its own flag to step
  -- past this — see `identity_edit_in_progress()` above the function.
  if not public.identity_edit_in_progress() then
    if new.id         is distinct from old.id
      or new.store_id is distinct from old.store_id
      or new.sold_by  is distinct from old.sold_by
      or new.pack_size is distinct from old.pack_size
      or new.pack_unit is distinct from old.pack_unit
    then
      raise exception
        'product identity (id, store_id, sold_by, pack_size, pack_unit) is frozen'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.guard_product_update() is
  'Freezes product identity against a mis-tap, refuses non-admin writes loudly (RLS would silently match zero rows), and lets the order functions move stock_qty only — via a transaction-local flag AND a shape check, because a flag alone is a hole.';

-- -----------------------------------------------------------------------------
-- 4. The shelf edit door learns the new fields
-- -----------------------------------------------------------------------------
-- Re-created (not edited) because the previous definition is already applied.
--
-- THE SIGNATURE IS EXTENDED, NOT REPLACED. Every existing argument keeps both its
-- name and its default, and the three pack arguments are appended as NULLABLE
-- DEFAULTS. Two traps live here, and the first version of this migration fell into
-- the second one:
--
--   1. `create or replace` cannot change an argument list, so the old function
--      must be dropped. But dropping must not change how CALLERS resolve it.
--      Test 20 calls this positionally (`(id, 1)`) AND with named arguments
--      (`(id, p_stock_qty => 0)`), so the entire original prefix has to survive
--      exactly as it was.
--   2. **`null` already means "leave this field alone"** in this function — every
--      parameter is nullable and a null skip is what lets the phone send only the
--      fields it changed (see the comment further down). So `p_pack_size => null`
--      must NOT mean "clear the pack". The first draft made it mean that and broke
--      test 20, which is the test doing its job.
--
--      Passing null still means "leave it alone", and the way to change a pack is
--      to pass a pack. That is also the honest semantic: clearing the pack of a
--      'measure' product is refused by the CHECK, because a weighed product with no
--      weight is a contradiction, not an edit. Turning a weighed product into a
--      counted one is an explicit `p_sold_by => 'piece'`, which the guard freezes
--      as an identity change rather than treating it as a shelf tweak.
drop function if exists public.update_product_from_shop(
  uuid, integer, integer, integer, boolean, text
);

create or replace function public.update_product_from_shop(
  p_product_id  uuid,
  p_price_paise integer default null,
  p_mrp_paise   integer default null,
  p_stock_qty   integer default null,
  p_is_active   boolean default null,
  p_emoji       text    default null,
  p_sold_by     public.product_sold_by default null,
  p_pack_size   numeric default null,
  p_pack_unit   public.pack_unit default null
)
returns public.products
language plpgsql
-- Deliberately NOT security definer: it runs as the caller, so the RLS policy
-- ("admins manage products") stays the single authorisation authority, and the
-- product guard sees an ordinary client update.
as $$
declare
  v_row public.products;
begin
  -- Raise on "not admin" rather than returning nothing: a caller cannot tell
  -- "saved" from "silently matched zero rows" otherwise (see the guard's comment).
  if not public.is_admin() then
    raise exception 'only the shop owner may change the shelf'
      using errcode = '42501';
  end if;

  -- Every field is coalesced against the existing value, so a null argument means
  -- "the phone did not send this" and the column is left alone. mrp_paise is the
  -- one exception: it is nullable by design (a shop may not print an MRP), so
  -- passing 0 explicitly means "no printed MRP", which is different from "free".
  update public.products
     set price_paise = coalesce(p_price_paise, price_paise),
         mrp_paise   = case
                         when p_mrp_paise is null then mrp_paise
                         when p_mrp_paise > 0    then p_mrp_paise
                         else null
                       end,
         stock_qty   = coalesce(p_stock_qty, stock_qty),
         is_active   = coalesce(p_is_active, is_active),
         emoji       = case
                         when p_emoji is null then emoji
                         else nullif(btrim(p_emoji), '')
                       end,
         sold_by     = coalesce(p_sold_by, sold_by),
         pack_size   = coalesce(p_pack_size, pack_size),
         pack_unit   = coalesce(p_pack_unit, pack_unit)
   where id = p_product_id
   returning * into v_row;

  if not found then
    raise exception 'no product with id %', p_product_id
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

comment on function public.update_product_from_shop(uuid, integer, integer, integer, boolean, text, public.product_sold_by, numeric, public.pack_unit) is
  'The one honest write path for a shelf edit. Raises instead of silently matching zero rows when the caller is not the admin. Returns the stored row so the screen shows what Postgres actually saved. A null argument means "leave this field alone", including the pack fields — changing a pack requires passing a pack.';

-- -----------------------------------------------------------------------------
-- 5. A view for the customer, so a "which pack?" question is answerable
-- -----------------------------------------------------------------------------
-- Every product in the same category with the same base name is a candidate
-- alternative pack size. Kept as a view (not app code) so the rule lives in one
-- place and can be tested. `security_invoker` so the caller's RLS still applies —
-- this must not become a way around the products policy.
create or replace view public.product_pack_options
with (security_invoker = true) as
select
  p.id,
  p.store_id,
  p.category_id,
  p.sold_by,
  p.name_en,
  p.name_kn,
  p.price_paise,
  p.pack_size,
  p.pack_unit,
  -- A normalised size in the base unit (g or ml), so 500 g and 1 kg can be sorted
  -- and compared as the same scale. NULL when the pack is a plain piece.
  case
    when p.pack_size is null then null
    when p.pack_unit = 'kg'  then p.pack_size * 1000
    when p.pack_unit = 'l'   then p.pack_size * 1000
    else p.pack_size
  end as pack_in_base
from public.products p
where p.is_active = true;

comment on view public.product_pack_options is
  'Active products with their pack size normalised to g/ml, so the app can offer "also in 1 kg" without ever doing rupee arithmetic. security_invoker keeps the products RLS policy in force — this view is not a way around it.';

grant select on public.product_pack_options to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Index for the pack-size lookup
-- -----------------------------------------------------------------------------
create index if not exists products_pack_lookup_idx
  on public.products (store_id, category_id, sold_by)
  where is_active = true;

-- -----------------------------------------------------------------------------
-- 7. Backfill the seeded shelves from the free-text unit
-- -----------------------------------------------------------------------------
-- The seed's `unit` text is the source of truth for what the shop sells, so parse
-- the known shapes once. Anything unrecognised stays 'piece' with no pack, which
-- is the safe default: the app shows it exactly as it does today.
--
-- This is a deliberate identity rewrite, so it raises the guard's flag. It is set
-- and reset inside this transaction, and the whole migration is one transaction.
select set_config('kunigal.editing_identity', 'on', true);

update public.products
   set sold_by   = 'measure',
       pack_size = (regexp_match(lower(btrim(unit)), '^([0-9]+(?:\.[0-9]+)?)\s*(g|kg|ml|l)$'))[1]::numeric,
       pack_unit = (regexp_match(lower(btrim(unit)), '^([0-9]+(?:\.[0-9]+)?)\s*(g|kg|ml|l)$'))[2]::public.pack_unit
 where lower(btrim(unit)) ~ '^[0-9]+(\.[0-9]+)?\s*(g|kg|ml|l)$';

select set_config('kunigal.editing_identity', 'off', true);

-- A 500 ml / 1 L pack is a measure product too, and the regex above covered it.
-- Anything still saying 'piece' with a free-text unit like '1 packet' or 'dozen'
-- is genuinely a piece: the unit text already names the pack, so nothing is lost.

commit;
