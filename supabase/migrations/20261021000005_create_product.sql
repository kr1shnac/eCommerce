-- =============================================================================
-- 20261021000005 · Adding a product from the owner's phone
-- =============================================================================
--
-- Register M6. The i18n system was built for READING: every customer-visible
-- string has a `_kn` twin and the app cannot show a raw English word. But nobody
-- asked how the owner types a NEW product's Kannada name — and until now the
-- answer was "he cannot", because there was no way to add a product from the app
-- at all. The web panel (`apps/admin`) can create one, but it is a desk tool, and
-- the whole premise of the Shelf tab is that the owner runs the shop standing up.
-- A shop's shelf changes faster than its desk habits.
--
-- This migration adds the one honest write path for a new product.
--
-- WHY AN RPC AND NOT A PLAIN `.insert()` — THE SAME REASON AS THE SHELF EDIT
-- ---------------------------------------------------------------------------
-- `supabase.from('products').insert(...)` by someone who is not the admin matches
-- the RLS `with check` and is refused with `42501`… except when it is not: a
-- policy is a *filter*, and a mistake in how the client calls it can turn a
-- refusal into zero rows and no error. The shelf edit already learned this
-- (migration 20261021000003) and the lesson is the same here: a save button that
-- reports success while saving nothing is the exact lie rule 9.4 is about. The RPC
-- RAISES on "not the owner", and returns the row as Postgres actually stored it
-- (rule 9.1: the screen shows the stored number, not the number it hoped to write).
--
-- WHY `store_id` IS NOT AN ARGUMENT
-- ---------------------------------
-- The client never names the shop. The function finds the one active store itself.
-- If `store_id` came from the app, a mis-signed-in owner — or a modified client —
-- could create a product in a shop they do not own, and the RLS policy ("admins
-- manage products") would happily allow it, because it authorises on ROLE, not on
-- which shop. One shop today, but the rule is written for the second one.
--
-- This is deliberately NOT `security definer`. It runs as the caller, so the RLS
-- policy stays the single authorisation authority and this function adds a rule
-- rather than replacing one.
--
-- WHY THE KANNADA NAME IS REQUIRED, AND REQUIRED TO BE DIFFERENT
-- -------------------------------------------------------------
-- `products.name_kn` is `not null` in the schema, but an empty string satisfies
-- that while breaking the customer's screen (KUNIGAL.md §1: one in three adults
-- here cannot read the English name, so a blank Kannada label is a blank shelf
-- label). The function refuses a blank Kannada name, and refuses one that is just
-- the English name copied across — because that looks filled-in but is not
-- Kannada, and it is exactly what a hurried owner would do. Both refusals carry a
-- distinct message so the screen can translate the reason.
--
-- The `unit` free text is DERIVED from the structured pack rather than typed a
-- second time: two places to write one fact is two places to disagree (the same
-- reasoning as `seed.sql`).

begin;

-- -----------------------------------------------------------------------------
-- 1. A human-readable Kannada check that can be reused
-- -----------------------------------------------------------------------------
-- KANNADA_RANGE is U+0C80–U+0CFF, the Unicode block for the Kannada script. A
-- name with no character in that block is not Kannada, whatever it looks like.
--
-- This is a HEURISTIC and is commented as one: it cannot know that 'ಟೊಮೆಟೊ' means
-- tomato, only that the letters are Kannada letters. That is the honest limit —
-- the shop's own helper is the authority on wording, and a transliteration helper
-- that guessed would be worse than one that only checks the script.
create or replace function public.looks_like_kannada(p_text text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_text, '') ~ '[\u0C80-\u0CFF]'
$$;

comment on function public.looks_like_kannada(text) is
  'True when the text contains at least one character from the Kannada Unicode block. A heuristic: it checks the script, never the meaning.';

-- -----------------------------------------------------------------------------
-- 2. The create path
-- -----------------------------------------------------------------------------
create or replace function public.create_product_from_shop(
  p_name_en     text,
  p_name_kn     text,
  p_price_paise integer,
  p_category_id uuid,
  p_sold_by     public.product_sold_by default 'piece',
  p_pack_size   numeric default null,
  p_pack_unit   public.pack_unit default null,
  p_mrp_paise   integer default null,
  p_stock_qty   integer default 0,
  p_emoji       text default null
)
returns public.products
language plpgsql
as $$
declare
  v_store_id uuid;
  v_row      public.products;
  v_unit     text;
begin
  -- The door, checked before a single row is read — the same shape as
  -- `update_product_from_shop()` and `shop_day_totals()`. Raising beats returning
  -- null: a caller cannot tell "created" from "silently did nothing" otherwise.
  if not public.is_admin() then
    raise exception 'only the shop owner may add a product to the shelf'
      using errcode = '42501';
  end if;

  -- Trim once, so whitespace cannot smuggle an empty name past the checks below.
  p_name_en := btrim(coalesce(p_name_en, ''));
  p_name_kn := btrim(coalesce(p_name_kn, ''));

  if p_name_en = '' then
    raise exception 'a product needs an English name'
      using errcode = '23514';
  end if;

  if p_name_kn = '' then
    raise exception 'a product needs a Kannada name'
      using errcode = '23514';
  end if;

  -- The name copied from English is the failure mode this check exists for: it is
  -- filled-in but unreadable to the customer who needs it most.
  if not public.looks_like_kannada(p_name_kn) then
    raise exception 'the Kannada name must be written in Kannada, not copied from the English'
      using errcode = '23514';
  end if;

  -- Price is an integer in PAISE (rule 1). A negative price is never meaningful;
  -- the CHECK on the column would refuse it, but refusing it here says why.
  if p_price_paise is null or p_price_paise < 0 then
    raise exception 'a product needs a price of zero paise or more'
      using errcode = '23514';
  end if;

  -- MRP: a printed "was" price. Zero means "no printed MRP", the same convention
  -- the shelf edit uses, because a shop that does not print one must be able to
  -- say so without typing a number it does not have.
  if p_mrp_paise is not null and p_mrp_paise <= 0 then
    p_mrp_paise := null;
  end if;

  -- Selling for less than a printed MRP is an offer; selling for MORE than your own
  -- printed price is not a thing. The column CHECK enforces this too; the message
  -- here is the one the screen shows.
  if p_mrp_paise is not null and p_price_paise > p_mrp_paise then
    raise exception 'the price cannot be above the printed MRP'
      using errcode = '23514';
  end if;

  if coalesce(p_stock_qty, 0) < 0 then
    raise exception 'stock cannot be negative'
      using errcode = '23514';
  end if;

  -- The pack. The same rule as `products_pack_fields_agree`: a weighed product must
  -- say what one pack is, a counted product must not pretend to.
  if coalesce(p_sold_by, 'piece') = 'measure' then
    if p_pack_size is null or p_pack_size <= 0 or p_pack_unit is null then
      raise exception 'a weighed product must say how big one pack is'
        using errcode = '23514';
    end if;
  else
    -- A piece product may still carry a pack (a 200 ml bottle is one), but it must
    -- be a real one if it does.
    if p_pack_size is not null and (p_pack_size <= 0 or p_pack_unit is null) then
      raise exception 'a pack must have a positive size and a unit'
        using errcode = '23514';
    end if;
  end if;

  -- `unit` is the free text the customer reads ("500 g", "1 piece"). Derived, not
  -- typed, so it can never disagree with the pack the app compares sizes on.
  --
  -- The number is formatted by hand rather than with `to_char`, because the obvious
  -- `to_char(pack_size, 'FM999999990.999')` renders a whole kilo as "1000. kg" —
  -- a trailing dot the customer would read.
  --
  -- The trailing-zero trim is guarded on there BEING a decimal point. An earlier
  -- draft used a plain `rtrim(..., '0')`, which turns a 100 g pack into "1 g" —
  -- a silent hundred-fold lie about what the customer gets. Only digits AFTER the
  -- point may be dropped; a whole number is left exactly as it is.
  v_unit := case
    when p_pack_size is not null and p_pack_unit is not null then
      case
        when p_pack_size = trunc(p_pack_size)
          then trunc(p_pack_size)::text
        else rtrim(rtrim(to_char(p_pack_size, 'FM999999990.999'), '0'), '.')
      end || ' ' || p_pack_unit::text
    when coalesce(p_sold_by, 'piece') = 'piece' then '1 piece'
    else null
  end;

  if v_unit is null then
    raise exception 'could not work out the pack text for this product'
      using errcode = '23514';
  end if;

  -- The one active shop. See the header: the client never names the store.
  select id into v_store_id
    from public.stores
   where is_active = true
   order by created_at
   limit 1;

  if v_store_id is null then
    raise exception 'there is no active shop to add this product to'
      using errcode = 'P0002';
  end if;

  -- A new product goes on the shelf at the end. `sort_order` is a presentation
  -- detail the owner can change later; guessing a position from the name would be
  -- worse than appending.
  insert into public.products
    (store_id, category_id, name_en, name_kn, price_paise, mrp_paise, unit,
     stock_qty, sold_by, pack_size, pack_unit, emoji, sort_order, is_active)
  values
    (v_store_id, p_category_id, p_name_en, p_name_kn, p_price_paise, p_mrp_paise,
     v_unit, coalesce(p_stock_qty, 0), coalesce(p_sold_by, 'piece'), p_pack_size,
     p_pack_unit, nullif(btrim(coalesce(p_emoji, '')), ''),
     coalesce((select max(sort_order) + 1 from public.products where store_id = v_store_id), 1),
     true)
  returning * into v_row;

  -- `unique (store_id, name_en)` would raise 23505 on a duplicate. Say it in words
  -- the screen can translate, rather than leaking a constraint name.
  return v_row;

exception
  when unique_violation then
    raise exception 'the shop already has a product with that English name'
      using errcode = '23505';
end;
$$;

comment on function public.create_product_from_shop(
  text, text, integer, uuid, public.product_sold_by, numeric, public.pack_unit,
  integer, integer, text
) is
  'The one honest path for adding a product from the owner''s phone. Raises rather than silently doing nothing when the caller is not the owner, requires a real Kannada name, derives the pack text from the structured pack, and picks the store server-side so the client cannot name it. Runs as the caller, so RLS remains the authorisation authority.';

revoke all on function public.create_product_from_shop(
  text, text, integer, uuid, public.product_sold_by, numeric, public.pack_unit,
  integer, integer, text
) from public, anon;
grant execute on function public.create_product_from_shop(
  text, text, integer, uuid, public.product_sold_by, numeric, public.pack_unit,
  integer, integer, text
) to authenticated;

commit;
