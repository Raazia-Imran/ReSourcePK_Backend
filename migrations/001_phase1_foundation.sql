CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS app;
REVOKE ALL ON SCHEMA app FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  CREATE TYPE app.user_status AS ENUM ('pending', 'active', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.organization_status AS ENUM ('pending', 'active', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.membership_role AS ENUM ('owner', 'org_admin', 'manager', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.membership_status AS ENUM ('active', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.platform_role AS ENUM ('platform_admin', 'platform_support', 'platform_auditor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.email_token_type AS ENUM ('verify_email', 'password_reset');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS app.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email CITEXT NOT NULL UNIQUE,
  full_name VARCHAR(120) NOT NULL,
  password_hash TEXT NOT NULL,
  status app.user_status NOT NULL DEFAULT 'pending',
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_name_not_blank CHECK (length(trim(full_name)) >= 2),
  CONSTRAINT users_password_hash_not_blank CHECK (length(password_hash) >= 20)
);

CREATE TABLE IF NOT EXISTS app.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  refresh_token_hash CHAR(64) NOT NULL UNIQUE,
  user_agent TEXT,
  ip_address INET,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  replaced_by UUID REFERENCES app.sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sessions_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS sessions_user_active_idx
  ON app.sessions(user_id, expires_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS app.email_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  type app.email_token_type NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_tokens_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS email_tokens_user_type_active_idx
  ON app.email_tokens(user_id, type, expires_at DESC) WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS app.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(180) NOT NULL,
  slug VARCHAR(100) NOT NULL UNIQUE,
  status app.organization_status NOT NULL DEFAULT 'active',
  created_by UUID NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organizations_name_not_blank CHECK (length(trim(name)) >= 2),
  CONSTRAINT organizations_slug_format CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE TABLE IF NOT EXISTS app.organization_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  role app.membership_role NOT NULL,
  status app.membership_status NOT NULL DEFAULT 'active',
  can_invite_staff BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_active_idx
  ON app.organization_memberships(user_id, organization_id) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS app.organization_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES app.organizations(id) ON DELETE CASCADE,
  email CITEXT NOT NULL,
  role app.membership_role NOT NULL,
  can_invite_staff BOOLEAN NOT NULL DEFAULT FALSE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT organization_invitation_role_check CHECK (role <> 'owner'),
  CONSTRAINT organization_invitation_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS invitations_org_email_idx
  ON app.organization_invitations(organization_id, email, expires_at DESC);

CREATE TABLE IF NOT EXISTS app.platform_assignments (
  user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  role app.platform_role NOT NULL,
  granted_by UUID REFERENCES app.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS app.email_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key VARCHAR(180) NOT NULL UNIQUE,
  recipient CITEXT NOT NULL,
  template VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  provider_message_id TEXT,
  last_error TEXT,
  attempt_count SMALLINT NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_delivery_status_check CHECK (status IN ('pending', 'sent', 'failed')),
  CONSTRAINT email_delivery_attempt_check CHECK (attempt_count >= 0)
);

CREATE TABLE IF NOT EXISTS app.audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES app.users(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES app.organizations(id) ON DELETE SET NULL,
  action VARCHAR(120) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id UUID,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_events_actor_created_idx
  ON app.audit_events(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_org_created_idx
  ON app.audit_events(organization_id, created_at DESC);

CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_set_updated_at ON app.users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON app.users
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS organizations_set_updated_at ON app.organizations;
CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON app.organizations
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS memberships_set_updated_at ON app.organization_memberships;
CREATE TRIGGER memberships_set_updated_at BEFORE UPDATE ON app.organization_memberships
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
DROP TRIGGER IF EXISTS email_deliveries_set_updated_at ON app.email_deliveries;
CREATE TRIGGER email_deliveries_set_updated_at BEFORE UPDATE ON app.email_deliveries
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

COMMENT ON SCHEMA app IS 'Private application schema; accessed by the trusted Express API only.';
