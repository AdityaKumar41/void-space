-- Obsolete editor feature flags have no runtime consumers. Applied history is preserved.
ALTER TABLE "tenant_settings" DROP COLUMN IF EXISTS "ai_feature_flags";
