CREATE TABLE platform_access (
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
 role VARCHAR(30) NOT NULL CHECK (role IN ('PlatformAdmin','PlatformModerator')),
 revoked_at TIMESTAMP(3), secret_cipher TEXT, pending_cipher TEXT,
 recovery_hashes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], last_totp_step BIGINT NOT NULL DEFAULT -1,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE platform_console_sessions (
 token_hash VARCHAR(64) PRIMARY KEY, user_id UUID NOT NULL REFERENCES platform_access(user_id) ON DELETE CASCADE,
 credential_hash VARCHAR(64) NOT NULL, expires_at TIMESTAMP(3) NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX platform_console_sessions_user_id_idx ON platform_console_sessions(user_id);
CREATE TABLE platform_events (
 id UUID PRIMARY KEY, actor_id UUID NOT NULL, action VARCHAR(100) NOT NULL, target_id UUID,
 details JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX platform_events_created_at_idx ON platform_events(created_at);
-- The ordinary tenant runtime cannot read grants, MFA credentials, sessions or global events.
REVOKE ALL ON platform_access, platform_console_sessions, platform_events FROM PUBLIC, void_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_access, platform_console_sessions TO void_platform;
GRANT SELECT, INSERT ON platform_events TO void_platform;
