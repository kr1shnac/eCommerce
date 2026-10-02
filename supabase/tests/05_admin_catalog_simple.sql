BEGIN;
-- admin/catalog constraints
DO $$
DECLARE
  c1 int;
  p1 int;
BEGIN
  -- set admin
  PERFORM set_config(''request.jwt.claims'',''{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}'', true);
  PERFORM set_config(''app.user_id'',''00000000-0000-0000-0000-000000000001'', true);
  UPDATE auth.users SET raw_user_meta_data = ''{"role":"admin"}'' WHERE id=''00000000-0000-0000-0000-000000000001'';
  INSERT INTO public.categories (store_id, name_en, name_kn, sort_order, is_active)
    SELECT id, ''Test Cat'', ''x'', 1, true FROM stores LIMIT 1;
  ASSERT (SELECT count(*) FROM categories WHERE name_en=''Test Cat'')=1;
END$$;
ROLLBACK;
