-- =============================================================================
-- 09 · Make a fake line-item price impossible, on every path
-- =============================================================================
-- Migration 08 closed the front door: a customer can no longer INSERT into
-- order_items, and prices are computed inside place_order().
--
-- This closes the back door. guard_order_item_insert() is a BEFORE INSERT
-- trigger, so it runs whoever is doing the inserting. It now overwrites the
-- price and the product name from the products row itself.
--
-- Consequence: order_items.price_paise can never disagree with products. Not
-- from the app, not from a mistake in place_order(), not from a future
-- back-office screen that someone writes carelessly.
--
-- The function is REPLACED rather than duplicated because triggers cannot be
-- redefined; the trigger itself stays as migration 05 created it.
--
-- The original customer check ("only while placed") is kept exactly as it was.
-- -----------------------------------------------------------------------------

create or replace function public.guard_order_item_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
begin
  if public.current_user_role() = 'customer' then
    if (select o.status from public.orders o where o.id = new.order_id) <> 'placed' then
      raise exception 'This order can no longer be changed.'
        using errcode = '42501';
    end if;
  end if;

  -- The catalogue is the only source of truth for what a line costs and what
  -- it is called. Anything the caller sent for these columns is discarded.
  select * into v_product
  from public.products p
  where p.id = new.product_id;

  if found then
    new.price_paise       := v_product.price_paise;
    new.product_name_en   := v_product.name_en;
    new.product_name_kn   := v_product.name_kn;
    new.unit              := v_product.unit;
    new.image_url         := v_product.image_url;
  end if;

  return new;
end;
$$;

comment on function public.guard_order_item_insert() is
  'Replaces the line price and name with the product row, so no caller can write a fake price.';