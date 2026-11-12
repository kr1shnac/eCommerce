-- =============================================================================
-- 38 · The offers rail states its own scope
-- =============================================================================
-- `active_offers()` (migration 14) returns code + wording + minimum for the Home
-- offers rail. It deliberately does not return usage numbers, because a rail
-- full of counters is a dashboard, not an invitation.
--
-- What it *should* return is the SHAPE of the limit, for one reason: an offer
-- the customer cannot use is worse than no offer. COMPETITOR-TEARDOWN §11.5
-- (A13) records Blinkit saying `On first 10 orders` and
-- `Get free delivery on your first order!` on its own rail `[MEASURED]` — the
-- offer states its scope instead of letting the customer discover it at
-- checkout, when the code is refused and the basket feels broken.
--
-- `per_customer_limit` exists since migration 20261109000004 and was never
-- exposed anywhere the customer can see it. This closes that: the rail now
-- carries both caps as nullable integers, and the app turns them into one
-- honest sentence.
--
-- WHAT DOES NOT CHANGE
--   * Which rows are offered. The WHERE clause is identical — a code with no
--     global headroom left is still not advertised.
--   * The shape of the existing keys, so nothing that already reads this
--     function breaks.
--   * Nothing here counts a use. `validate_coupon()` still refuses, and the
--     per-customer refusal still wins at checkout.
-- =============================================================================

create or replace function public.active_offers(p_store_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'code', c.code,
        'description_en', c.description_en,
        'description_kn', c.description_kn,
        'min_order_paise', c.min_order_paise,
        -- NEW (20261109000006): the shape of the limit, so the card can say
        -- "one per customer" or "first 20 orders" rather than nothing.
        -- Both are NULL when there is no such cap, and the app shows no line.
        'usage_limit', c.usage_limit,
        'per_customer_limit', c.per_customer_limit
      )
      order by c.min_order_paise, c.code
    ),
    '[]'::jsonb
  )
  from public.coupons c
  where c.store_id = p_store_id
    and c.is_active
    and (c.starts_at is null or now() >= c.starts_at)
    and (c.ends_at is null or now() <= c.ends_at)
    and (c.usage_limit is null or c.used_count < c.usage_limit);
$$;

comment on function public.active_offers(uuid) is
  'Live coupon codes with their wording, for the customer-facing offers rail. '
  'Carries usage_limit and per_customer_limit so the rail can state its own '
  'scope (A13, migration 20261109000006).';

revoke execute on function public.active_offers(uuid) from public;
grant execute on function public.active_offers(uuid) to anon, authenticated, service_role;
