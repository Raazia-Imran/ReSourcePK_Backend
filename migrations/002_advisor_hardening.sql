CREATE SCHEMA IF NOT EXISTS extensions;
ALTER EXTENSION citext SET SCHEMA extensions;

CREATE INDEX IF NOT EXISTS organizations_created_by_idx ON app.organizations(created_by);
CREATE INDEX IF NOT EXISTS invitations_invited_by_idx ON app.organization_invitations(invited_by);
CREATE INDEX IF NOT EXISTS platform_assignments_granted_by_idx ON app.platform_assignments(granted_by);
CREATE INDEX IF NOT EXISTS sessions_replaced_by_idx ON app.sessions(replaced_by);
