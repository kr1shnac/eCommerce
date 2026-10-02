-- =============================================================================
-- 02 · profiles (one row per signed-in user) + the auto-create trigger
-- =============================================================================
-- Why a separate profiles table instead of using auth.users directly?
--   * Supabase's auth.users is owned by Supabase; we must not edit it.
--   * We need extra fields (role, phone, language) that Auth does not have.
--   * The app always joins to profiles, and never to auth.* tables.
--
-- `role` is the security heart of the app:
--   customer = a normal shopper
--   admin    = the shop owner / staff using the web panel
--   delivery = the person who brings the bag

create table public.profiles (
  id                 uuid primary key references auth.users (id) on delete cascade,
  full_name          text,
  phone              text,
  role               public.user_role not null default 'customer',
  preferred_language text not null default 'en'
                       check (preferred_language in ('en', 'kn')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.profiles is
  'Public profile for every auth user. Row-level security keys off role here.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Role helpers used by every Row Level Security policy in 06.
--
-- Why security definer + "set search_path = ''"?
--   * security definer runs as the function owner, so it can read public.profiles
--     even when RLS would otherwise block it. Without this, the profiles policy
--     (which asks "is this person an admin?") would call a function that reads
--     profiles, which would ask the same question again — forever.
--   * an empty search_path means nothing sneaky can be injected into the query.
-- -----------------------------------------------------------------------------

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role from public.profiles p where p.id = auth.uid()),
    'customer'::public.user_role
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_user_role() = 'admin';
$$;

create or replace function public.is_delivery()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_user_role() = 'delivery';
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_user_role() in ('admin', 'delivery');
$$;

-- Functions are executable by PUBLIC by default, which would let a stranger
-- probe them. Lock them down explicitly instead.
--
-- anon is included on purpose: the "browse the catalogue" policies below apply
-- to signed-out visitors too, and Postgres evaluates every WHEN/THEN branch, so
-- anon must be allowed to CALL these helpers. They are harmless for anon, since
-- auth.uid() is null there and current_user_role() returns 'customer'.
revoke execute on function public.current_user_role() from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.is_delivery() from public;
revoke execute on function public.is_staff() from public;

grant execute on function public.current_user_role() to anon, authenticated, service_role;
grant execute on function public.is_admin() to anon, authenticated, service_role;
grant execute on function public.is_delivery() to anon, authenticated, service_role;
grant execute on function public.is_staff() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Auto-create a profile the moment someone signs up.
-- Without this, every RLS policy that checks `user_id = auth.uid()` would fail,
-- because no profile row would exist yet.
--
-- This runs as the function owner (security definer), so it can insert even
-- though Row Level Security is enabled.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.phone
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Role-escalation guard.
-- RLS alone cannot stop this: the "update my own profile" policy would happily
-- let a customer set their own role to 'admin'. So the rule lives in a trigger.
--
-- The `auth.uid() is null` escape hatch is for maintenance from the Supabase
-- SQL editor / migrations, where there is no signed-in user. A real signed-in
-- caller always has a uid, so a normal user can never use it.
-- -----------------------------------------------------------------------------

create or replace function public.guard_profile_role()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role
     and not (public.is_admin() or auth.uid() is null) then
    raise exception 'Only an admin can change a user role.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_profile_role();