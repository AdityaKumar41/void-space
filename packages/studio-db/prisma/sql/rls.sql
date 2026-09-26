-- ---------------------------------------------------------------------------
-- VOID·STUDIO — Row-Level Security policies and runtime grants (VS2-SRS-1.0
-- §5.2 "Key Relationships", §5.3 "Data Ownership Boundary")
--
-- Applied by `pnpm studio:db:rls` AFTER every migration, and safe to run repeatedly.
--
-- Statement separator: a line containing only the "@statement" marker
-- (two dashes, a space, then the word). scripts/apply-rls.mjs executes each chunk
-- separately; the whole file is also valid `psql -f` input.
--
-- Security model — the same shape as VOID·SPACE's, on a different database:
--
--   voidstudio_app        runtime role for studio-api + studio-worker. Every
--                         tenant-scoped table is protected by a policy comparing
--                         `tenant_id` to `app.current_tenant_id`, which
--                         `withStudioTenant()` sets inside a transaction. The
--                         setting is read *without* the missing_ok flag, so a query
--                         that forgets to establish tenant context fails loudly
--                         instead of silently returning rows.
--   voidstudio_platform   BYPASSRLS, privileges ONLY on tenants and users. §5.1
--                         makes those two a "lightweight, federated mirror" of
--                         VOID·SPACE's identity, reconciled *before* a tenant is
--                         known — which is the one thing a tenant-scoped role
--                         cannot do. It cannot touch projects, scenes, versions,
--                         publish records, copilot history or jobs.
--   <owner>               schema owner, used only for DDL (migrations, RLS apply).
--
-- Note the deliberate absence of a policy on... nothing. Every table in this schema
-- is either tenant-scoped (has a `tenant_id`) or is `tenants` itself; there is no
-- shared lookup table here, which is what makes the audit test's rule airtight
-- rather than a list someone remembers to extend.
-- ---------------------------------------------------------------------------

-- @statement
GRANT USAGE ON SCHEMA public TO voidstudio_app, voidstudio_platform;

-- @statement
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO voidstudio_app;

-- @statement
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO voidstudio_app;

-- @statement
-- The blanket GRANT above is deliberately indescriminate so a new table is protected
-- by default rather than by remembering to add it. Prisma's own bookkeeping table is
-- the one thing it should not have handed out: `_prisma_migrations` holds no
-- application data, is read only by the CLI (which connects as the owner), and
-- leaving it writable would let the runtime role rewrite migration history.
--
-- Positioned *after* the blanket grant on purpose, so it wins on every run rather
-- than only the first.
REVOKE ALL ON TABLE _prisma_migrations FROM voidstudio_app, voidstudio_platform;

-- @statement
-- The platform role starts from a clean slate on every run, so a grant added for a
-- previous schema cannot survive a migration that should have removed it.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM voidstudio_platform;

-- @statement
-- §5.1 — the federated identity mirror is the whole of what the platform role needs.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tenants TO voidstudio_platform;

-- @statement
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE users TO voidstudio_platform;

-- @statement
-- Enables and force-enables RLS, then creates the isolation policy, for every
-- tenant-scoped table.
--
-- FORCE is not decoration: a table's *owner* bypasses its own RLS policies, and
-- migrations run as the owner. Without FORCE, a future `DELETE FROM projects` in a
-- migration — or any query accidentally issued as the owner — would walk straight
-- through the policy, and the audit test would still report RLS as "enabled".
DO $$
DECLARE
  target_table text;
  tenant_tables text[] := ARRAY[
    'users',
    'folders',
    'projects',
    'scenes',
    'scene_objects',
    'mesh_assets',
    'texture_assets',
    'material_assets',
    'material_textures',
    'animation_clips',
    'project_versions',
    'publish_records',
    'copilot_sessions',
    'copilot_messages',
    'jobs'
  ];
BEGIN
  FOREACH target_table IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', target_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', target_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', target_table || '_tenant_isolation', target_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I '
      'USING (tenant_id = current_setting(''app.current_tenant_id'')::uuid) '
      'WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'')::uuid)',
      target_table || '_tenant_isolation',
      target_table
    );
  END LOOP;
END
$$;

-- @statement
-- `tenants` carries no `tenant_id` of its own, so its policy keys on the primary
-- key instead: the runtime role may only ever see the tenant it is acting as.
-- Cross-tenant administration (§3.5.1's workspace switcher) goes through
-- voidstudio_platform.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- @statement
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

-- @statement
DROP POLICY IF EXISTS tenants_self_only ON tenants;

-- @statement
CREATE POLICY tenants_self_only ON tenants
  USING (id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (id = current_setting('app.current_tenant_id')::uuid);

-- @statement
-- Leaves a machine-readable summary the apply script prints, so drift after a
-- migration is visible at a glance rather than only in the audit test.
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
 ORDER BY c.relname;
