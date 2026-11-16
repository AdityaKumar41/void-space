ALTER TABLE "lesson_progress"
  ADD COLUMN "learning_time_seconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_activity_at" TIMESTAMP(3);