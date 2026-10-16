-- Google is an authentication method, not an application role. New Google
-- accounts start as regular verified users; seller and platform access remains
-- governed by organization memberships and explicit platform assignments.
ALTER TABLE app.users
  ALTER COLUMN password_hash DROP NOT NULL,
  DROP CONSTRAINT users_password_hash_not_blank,
  ADD CONSTRAINT users_password_hash_optional_check
    CHECK (password_hash IS NULL OR length(password_hash) >= 20);

CREATE TABLE app.google_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES app.users(id) ON DELETE CASCADE,
  google_subject VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE app.google_auth_nonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce_hash CHAR(64) NOT NULL UNIQUE,
  purpose VARCHAR(8) NOT NULL CHECK (purpose IN ('login', 'link')),
  user_id UUID REFERENCES app.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT google_auth_nonce_purpose_user_check CHECK (
    (purpose = 'login' AND user_id IS NULL) OR
    (purpose = 'link' AND user_id IS NOT NULL)
  ),
  CONSTRAINT google_auth_nonce_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX google_auth_nonces_expiry_idx ON app.google_auth_nonces(expires_at);

REVOKE ALL ON app.google_identities, app.google_auth_nonces FROM PUBLIC, anon, authenticated;
