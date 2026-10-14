-- =============================================================================
-- 14 · A picture for the shelf: products.emoji
-- =============================================================================
-- Kunigal has no product photography, and a grid of 34 identical category
-- leaves tells the customer nothing. `image_url` is the long-term answer, but
-- it is NULL for every product today — so each product also carries a single
-- emoji, which the app draws on the tile when there is no photo.
--
-- This is not decoration. Roughly one in three adults in the town cannot
-- comfortably read a product name (KUNIGAL.md §1); a tomato that looks like a
-- tomato is how that customer shops. The emoji is only ever a FALLBACK: a real
-- `image_url` always wins in the UI.
--
-- Shape:
--   * nullable on purpose — a product with a photo needs no emoji, and a new
--     product created from the admin panel must not be blocked for want of one;
--   * free text, not a lookup table — it is a glyph, and the app falls back to
--     the category `icon`, then to a generic basket, if it is empty;
--   * no length limit is imposed, because a multi-codepoint emoji (family,
--     flag, skin tone) is one *character* to Postgres but several code points.
--
-- This adds a column to a table whose RLS already governs it (products are
-- world-readable when active, admin-writable — see 20261002000006). No new
-- policy is needed; test 11 proves the new column is covered by the existing
-- ones rather than assuming so.
-- =============================================================================

alter table public.products
  add column emoji text;

comment on column public.products.emoji is
  'Fallback picture for the tile when image_url is NULL. One emoji, e.g. ''🍅''. A real image_url always wins.';
