-- Documents & Notes: private learning-workspace files and authored notes.
CREATE TYPE "DocumentKind" AS ENUM ('file', 'note');

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind "DocumentKind" NOT NULL DEFAULT 'file',
  title VARCHAR(200) NOT NULL,
  description VARCHAR(4000),
  category VARCHAR(60) NOT NULL DEFAULT 'General',
  topic VARCHAR(120),
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  lesson_id UUID REFERENCES lessons(id) ON DELETE SET NULL,
  content TEXT,
  file_name VARCHAR(255),
  mime_type VARCHAR(160),
  size_bytes BIGINT,
  storage_key VARCHAR(300),
  sha256 VARCHAR(64),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL
);

CREATE INDEX documents_tenant_id_kind_updated_at_idx ON documents(tenant_id, kind, updated_at);
CREATE INDEX documents_tenant_id_category_idx ON documents(tenant_id, category);
CREATE INDEX documents_tenant_id_course_id_idx ON documents(tenant_id, course_id);
CREATE INDEX documents_tenant_id_lesson_id_idx ON documents(tenant_id, lesson_id);

-- Two layers of isolation: the policy protects every query, and the runtime role
-- receives its table grants in prisma/sql/rls.sql after each migration.
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY documents_tenant_isolation ON documents
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
