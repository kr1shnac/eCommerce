-- =============================================================================
-- 16 · addresses — one default per person, and a safe way to change it
-- =============================================================================
-- Until now "default address" was a convention the app was trusted to keep: it
-- wrote `is_default` and hoped no second row already had it. A customer who
-- edited their list from two phones, or a retried request, could end up with two
-- defaults and a checkout screen that picks a different one each time.
--
-- Two pieces make it a fact of the database instead:
--
--   1. a PARTIAL UNIQUE INDEX — at most one `is_default` row per `user_id`. The
--      database now physically refuses a second default (23505);
--   2. `set_default_address(uuid)` — clears the old default and sets the new one
--      in one call, so the index can never be tripped by the two-step dance. It
--      runs as the CALLER (security invoker), so RLS still limits it to that
--      person's own rows; it cannot be turned into a way to touch somebody
--      else's address.
--
-- Rule 9.7: proved by supabase/tests/14_address_default_test.sql.
-- =============================================================================

create unique index addresses_one_default_per_user
  on public.addresses (user_id)
  where is_default;

comment on index public.addresses_one_default_per_user is
  'A customer may have at most one default address. Enforced by the database so a double-tap or two phones cannot create two.';

-- -----------------------------------------------------------------------------
-- set_default_address: make one of MY addresses the default.
--
-- Order matters. Ownership is checked FIRST, so a bad id (or somebody else's id)
-- fails without having already cleared the caller's current default.
-- -----------------------------------------------------------------------------
create or replace function public.set_default_address(p_address_id uuid)
returns boolean
language plpgsql
as $$
declare
  v_user uuid := auth.uid();
  v_owns boolean;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- RLS applies inside the function, so this only ever sees the caller's rows.
  select exists (
    select 1 from public.addresses where id = p_address_id and user_id = v_user
  ) into v_owns;

  if not v_owns then
    raise exception 'address not found' using errcode = 'P0002';
  end if;

  update public.addresses
     set is_default = false
   where user_id = v_user
     and is_default
     and id <> p_address_id;

  update public.addresses
     set is_default = true
   where id = p_address_id
     and user_id = v_user;

  return true;
end;
$$;

comment on function public.set_default_address(uuid) is
  'Make one of the caller''s own addresses the default, clearing the previous default first. RLS-scoped to auth.uid(); refuses ids the caller does not own (P0002).';

grant execute on function public.set_default_address(uuid) to authenticated;
