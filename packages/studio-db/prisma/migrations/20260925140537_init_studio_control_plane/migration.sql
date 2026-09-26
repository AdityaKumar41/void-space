-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "StorageMode" AS ENUM ('local', 'cloud');

-- CreateEnum
CREATE TYPE "VersionKind" AS ENUM ('autosave', 'explicit');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('authored', 'imported', 'ai_generated');

-- CreateEnum
CREATE TYPE "TextureKind" AS ENUM ('albedo', 'normal', 'roughness', 'metallic', 'ao', 'emissive');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('pending', 'needs_manual_review', 'approved', 'rejected', 'revision', 'published');

-- CreateEnum
CREATE TYPE "CopilotRole" AS ENUM ('user', 'assistant', 'tool');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('queued', 'active', 'completed', 'failed', 'delayed');

-- CreateEnum
CREATE TYPE "StudioJobQueue" AS ENUM ('copilot', 'generative', 'csg', 'export', 'autosave', 'publish');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "storage_quota_bytes" BIGINT NOT NULL,
    "ai_feature_flags" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "display_name" VARCHAR(200) NOT NULL,
    "email" VARCHAR(320),
    "last_seen_role" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "folder_id" UUID,
    "status" "ProjectStatus" NOT NULL DEFAULT 'active',
    "storage_mode" "StorageMode" NOT NULL DEFAULT 'local',
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scenes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "document_ref" VARCHAR(120),
    "document_format" VARCHAR(20) NOT NULL DEFAULT 'struct',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scene_objects" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scene_id" UUID NOT NULL,
    "parent_id" UUID,
    "type" VARCHAR(60) NOT NULL,
    "name" VARCHAR(200),
    "transform" JSONB NOT NULL,
    "mesh_asset_id" UUID,
    "material_asset_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scene_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mesh_assets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "ipfs_cid" VARCHAR(120) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "polycount" INTEGER NOT NULL,
    "format" VARCHAR(10) NOT NULL,
    "source_type" "SourceType" NOT NULL,
    "review_pending" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mesh_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "texture_assets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "ipfs_cid" VARCHAR(120) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "kind" "TextureKind" NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "generation_set_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "texture_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_assets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "pbr_params" JSONB NOT NULL,
    "node_graph" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_textures" (
    "material_id" UUID NOT NULL,
    "texture_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "TextureKind" NOT NULL,
    "uv_settings" JSONB,

    CONSTRAINT "material_textures_pkey" PRIMARY KEY ("material_id","texture_id","kind")
);

-- CreateTable
CREATE TABLE "animation_clips" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scene_object_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "gltf_animation" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "animation_clips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "label" VARCHAR(200),
    "kind" "VersionKind" NOT NULL DEFAULT 'autosave',
    "document_ref" VARCHAR(120),
    "document_format" VARCHAR(20) NOT NULL DEFAULT 'struct',
    "thumbnail_cid" VARCHAR(120),
    "readiness_score" INTEGER,
    "readiness_threshold" INTEGER,
    "readiness_passed" BOOLEAN,
    "readiness_report" JSONB,
    "readiness_run_at" TIMESTAMPTZ(6),
    "export_metadata" JSONB,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "project_version_id" UUID,
    "export_sha256" VARCHAR(64),
    "export_size_bytes" BIGINT,
    "voidspace_asset_id" VARCHAR(120) NOT NULL,
    "voidspace_asset_version_id" VARCHAR(120),
    "status" "PublishStatus" NOT NULL DEFAULT 'pending',
    "voidspace_raw_status" VARCHAR(60),
    "last_synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sync_error" VARCHAR(500),
    "review_decision" "PublishStatus",
    "review_comments" JSONB,
    "review_decision_at" TIMESTAMPTZ(6),
    "acknowledged_by_id" UUID,
    "acknowledged_at" TIMESTAMPTZ(6),
    "acknowledged_score" INTEGER,
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "readiness_score" INTEGER,
    "readiness_passed" BOOLEAN,
    "readiness_report" JSONB,
    "export_validation" JSONB,
    "superseded_at" TIMESTAMPTZ(6),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "publish_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copilot_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(200),
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "copilot_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "copilot_messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "role" "CopilotRole" NOT NULL,
    "content" TEXT NOT NULL,
    "tool_calls" JSONB NOT NULL DEFAULT '[]',
    "applied_command_ids" JSONB NOT NULL DEFAULT '[]',
    "provider" VARCHAR(30),
    "model" VARCHAR(120),
    "prompt_version" VARCHAR(60),
    "duration_ms" INTEGER,
    "ok" BOOLEAN,
    "failure_kind" VARCHAR(60),
    "usage" JSONB,
    "redacted" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "copilot_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "project_id" UUID,
    "user_id" UUID,
    "queue" "StudioJobQueue" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'queued',
    "bull_job_id" VARCHAR(120),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error" VARCHAR(2000),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "run_at" TIMESTAMPTZ(6),
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "folders_tenant_id_parent_id_idx" ON "folders"("tenant_id", "parent_id");

-- CreateIndex
CREATE INDEX "projects_tenant_id_status_idx" ON "projects"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "projects_tenant_id_folder_id_idx" ON "projects"("tenant_id", "folder_id");

-- CreateIndex
CREATE INDEX "projects_tenant_id_updated_at_idx" ON "projects"("tenant_id", "updated_at");

-- CreateIndex
CREATE INDEX "scenes_tenant_id_project_id_idx" ON "scenes"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "scene_objects_tenant_id_scene_id_idx" ON "scene_objects"("tenant_id", "scene_id");

-- CreateIndex
CREATE INDEX "scene_objects_tenant_id_parent_id_idx" ON "scene_objects"("tenant_id", "parent_id");

-- CreateIndex
CREATE INDEX "mesh_assets_tenant_id_project_id_idx" ON "mesh_assets"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "mesh_assets_tenant_id_ipfs_cid_key" ON "mesh_assets"("tenant_id", "ipfs_cid");

-- CreateIndex
CREATE INDEX "texture_assets_tenant_id_project_id_idx" ON "texture_assets"("tenant_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "texture_assets_tenant_id_ipfs_cid_key" ON "texture_assets"("tenant_id", "ipfs_cid");

-- CreateIndex
CREATE INDEX "material_assets_tenant_id_project_id_idx" ON "material_assets"("tenant_id", "project_id");

-- CreateIndex
CREATE INDEX "material_textures_tenant_id_idx" ON "material_textures"("tenant_id");

-- CreateIndex
CREATE INDEX "animation_clips_tenant_id_scene_object_id_idx" ON "animation_clips"("tenant_id", "scene_object_id");

-- CreateIndex
CREATE INDEX "project_versions_tenant_id_project_id_created_at_idx" ON "project_versions"("tenant_id", "project_id", "created_at");

-- CreateIndex
CREATE INDEX "project_versions_tenant_id_project_id_kind_idx" ON "project_versions"("tenant_id", "project_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "project_versions_project_id_version_number_key" ON "project_versions"("project_id", "version_number");

-- CreateIndex
CREATE INDEX "publish_records_tenant_id_project_id_created_at_idx" ON "publish_records"("tenant_id", "project_id", "created_at");

-- CreateIndex
CREATE INDEX "publish_records_tenant_id_voidspace_asset_id_idx" ON "publish_records"("tenant_id", "voidspace_asset_id");

-- CreateIndex
CREATE INDEX "copilot_sessions_tenant_id_project_id_started_at_idx" ON "copilot_sessions"("tenant_id", "project_id", "started_at");

-- CreateIndex
CREATE INDEX "copilot_messages_tenant_id_session_id_created_at_idx" ON "copilot_messages"("tenant_id", "session_id", "created_at");

-- CreateIndex
CREATE INDEX "jobs_tenant_id_status_idx" ON "jobs"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "jobs_tenant_id_project_id_created_at_idx" ON "jobs"("tenant_id", "project_id", "created_at");

-- CreateIndex
CREATE INDEX "jobs_bull_job_id_idx" ON "jobs"("bull_job_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folders" ADD CONSTRAINT "folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "folders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene_objects" ADD CONSTRAINT "scene_objects_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene_objects" ADD CONSTRAINT "scene_objects_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "scene_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene_objects" ADD CONSTRAINT "scene_objects_mesh_asset_id_fkey" FOREIGN KEY ("mesh_asset_id") REFERENCES "mesh_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene_objects" ADD CONSTRAINT "scene_objects_material_asset_id_fkey" FOREIGN KEY ("material_asset_id") REFERENCES "material_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mesh_assets" ADD CONSTRAINT "mesh_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "texture_assets" ADD CONSTRAINT "texture_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_assets" ADD CONSTRAINT "material_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_textures" ADD CONSTRAINT "material_textures_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "material_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_textures" ADD CONSTRAINT "material_textures_texture_id_fkey" FOREIGN KEY ("texture_id") REFERENCES "texture_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "animation_clips" ADD CONSTRAINT "animation_clips_scene_object_id_fkey" FOREIGN KEY ("scene_object_id") REFERENCES "scene_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_versions" ADD CONSTRAINT "project_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_records" ADD CONSTRAINT "publish_records_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_records" ADD CONSTRAINT "publish_records_project_version_id_fkey" FOREIGN KEY ("project_version_id") REFERENCES "project_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_records" ADD CONSTRAINT "publish_records_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_sessions" ADD CONSTRAINT "copilot_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_sessions" ADD CONSTRAINT "copilot_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_sessions" ADD CONSTRAINT "copilot_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "copilot_messages" ADD CONSTRAINT "copilot_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "copilot_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
