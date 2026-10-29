ALTER TABLE simulation_scenarios ADD COLUMN experience JSONB;
CREATE TABLE experience_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 scenario_id UUID NOT NULL REFERENCES simulation_scenarios(id) ON DELETE CASCADE,
 learner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 mode VARCHAR(20) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'active', revision INTEGER NOT NULL DEFAULT 0,
 definition JSONB NOT NULL, state JSONB NOT NULL, attempt_id UUID UNIQUE REFERENCES scenario_attempts(id) ON DELETE SET NULL,
 started_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL, completed_at TIMESTAMP(3)
);
CREATE INDEX experience_runs_tenant_id_learner_id_scenario_id_status_idx ON experience_runs(tenant_id,learner_id,scenario_id,status);
CREATE UNIQUE INDEX experience_runs_one_active ON experience_runs(tenant_id,learner_id,scenario_id) WHERE status='active';
CREATE TABLE experience_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 run_id UUID NOT NULL REFERENCES experience_runs(id) ON DELETE CASCADE, event_key UUID NOT NULL,
 sequence INTEGER NOT NULL, step_id VARCHAR(80) NOT NULL, action JSONB NOT NULL, outcome JSONB NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(run_id,event_key), UNIQUE(run_id,sequence)
);
CREATE INDEX experience_events_tenant_id_run_id_sequence_idx ON experience_events(tenant_id,run_id,sequence);
ALTER TABLE experience_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE experience_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY experience_runs_tenant_isolation ON experience_runs USING(tenant_id=current_setting('app.current_tenant_id')::uuid) WITH CHECK(tenant_id=current_setting('app.current_tenant_id')::uuid);
ALTER TABLE experience_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE experience_events FORCE ROW LEVEL SECURITY;
CREATE POLICY experience_events_tenant_isolation ON experience_events USING(tenant_id=current_setting('app.current_tenant_id')::uuid) WITH CHECK(tenant_id=current_setting('app.current_tenant_id')::uuid);
