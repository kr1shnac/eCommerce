-- =============================================================================
-- The shop's real name
-- =============================================================================
-- The production bootstrap (supabase/production-bootstrap.sql) deliberately
-- created the store with a WORKING name and no phone, address, FSSAI or GST,
-- because inventing a business fact is worse than an absent one (AGENTS.md §9.6
-- and the shop-identity migration 20261020000002: an absent number shows
-- nothing, a fake one is a false statutory claim).
--
-- The owner has since supplied the name. This applies it and nothing else: the
-- phone, address and licence numbers stay NULL until they are real, and the app
-- will keep showing nothing rather than a placeholder.
--
-- Idempotent, and it never touches a shop the owner has already renamed.
-- =============================================================================

update public.stores
   set name = 'Kunigal Bazaar',
       slug = 'kunigal-bazaar'
 where slug = 'kunigal-grocery';

select id, name, slug, phone, address_line, city, fssai_number, gstin
  from public.stores;
