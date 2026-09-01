-- 0038_must_change_password.sql
-- Flag accounts created with an admin/owner-assigned temporary password so they
-- are forced to set their own password on first sign-in. Cleared once they do.
ALTER TABLE users ADD COLUMN must_change_password INTEGER;
