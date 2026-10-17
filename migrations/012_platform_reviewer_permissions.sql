CREATE TABLE IF NOT EXISTS app.platform_reviewer_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  token_hash CHAR(64) NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT platform_reviewer_invite_permissions_check
    CHECK (permissions <@ ARRAY['seller_requests.review', 'listings.review']::TEXT[]),
  CONSTRAINT platform_reviewer_invite_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS platform_reviewer_invitations_email_idx
  ON app.platform_reviewer_invitations(email, expires_at DESC);

CREATE TABLE IF NOT EXISTS app.platform_reviewer_permissions (
  user_id UUID NOT NULL,
  role app.platform_role NOT NULL DEFAULT 'platform_reviewer'
    CHECK (role = 'platform_reviewer'),
  permission TEXT NOT NULL CHECK (permission IN ('seller_requests.review', 'listings.review')),
  granted_by UUID NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, permission),
  FOREIGN KEY (user_id, role) REFERENCES app.platform_assignments(user_id, role) ON DELETE CASCADE
);
