-- Bootstrap role identities only. They cannot sign in until the migration/RLS
-- step installs the configured passwords and least-privilege grants.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='void_app') THEN
    CREATE ROLE void_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='void_platform') THEN
    CREATE ROLE void_platform NOLOGIN NOSUPERUSER BYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO void_app, void_platform;
