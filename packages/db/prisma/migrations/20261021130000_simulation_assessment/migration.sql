CREATE TYPE "ScenarioStatus" AS ENUM ('draft', 'published');

CREATE TABLE "simulation_scenarios" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "description" VARCHAR(4000) NOT NULL,
  "status" "ScenarioStatus" NOT NULL DEFAULT 'draft',
  "lesson_id" UUID,
  "twin_id" UUID,
  "rubric" JSONB NOT NULL,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "simulation_scenarios_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scenario_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "scenario_id" UUID NOT NULL,
  "learner_id" UUID NOT NULL,
  "evidence" JSONB NOT NULL,
  "score" INTEGER NOT NULL,
  "passed" BOOLEAN NOT NULL,
  "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scenario_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "simulation_scenarios_tenant_id_status_updated_at_idx"
  ON "simulation_scenarios"("tenant_id", "status", "updated_at");
CREATE INDEX "scenario_attempts_tenant_id_learner_id_completed_at_idx"
  ON "scenario_attempts"("tenant_id", "learner_id", "completed_at");
CREATE INDEX "scenario_attempts_tenant_id_scenario_id_idx"
  ON "scenario_attempts"("tenant_id", "scenario_id");

ALTER TABLE "simulation_scenarios"
  ADD CONSTRAINT "simulation_scenarios_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "simulation_scenarios"
  ADD CONSTRAINT "simulation_scenarios_lesson_id_fkey"
  FOREIGN KEY ("lesson_id") REFERENCES "lessons"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "simulation_scenarios"
  ADD CONSTRAINT "simulation_scenarios_twin_id_fkey"
  FOREIGN KEY ("twin_id") REFERENCES "digital_twins"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "simulation_scenarios"
  ADD CONSTRAINT "simulation_scenarios_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scenario_attempts"
  ADD CONSTRAINT "scenario_attempts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scenario_attempts"
  ADD CONSTRAINT "scenario_attempts_scenario_id_fkey"
  FOREIGN KEY ("scenario_id") REFERENCES "simulation_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scenario_attempts"
  ADD CONSTRAINT "scenario_attempts_learner_id_fkey"
  FOREIGN KEY ("learner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
