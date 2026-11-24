-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "kind" VARCHAR(20) NOT NULL DEFAULT 'organization';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "learning_profile" JSONB;

-- AlterTable
ALTER TABLE "lessons" ADD COLUMN     "blocks" JSONB;

-- AlterTable
ALTER TABLE "courses" ADD COLUMN     "learning_meta" JSONB;

-- AlterTable
ALTER TABLE "simulation_scenarios" ADD COLUMN     "learning_scope" VARCHAR(20) NOT NULL DEFAULT 'workspace';

-- CreateTable
CREATE TABLE "learning_sources" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "mime" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ready',
    "storage_path" TEXT,
    "passages" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_classes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "token_hash" VARCHAR(64),
    "token_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_class_members" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_class_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "class_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "release_id" UUID NOT NULL,
    "due_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_program_units" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "requirement" VARCHAR(30) NOT NULL DEFAULT 'pass_assessment',
    "lesson_id" UUID,
    "scenario_id" UUID,

    CONSTRAINT "learning_program_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_tasks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "input" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learning_sources_tenant_id_owner_id_idx" ON "learning_sources"("tenant_id", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "learning_classes_token_hash_key" ON "learning_classes"("token_hash");

-- CreateIndex
CREATE INDEX "learning_classes_tenant_id_owner_id_idx" ON "learning_classes"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "learning_class_members_tenant_id_user_id_idx" ON "learning_class_members"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "learning_class_members_class_id_user_id_key" ON "learning_class_members"("class_id", "user_id");

-- CreateIndex
CREATE INDEX "learning_assignments_tenant_id_class_id_idx" ON "learning_assignments"("tenant_id", "class_id");

-- CreateIndex
CREATE INDEX "learning_program_units_tenant_id_course_id_idx" ON "learning_program_units"("tenant_id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "learning_program_units_course_id_position_key" ON "learning_program_units"("course_id", "position");

-- CreateIndex
CREATE INDEX "learning_tasks_tenant_id_owner_id_created_at_idx" ON "learning_tasks"("tenant_id", "owner_id", "created_at");

-- AddForeignKey
ALTER TABLE "learning_sources" ADD CONSTRAINT "learning_sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_sources" ADD CONSTRAINT "learning_sources_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_classes" ADD CONSTRAINT "learning_classes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_classes" ADD CONSTRAINT "learning_classes_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_class_members" ADD CONSTRAINT "learning_class_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_class_members" ADD CONSTRAINT "learning_class_members_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "learning_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_class_members" ADD CONSTRAINT "learning_class_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_assignments" ADD CONSTRAINT "learning_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_assignments" ADD CONSTRAINT "learning_assignments_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "learning_classes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_program_units" ADD CONSTRAINT "learning_program_units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_program_units" ADD CONSTRAINT "learning_program_units_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_program_units" ADD CONSTRAINT "learning_program_units_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_program_units" ADD CONSTRAINT "learning_program_units_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "simulation_scenarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_tasks" ADD CONSTRAINT "learning_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_tasks" ADD CONSTRAINT "learning_tasks_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


INSERT INTO roles (id, name, description, created_at) VALUES (gen_random_uuid(), 'Learner', 'Learning participation and private study; no asset administration', CURRENT_TIMESTAMP) ON CONFLICT (name) DO NOTHING;
ALTER TABLE learning_program_units ADD CONSTRAINT learning_unit_target CHECK ((kind = 'lesson' AND lesson_id IS NOT NULL AND scenario_id IS NULL) OR (kind IN ('activity','quiz') AND scenario_id IS NOT NULL AND lesson_id IS NULL));
