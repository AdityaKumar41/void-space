CREATE TABLE learning_agent_runs (
 id UUID PRIMARY KEY REFERENCES learning_tasks(id) ON DELETE CASCADE,
 tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 engine VARCHAR(20) NOT NULL, dispatched_at TIMESTAMP(3), cancelled_at TIMESTAMP(3), created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX learning_agent_runs_tenant_id_owner_id_idx ON learning_agent_runs(tenant_id,owner_id);
CREATE TABLE learning_agent_events (
 sequence SERIAL PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 run_id UUID NOT NULL REFERENCES learning_tasks(id) ON DELETE CASCADE,
 payload JSONB NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX learning_agent_events_tenant_id_run_id_sequence_idx ON learning_agent_events(tenant_id,run_id,sequence);
CREATE TABLE learning_source_collections (
 id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 title VARCHAR(200) NOT NULL, source_ids JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX learning_source_collections_tenant_id_owner_id_idx ON learning_source_collections(tenant_id,owner_id);
CREATE TABLE learning_annotation_revisions (
 id UUID PRIMARY KEY, tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 model_id UUID NOT NULL REFERENCES learning_sources(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, labels JSONB NOT NULL, reviewed BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(model_id,revision)
);
CREATE INDEX learning_annotation_revisions_tenant_id_owner_id_model_id_idx ON learning_annotation_revisions(tenant_id,owner_id,model_id);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['learning_agent_runs','learning_agent_events','learning_source_collections','learning_annotation_revisions'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
 EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.current_tenant_id'', true)::uuid)', t);
 EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO void_app', t);
END LOOP; END $$;
GRANT USAGE, SELECT ON SEQUENCE learning_agent_events_sequence_seq TO void_app;
