CREATE TYPE "SpatialRoomStatus" AS ENUM ('draft', 'live', 'archived');

CREATE TABLE "spatial_rooms" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "status" "SpatialRoomStatus" NOT NULL DEFAULT 'draft',
  "lesson_id" UUID,
  "asset_id" UUID,
  "world_state" JSONB NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "spatial_rooms_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "spatial_participants" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "room_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "pose" JSONB,
  "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "spatial_participants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "spatial_rooms_tenant_id_status_updated_at_idx" ON "spatial_rooms"("tenant_id", "status", "updated_at");
CREATE UNIQUE INDEX "spatial_participants_room_id_user_id_key" ON "spatial_participants"("room_id", "user_id");
CREATE INDEX "spatial_participants_tenant_id_room_id_last_seen_at_idx" ON "spatial_participants"("tenant_id", "room_id", "last_seen_at");

ALTER TABLE "spatial_rooms" ADD CONSTRAINT "spatial_rooms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "spatial_rooms" ADD CONSTRAINT "spatial_rooms_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "spatial_rooms" ADD CONSTRAINT "spatial_rooms_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "spatial_rooms" ADD CONSTRAINT "spatial_rooms_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "spatial_participants" ADD CONSTRAINT "spatial_participants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "spatial_participants" ADD CONSTRAINT "spatial_participants_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "spatial_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "spatial_participants" ADD CONSTRAINT "spatial_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
