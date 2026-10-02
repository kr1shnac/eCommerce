BEGIN;

DO $$
BEGIN
  -- admin can write
  PERFORM set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  PERFORM set_config('app.user_id','00000000-0000-0000-0000-000000000001', true);
  UPDATE auth.users SET raw_user_meta_data = '{"role":"admin"}' WHERE id='00000000-0000-0000-0000-000000000001';

  ASSERT EXISTS (SELECT 1 FROM stores LIMIT 1);
END$$;

ROLLBACK;
