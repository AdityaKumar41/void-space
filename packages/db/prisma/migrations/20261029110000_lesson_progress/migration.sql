CREATE TABLE lesson_progress (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
 learner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 asset_version_id UUID NOT NULL,
 step INTEGER NOT NULL DEFAULT 0,
 assessment BOOLEAN NOT NULL DEFAULT FALSE,
 answers JSONB NOT NULL,
 revision INTEGER NOT NULL DEFAULT 1,
 updated_at TIMESTAMP(3) NOT NULL,
 UNIQUE(tenant_id,lesson_id,learner_id)
);
CREATE INDEX lesson_progress_tenant_id_learner_id_idx ON lesson_progress(tenant_id,learner_id);
ALTER TABLE lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_progress FORCE ROW LEVEL SECURITY;
CREATE POLICY lesson_progress_tenant_isolation ON lesson_progress
 USING(tenant_id=current_setting('app.current_tenant_id')::uuid)
 WITH CHECK(tenant_id=current_setting('app.current_tenant_id')::uuid);
