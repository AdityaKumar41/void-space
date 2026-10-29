CREATE TYPE "EnrollmentStatus" AS ENUM ('active', 'completed');

CREATE TABLE "courses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "description" VARCHAR(4000) NOT NULL,
  "is_published" BOOLEAN NOT NULL DEFAULT false,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "course_lessons" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "course_id" UUID NOT NULL,
  "lesson_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  CONSTRAINT "course_lessons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "course_enrollments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "course_id" UUID NOT NULL,
  "learner_id" UUID NOT NULL,
  "status" "EnrollmentStatus" NOT NULL DEFAULT 'active',
  "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "course_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "courses_tenant_id_slug_key" ON "courses"("tenant_id", "slug");
CREATE INDEX "courses_tenant_id_is_published_updated_at_idx" ON "courses"("tenant_id", "is_published", "updated_at");
CREATE UNIQUE INDEX "course_lessons_course_id_lesson_id_key" ON "course_lessons"("course_id", "lesson_id");
CREATE UNIQUE INDEX "course_lessons_course_id_position_key" ON "course_lessons"("course_id", "position");
CREATE INDEX "course_lessons_tenant_id_lesson_id_idx" ON "course_lessons"("tenant_id", "lesson_id");
CREATE UNIQUE INDEX "course_enrollments_course_id_learner_id_key" ON "course_enrollments"("course_id", "learner_id");
CREATE INDEX "course_enrollments_tenant_id_learner_id_status_idx" ON "course_enrollments"("tenant_id", "learner_id", "status");

ALTER TABLE "courses" ADD CONSTRAINT "courses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "courses" ADD CONSTRAINT "courses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_learner_id_fkey" FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
