-- =============================================================================
-- demo-accounts.sql — development-only sign-in accounts (NEVER run on production)
-- =============================================================================
-- WHY THIS EXISTS
--
-- The app signs in with a phone number and a one-time code, and that is the right
-- design for Kunigal: everybody has a phone, nobody remembers a password. But a
-- one-time code needs an SMS provider, so until one is configured NOBODY can sign
-- in — not the owner, not a rider, and not you, the developer, who just wants to
-- look at the order history. (Check it: Auth → Providers → Phone is disabled on
-- the project, which is why `auth.users` is empty.)
--
-- This file makes three real Supabase accounts so all three faces of the app can
-- be opened and looked at today:
--
--   customer  Asha  · orders, addresses, the shortlist, "Buy again"
--   delivery  Ravi  · the waiting pool and today's deliveries
--   admin     Owner · the shop board
--
-- HOW THE APP USES THEM
--
-- The app signs in with these by EMAIL + PASSWORD, not by phone: phone logins are
-- disabled on the project (see above), and email is the one provider that is on.
-- The dev-only "Demo accounts" block on the login screen reads the three
-- addresses from `EXPO_PUBLIC_DEMO_*` in the git-ignored `apps/mobile/.env`, and
-- is compiled out of production builds (it is behind `__DEV__`). The passwords
-- therefore live in exactly two places: your `.env`, and this script's caller.
-- They are NOT in this file, NOT in the repository, and NOT in any shipped app.
--
-- WHY IT WRITES TO auth.users DIRECTLY
--
-- Only Supabase's own auth service may create users, normally through the signup
-- endpoint. That endpoint sends a confirmation email, and the project's built-in
-- SMTP is rate-limited to a handful an hour, so it cannot be used to seed three
-- accounts on demand. So this script inserts the rows GoTrue would have written,
-- with the password hashed by bcrypt exactly as GoTrue hashes it.
--
-- That is precisely why this is a development file and not a migration:
--   * it touches tables Supabase owns (`auth.users`, `auth.identities`), which
--     `supabase/migrations/` must never do;
--   * it is not portable — a GoTrue upgrade may change the shape of those tables;
--   * production accounts must be created by signing in, or from the dashboard.
-- Delete these three rows before the shop goes live.
--
-- HOW TO RUN (development only)
--   psql "$DATABASE_URL" -v demo_password='<pick-one>' -f supabase/demo-accounts.sql
--
-- It is safe to re-run: the accounts are keyed by fixed UUIDs and the profile is
-- updated in place, so no duplicates are ever created. Run `supabase/demo.sql`
-- straight after it to fill the order history.
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?demo_password}
\else
do $$ begin raise exception
  'demo-accounts.sql: pass -v demo_password=''...''. The password is deliberately not written into the repository.';
end $$;
\endif

begin;

-- Hand the secret to the DO block below through the session, because psql does
-- not expand :variables inside a dollar-quoted body.
set local app.demo_password = :'demo_password';

do $$
declare
  -- GoTrue's default single-instance id; the project has no rows in auth.instances.
  v_instance uuid := '00000000-0000-0000-0000-000000000000';
  v_password text := current_setting('app.demo_password');
  v_acct     record;
  v_roles    integer := 0;
begin
  for v_acct in
    select * from (values
      -- id                                   | email                 | name        | phone            | role
      ('a5000000-0000-4000-8000-0000000000b1'::uuid, 'asha@kunigal.test', 'Asha Gowda', '+919000000101', 'customer'::public.user_role),
      ('a5000000-0000-4000-8000-0000000000c1'::uuid, 'ravi@kunigal.test', 'Ravi Kumar', '+919000000102', 'delivery'::public.user_role),
      ('a5000000-0000-4000-8000-0000000000a1'::uuid, 'owner@kunigal.test', 'ಲಕ್ಷ್ಮಿ',  '+919000000103', 'admin'::public.user_role)
    ) as t (id, email, full_name, phone, role)
  loop
    -- The account itself. Email confirmed, because nobody is going to click a
    -- link in an inbox that does not exist.
    --
    -- The four empty-string token columns are not decoration. GoTrue reads a row
    -- into non-nullable Go strings, so a NULL in `confirmation_token` (or the
    -- three beside it) makes every sign-in fail with "Database error querying
    -- schema" — a 500 that says nothing about the real cause. Signup always sets
    -- them; we have to as well.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, phone, phone_confirmed_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      is_sso_user, is_anonymous, created_at, updated_at
    )
    values (
      v_instance, v_acct.id, 'authenticated', 'authenticated', v_acct.email,
      crypt(v_password, gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_acct.full_name),
      v_acct.phone, now(),
      '', '', '', '',
      false, false, now(), now()
    )
    on conflict (id) do update
      set email                    = excluded.email,
          encrypted_password       = excluded.encrypted_password,
          email_confirmed_at       = excluded.email_confirmed_at,
          raw_user_meta_data       = excluded.raw_user_meta_data,
          phone                    = excluded.phone,
          phone_confirmed_at       = excluded.phone_confirmed_at,
          confirmation_token       = '',
          recovery_token           = '',
          email_change             = '',
          email_change_token_new   = '',
          updated_at               = now();

    -- The identity row. GoTrue's password grant looks the user up through this,
    -- so an account without one cannot sign in. (`email` is a generated column.)
    insert into auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    )
    values (
      v_acct.email, v_acct.id,
      jsonb_build_object(
        'sub', v_acct.id::text,
        'email', v_acct.email,
        'email_verified', true,
        'phone_verified', true
      ),
      'email', now(), now(), now()
    )
    on conflict (provider_id, provider) do update
      set user_id       = excluded.user_id,
          identity_data = excluded.identity_data,
          updated_at    = now();

    -- The insert above fired public.handle_new_user(), which made the profile
    -- with the name and phone. Give it the role — the SQL Editor is allowed to,
    -- `profiles_guard_role` still refuses the same change from inside the app.
    update public.profiles
       set full_name = v_acct.full_name,
           phone     = v_acct.phone,
           role      = v_acct.role
     where id = v_acct.id;

    v_roles := v_roles + 1;
  end loop;

  raise notice
    'demo-accounts.sql: ready — % accounts (customer Asha, rider Ravi, owner). Sign in from the login screen''s Demo accounts block, then run supabase/demo.sql for the order history.',
    v_roles;
end $$;

commit;
