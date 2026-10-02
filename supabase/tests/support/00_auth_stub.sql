-- =============================================================================
-- Minimal stand-in for the parts of Supabase that migrations depend on.
--
-- On the real project Supabase owns auth.users and auth.uid(). Locally we need
-- just enough of it to be able to apply the migrations and then act as
-- different signed-in users from a test.
--
-- How auth.uid() is faked here:
--   Supabase puts the caller's user id in a session setting called
--   request.jwt.claim.sub. The stub does the same, so tests can "sign in" as
--   anybody with:
--       select test_result.sign_in('11111111-1111-1111-1111-111111111111');
-- =============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id                 uuid primary key,
  phone              text unique,
  email              text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

create table if not exists auth.sessions (
  id        uuid primary key,
  user_id   uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    current_setting('role', true)
  );
$$;

-- -----------------------------------------------------------------------------
-- The three roles PostgREST uses. In production Supabase creates these; here we
-- create them so `grant ... to authenticated` works and `set role authenticated`
-- lets a test pretend to be a real app request.
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Recording every assertion instead of aborting on the first failure, so one
-- run tells you everything that is broken.
-- -----------------------------------------------------------------------------

create schema if not exists test_result;

create table if not exists test_result.assertions (
  n     serial primary key,
  suite text not null,
  name  text not null,
  ok    boolean not null,
  detail text
);

create or replace function test_result.record(
  p_suite text,
  p_name  text,
  p_ok    boolean,
  p_detail text default ''
)
returns void
language plpgsql
as $$
begin
  insert into test_result.assertions (suite, name, ok, detail)
  values (p_suite, p_name, p_ok, p_detail);

  -- Echo it immediately so a human watching the output sees progress.
  raise notice '%  %', case when p_ok then '  ok  ' else ' FAIL ' end, p_name;
end;
$$;

create or replace function test_result.ok(
  p_label text,
  p_condition boolean,
  p_detail text default ''
)
returns void language sql as $$
  select test_result.record(current_setting('test_result.suite', true), p_label,
                            coalesce(p_condition, false), p_detail);
$$;

create or replace function test_result.eq(
  p_label text,
  p_actual text,
  p_expected text
)
returns void language sql as $$
  select test_result.record(
    current_setting('test_result.suite', true),
    p_label,
    p_actual is not distinct from p_expected,
    case when p_actual is not distinct from p_expected then ''
         else format('got %s, wanted %s', coalesce(p_actual, 'null'), coalesce(p_expected, 'null')) end
  );
$$;

create or replace function test_result.eq(
  p_label text,
  p_actual bigint,
  p_expected bigint
)
returns void language sql as $$
  select test_result.record(
    current_setting('test_result.suite', true),
    p_label,
    p_actual is not distinct from p_expected,
    case when p_actual is not distinct from p_expected then ''
         else format('got %s, wanted %s', coalesce(p_actual::text, 'null'), coalesce(p_expected::text, 'null')) end
  );
$$;

-- Asserts that a piece of SQL is REFUSED. Used for every "the forbidden case
-- must fail" rule, which is the whole point of these tests.
--
-- p_sqlstate is optional but recommended: without it, a NOT NULL violation
-- would count as "successfully locked down" when really we just wrote the test
-- wrong. '42501' is insufficient_privilege, what RLS raises.
create or replace function test_result.refused(
  p_label text,
  p_sql text,
  p_sqlstate text default null
)
returns void
language plpgsql
as $$
declare
  v_state text;
begin
  begin
    execute p_sql;
    perform test_result.record(current_setting('test_result.suite', true), p_label, false,
                       'it was ALLOWED but should have been refused');
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if p_sqlstate is null or v_state = p_sqlstate then
      perform test_result.record(current_setting('test_result.suite', true), p_label, true,
                         format('refused with %s', v_state));
    else
      perform test_result.record(current_setting('test_result.suite', true), p_label, false,
                         format('refused, but with %s not %s: %s', v_state, p_sqlstate, left(sqlerrm, 70)));
    end if;
  end;
end;
$$;

-- Row Level Security has a subtlety that catches everyone: it does not raise
-- "permission denied" on an UPDATE or DELETE that touches someone else's row.
-- It silently makes the row invisible, so the statement succeeds having
-- affected ZERO rows.
--
-- So "the forbidden case must fail" has two shapes:
--   * a SELECT / INSERT that raises 42501      -> test_result.refused()
--   * an UPDATE / DELETE that changes nothing -> test_result.touches()
create or replace function test_result.touches(
  p_label text,
  p_sql text,
  p_expected_rows bigint
)
returns void
language plpgsql
as $$
declare
  v_count bigint;
begin
  execute p_sql;
  get diagnostics v_count = row_count;

  perform test_result.record(
    current_setting('test_result.suite', true),
    p_label,
    v_count = p_expected_rows,
    case when v_count = p_expected_rows then ''
         else format('affected %s row(s), wanted %s', v_count, p_expected_rows) end
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Sign in / out, exactly like PostgREST does it.
-- -----------------------------------------------------------------------------

create or replace function test_result.sign_in(p_uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, false);
end;
$$;

create or replace function test_result.sign_out()
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
end;
$$;

create or replace function test_result.begin_suite(p_name text)
returns void
language plpgsql
as $$
begin
  perform set_config('test_result.suite', p_name, false);
  raise notice '';
  raise notice '=== % ===', p_name;
end;
$$;

grant usage on schema test_result to anon, authenticated, service_role;
grant execute on all functions in schema test_result to anon, authenticated, service_role;
grant insert, select on test_result.assertions to anon, authenticated, service_role;
grant usage, select on sequence test_result.assertions_n_seq to anon, authenticated, service_role;