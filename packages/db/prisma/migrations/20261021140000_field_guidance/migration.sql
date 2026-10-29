CREATE TYPE "FieldGuideStatus" AS ENUM ('draft', 'published', 'archived');

CREATE TABLE "field_guides" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" VARCHAR(4000) NOT NULL,
  "status" "FieldGuideStatus" NOT NULL DEFAULT 'draft',
  "lesson_id" UUID,
  "asset_id" UUID,
  "steps" JSONB NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "field_guides_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "field_guide_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "guide_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "completed_steps" JSONB NOT NULL,
  "device" VARCHAR(40),
  "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "field_guide_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "field_guides_tenant_id_status_updated_at_idx" ON "field_guides"("tenant_id", "status", "updated_at");
CREATE INDEX "field_guide_runs_tenant_id_user_id_completed_at_idx" ON "field_guide_runs"("tenant_id", "user_id", "completed_at");
CREATE INDEX "field_guide_runs_tenant_id_guide_id_idx" ON "field_guide_runs"("tenant_id", "guide_id");

ALTER TABLE "field_guides" ADD CONSTRAINT "field_guides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "field_guides" ADD CONSTRAINT "field_guides_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "field_guides" ADD CONSTRAINT "field_guides_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "field_guides" ADD CONSTRAINT "field_guides_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "field_guide_runs" ADD CONSTRAINT "field_guide_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "field_guide_runs" ADD CONSTRAINT "field_guide_runs_guide_id_fkey" FOREIGN KEY ("guide_id") REFERENCES "field_guides"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "field_guide_runs" ADD CONSTRAINT "field_guide_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
