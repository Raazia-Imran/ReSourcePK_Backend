ALTER TABLE app.organization_invitations
  ADD COLUMN staff_permissions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD CONSTRAINT organization_invitation_staff_permissions_check
    CHECK (staff_permissions <@ ARRAY['listings.view', 'listings.manage']::TEXT[]);

CREATE TABLE IF NOT EXISTS app.organization_membership_permissions (
  membership_id UUID NOT NULL REFERENCES app.organization_memberships(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('listings.view', 'listings.manage')),
  granted_by UUID NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (membership_id, permission)
);

CREATE INDEX IF NOT EXISTS membership_permissions_granted_by_idx
  ON app.organization_membership_permissions(granted_by, created_at DESC);
