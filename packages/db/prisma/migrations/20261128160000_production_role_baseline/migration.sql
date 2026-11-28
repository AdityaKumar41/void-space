-- Required platform roles must exist on a fresh installation without demo accounts/assets.
INSERT INTO roles (id, name, description, created_at) VALUES
(gen_random_uuid(), 'SuperAdmin', 'Legacy platform operator role.', CURRENT_TIMESTAMP),
(gen_random_uuid(), 'TenantAdmin', 'Manages one institution and its memberships.', CURRENT_TIMESTAMP),
(gen_random_uuid(), 'Creator', 'Authors learning and manages own assets.', CURRENT_TIMESTAMP),
(gen_random_uuid(), 'Assessor', 'Reviews and approves assets.', CURRENT_TIMESTAMP),
(gen_random_uuid(), 'Developer', 'Uses scoped machine API access.', CURRENT_TIMESTAMP),
(gen_random_uuid(), 'Viewer', 'Read-only published catalog access.', CURRENT_TIMESTAMP),
(gen_random_uuid(), 'Learner', 'Learning participation and private study.', CURRENT_TIMESTAMP)
ON CONFLICT (name) DO NOTHING;
