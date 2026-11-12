-- =============================================================================
-- Device-run accounts: the three faces, one phone-OTP code
-- =============================================================================
-- 9611990869 is now the signed-up CUSTOMER (the number the owner asked for).
-- role = 'customer', which is the default the trigger assigns and the only thing
-- it can ever assign — nobody can self-promote to admin, by design
-- (`profiles_guard_role`, migration 20261002000002).
--
-- A device run has to look at all THREE faces, and the root layout routes by
-- `profiles.role`, so one account can only ever be one face. Rather than making
-- the owner's real number an admin (which would lock them out of the shopping
-- flow they most needs to test), this KEEPS it a customer and adds two more
-- numbers — one owner, one rider.
--
-- The `auth.users` rows only exist once the test numbers have actually been used
-- to sign in, so this updates by phone and naturally matches nothing before
-- then. It never inserts a user.
--
-- Run AFTER signing in as each test number once (that is what creates the row).
-- =============================================================================

-- Owner face: the desk. Reaches Shelf, Today, Team, Coupons.
update public.profiles
   set role = 'admin'
 where id = (select id from auth.users where phone = '+919000000002');

-- Rider face: the pool. Claims, picks up, fails, hands over.
update public.profiles
   set role = 'delivery'
 where id = (select id from auth.users where phone = '+919000000003');

-- 9611990869 stays a customer on purpose: it is the number the owner will use
-- for the shopping flow, and the customer face is the one that has to work in
-- public.

-- What we ended up with. A phone with no profile row is a number never signed in.
select p.phone,
       p.role,
       (u.phone_confirmed_at is not null) as confirmed
  from public.profiles p
  join auth.users u on u.id = p.id
 order by p.role, p.phone;
