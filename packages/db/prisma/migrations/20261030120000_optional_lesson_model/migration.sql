-- A lesson can teach a subject from notes and a quiz. A 3D model is optional.
ALTER TABLE "lessons" ALTER COLUMN "asset_id" DROP NOT NULL;
ALTER TABLE "lessons" ALTER COLUMN "asset_version_id" DROP NOT NULL;
ALTER TABLE "lesson_progress" ALTER COLUMN "asset_version_id" DROP NOT NULL;
