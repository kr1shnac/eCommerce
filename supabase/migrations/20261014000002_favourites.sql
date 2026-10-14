-- =============================================================================
-- 15 · favourites — the customer's own shortlist
-- =============================================================================
-- A quick-commerce shopper buys the same twenty things every week. Re-finding
-- them in a grid of 34 items is the cost this table removes: one tap on a heart
-- pins a product to a "Saved" shelf on the Home screen.
--
-- This is a purely customer-owned table, exactly like `addresses`:
--   * `(user_id, product_id)` is the primary key, so a product can be saved
--     once and only once — toggling is an INSERT/DELETE, never a duplicate;
--   * `on delete cascade` on both sides, so removing a user or a product cleans
--     the shelf up without leaving dangling rows;
--   * RLS: you may read and write ONLY your own rows (admins, as everywhere,
--     may see all). No app code ever sees another person's shortlist.
--
-- Rule 9.7: this ships with a test (13_favourites_test.sql) that proves the
-- forbidden case — a customer writing somebody else's favourite — really fails.
-- =============================================================================

create table public.favourites (
  user_id    uuid        not null references public.profiles (id) on delete cascade,
  product_id uuid        not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (user_id, product_id)
);

comment on table public.favourites is
  'Per-customer product shortlist. Owned by the customer; RLS limits every read and write to user_id = auth.uid().';

create index favourites_user_id_idx on public.favourites (user_id, created_at desc);

alter table public.favourites enable row level security;

-- One policy for SELECT/INSERT/UPDATE/DELETE, the same shape as the addresses
-- policy: identity is the row's `user_id`, which RLS forces to be the caller.
create policy "you manage your own favourites"
  on public.favourites for all
  to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
