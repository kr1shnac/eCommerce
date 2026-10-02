BEGIN;

-- Basic admin write + constraints
DO $$
DECLARE
  s_id uuid;
  c_id uuid;
BEGIN
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  PERFORM set_config('app.user_id','00000000-0000-0000-0000-000000000001', true);
  UPDATE auth.users SET raw_user_meta_data = '{"role":"admin"}' WHERE id='00000000-0000-0000-0000-000000000001';
  SELECT id INTO s_id FROM stores LIMIT 1;
  INSERT INTO categories (store_id, name_en, name_kn, sort_order, is_active) VALUES (s_id,'C1','C1k',1,true) RETURNING id INTO c_id;
  ASSERT (SELECT count(*) FROM categories WHERE name_en='C1')=1;
END$$;

ROLLBACK;
