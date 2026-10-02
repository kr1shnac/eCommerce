-- Stricter DB constraints
alter table public.products
  add constraint products_price_paise_gt_zero check (price_paise > 0),
  add constraint products_mrp_paise_ge_price check (mrp_paise is null or mrp_paise >= price_paise),
  add constraint products_stock_qty_ge_zero check (stock_qty >= 0);

alter table public.store_settings
  add constraint store_settings_min_order_ge_zero check (min_order_value_paise >= 0),
  add constraint store_settings_delivery_fee_ge_zero check (delivery_fee_paise >= 0),
  add constraint store_settings_free_delivery_ge_zero check (free_delivery_above_paise is null or free_delivery_above_paise >= 0);

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='store_settings' and column_name='low_stock_threshold') then
    alter table public.store_settings add column low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0);
  end if;
end $$;

alter table public.delivery_zones
  add constraint delivery_zones_pincode_6_digits check (pincode ~ '^[0-9]{6}$'),
  add constraint delivery_zones_fee_ge_zero check (delivery_fee_paise is null or delivery_fee_paise >= 0),
  add constraint delivery_zones_eta_ge_zero check (eta_minutes is null or eta_minutes > 0);
