-- FR-18.1: persist Studio AI feature gates on tenant settings (admin UI, not SQL-only).
ALTER TABLE "tenant_settings"
  ADD COLUMN IF NOT EXISTS "ai_feature_flags" JSONB NOT NULL DEFAULT '{}'::jsonb;
