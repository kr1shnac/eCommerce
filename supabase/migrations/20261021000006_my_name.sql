-- =============================================================================
-- 20261021000006 · One phone, several adults
-- =============================================================================
--
-- Register H10. Every assumption in this app starts from "one phone = one
-- person", and in Kunigal that is simply false: joint families share a handset.
-- `PRODUCTION.md` §1 lists it as a fact about the town, and until now the app had
-- no answer for it beyond the address's own `full_name`.
--
-- WHAT THE APP ALREADY DOES RIGHT
-- -------------------------------
-- An address carries its own `full_name` (migration 20261002000004), and
-- `place_order()` snapshots it onto the order. So a shared phone can already book
-- a delivery to "Ramesh" today and "Suma" tomorrow, and the rider sees the right
-- name on the doorstep. That is the important half and it was already built.
--
-- WHAT WAS MISSING
-- ----------------
-- Two things, and they are not the same thing:
--
--   1. **The ACCOUNT has no name.** Sign-in is a phone number and a code, with no
--      name captured, so `profiles.full_name` is NULL for every customer who
--      signed up through the app. The account screen shows only "Signed in" and
--      the last two digits. The shop cannot tell whose phone this is, and the
--      household cannot say.
--
--   2. **Nothing says the account belongs to a household.** A customer reading the
--      account screen reasonably assumes it is theirs alone. Writing down the
--      model — one account, many people, the NAME ON THE ADDRESS is who the
--      delivery is for — is most of this item's value, because otherwise the
--      shop and the household disagree about what the account means.
--
-- WHAT THIS MIGRATION ADDS
-- ------------------------
-- One function, `set_my_name()`, which lets a signed-in customer set the one
-- thing they own and the app never asked for. It is deliberately NOT a general
-- profile editor:
--
--   * it takes no user id — it can only ever act on `auth.uid()`, so there is no
--     id to guess or tamper with;
--   * it writes `full_name` and nothing else, so a bug in a screen cannot smuggle
--     a `role` change through a profile save (the `profiles_guard_role` trigger
--     would refuse that anyway, but the function should not offer the door);
--   * it refuses a blank name rather than storing one, because a stored blank is
--     indistinguishable from "never set" and the screen cannot tell which;
--   * it raises rather than returning null, for the same reason the shelf edit
--     does: a plain `.update()` matching zero rows reports no error, so a save
--     button built on it can claim success while saving nothing (rule 9.4).
--
-- Deliberately NOT `security definer`: the "update your own profile" RLS policy
-- already authorises exactly this, and keeping the function as the caller means
-- RLS stays the single authorisation authority rather than being bypassed.

begin;

create or replace function public.set_my_name(p_full_name text)
returns public.profiles
language plpgsql
as $$
declare
  v_name text;
  v_row  public.profiles;
begin
  -- The door, checked before a row is touched. `auth.uid()` is the ONLY identity
  -- this function will act on: there is no user id in the signature to misuse.
  if auth.uid() is null then
    raise exception 'sign in before setting a name'
      using errcode = '42501';
  end if;

  v_name := btrim(coalesce(p_full_name, ''));

  if v_name = '' then
    raise exception 'a name is needed'
      using errcode = '23514';
  end if;

  -- Long enough for a real name, short enough that nothing huge is stored. The
  -- limit is generous: this town has names with spaces, initials and honorifics.
  if length(v_name) > 120 then
    raise exception 'that name is too long'
      using errcode = '23514';
  end if;

  -- Exactly one column. The `role` guard would refuse a smuggled role change, but
  -- a function that cannot name the column in the first place is a smaller door.
  update public.profiles
     set full_name = v_name
   where id = auth.uid()
  returning * into v_row;

  if v_row.id is null then
    raise exception 'there is no profile for this account'
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

comment on function public.set_my_name(text) is
  'Lets a signed-in customer name their own account, and nothing else. Acts only on auth.uid(), writes only full_name, refuses a blank name, and raises rather than silently doing nothing. Runs as the caller so RLS remains the authorisation authority. See PRODUCTION.md register H10.';

revoke all on function public.set_my_name(text) from public, anon;
grant execute on function public.set_my_name(text) to authenticated;

commit;
