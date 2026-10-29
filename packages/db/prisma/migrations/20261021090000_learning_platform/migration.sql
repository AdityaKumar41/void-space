CREATE TABLE "lessons" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "asset_version_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "summary" VARCHAR(2000) NOT NULL,
  "narration" VARCHAR(8000) NOT NULL,
  "outline" JSONB NOT NULL,
  "questions" JSONB NOT NULL,
  "passing_score" INTEGER NOT NULL DEFAULT 80,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "lessons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "lesson_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "lesson_id" UUID NOT NULL,
  "learner_id" UUID NOT NULL,
  "answers" JSONB NOT NULL,
  "score" INTEGER NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "stage" VARCHAR(20) NOT NULL,
  "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lesson_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "skill_credentials" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "attempt_id" UUID NOT NULL,
  "learner_id" UUID NOT NULL,
  "verification_hash" VARCHAR(64) NOT NULL,
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "skill_credentials_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "skill_credentials_attempt_id_key" ON "skill_credentials"("attempt_id");
CREATE UNIQUE INDEX "skill_credentials_verification_hash_key" ON "skill_credentials"("verification_hash");
CREATE INDEX "lessons_tenant_id_asset_id_created_at_idx" ON "lessons"("tenant_id", "asset_id", "created_at");
CREATE INDEX "lessons_tenant_id_is_published_idx" ON "lessons"("tenant_id", "is_published");
CREATE INDEX "lesson_attempts_tenant_id_learner_id_completed_at_idx" ON "lesson_attempts"("tenant_id", "learner_id", "completed_at");
CREATE INDEX "lesson_attempts_tenant_id_lesson_id_idx" ON "lesson_attempts"("tenant_id", "lesson_id");
CREATE INDEX "skill_credentials_tenant_id_learner_id_issued_at_idx" ON "skill_credentials"("tenant_id", "learner_id", "issued_at");

ALTER TABLE "lessons" ADD CONSTRAINT "lessons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_asset_version_id_fkey" FOREIGN KEY ("asset_version_id") REFERENCES "asset_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lesson_attempts" ADD CONSTRAINT "lesson_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_attempts" ADD CONSTRAINT "lesson_attempts_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lesson_attempts" ADD CONSTRAINT "lesson_attempts_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "skill_credentials" ADD CONSTRAINT "skill_credentials_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "skill_credentials" ADD CONSTRAINT "skill_credentials_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "lesson_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "skill_credentials" ADD CONSTRAINT "skill_credentials_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
