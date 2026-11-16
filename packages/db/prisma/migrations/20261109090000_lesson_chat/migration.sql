CREATE TABLE lesson_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  learner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX lesson_conversations_tenant_id_lesson_id_learner_id_key
  ON lesson_conversations(tenant_id, lesson_id, learner_id);
CREATE INDEX lesson_conversations_tenant_id_learner_id_updated_at_idx
  ON lesson_conversations(tenant_id, learner_id, updated_at);

CREATE TABLE lesson_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES lesson_conversations(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  role VARCHAR(12) NOT NULL,
  content VARCHAR(12000) NOT NULL,
  mode VARCHAR(20),
  provider VARCHAR(60),
  model VARCHAR(120),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX lesson_chat_messages_conversation_id_sequence_key
  ON lesson_chat_messages(conversation_id, sequence);
CREATE INDEX lesson_chat_messages_tenant_id_conversation_id_sequence_idx
  ON lesson_chat_messages(tenant_id, conversation_id, sequence);

ALTER TABLE lesson_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY lesson_conversations_tenant_isolation ON lesson_conversations
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE lesson_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_chat_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY lesson_chat_messages_tenant_isolation ON lesson_chat_messages
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
