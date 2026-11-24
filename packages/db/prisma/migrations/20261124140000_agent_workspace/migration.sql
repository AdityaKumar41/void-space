ALTER TABLE learning_sources ADD COLUMN metadata JSONB;
ALTER TABLE lesson_plan_releases ADD COLUMN visibility VARCHAR(20) NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','institution','public'));
CREATE TABLE learning_folders (id UUID PRIMARY KEY,tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,title VARCHAR(120) NOT NULL,created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX learning_folders_tenant_owner_idx ON learning_folders(tenant_id,owner_id);
CREATE TABLE learning_threads (id UUID PRIMARY KEY,tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,folder_id UUID REFERENCES learning_folders(id) ON DELETE SET NULL,title VARCHAR(200) NOT NULL,messages JSONB NOT NULL DEFAULT '[]',revision INTEGER NOT NULL DEFAULT 0,updated_at TIMESTAMP(3) NOT NULL,created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX learning_threads_tenant_owner_idx ON learning_threads(tenant_id,owner_id,updated_at);
CREATE TABLE public_lesson_entries (id UUID PRIMARY KEY REFERENCES lesson_plan_releases(id) ON DELETE CASCADE,tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,title VARCHAR(200) NOT NULL,summary VARCHAR(2000) NOT NULL,audience VARCHAR(200) NOT NULL,duration_minutes INTEGER NOT NULL,author_label VARCHAR(120) NOT NULL,created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX public_lesson_entries_created_at_idx ON public_lesson_entries(created_at);
-- Content remains immutable; access visibility can be changed or withdrawn independently.
CREATE OR REPLACE FUNCTION protect_lesson_release() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
IF (NEW.id,NEW.tenant_id,NEW.owner_id,NEW.plan_id,NEW.revision,NEW.definition,NEW.source_excerpts,NEW.reviewed,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.tenant_id,OLD.owner_id,OLD.plan_id,OLD.revision,OLD.definition,OLD.source_excerpts,OLD.reviewed,OLD.created_at) THEN RAISE EXCEPTION 'Published lesson content is immutable'; END IF; RETURN NEW; END $$;
