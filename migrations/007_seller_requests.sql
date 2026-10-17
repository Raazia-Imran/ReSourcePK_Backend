ALTER TYPE app.platform_role ADD VALUE IF NOT EXISTS 'platform_reviewer';

CREATE TABLE app.seller_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  organization_name VARCHAR(180) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES app.users(id) ON DELETE RESTRICT,
  reviewed_at TIMESTAMPTZ,
  review_note VARCHAR(1000),
  organization_id UUID UNIQUE REFERENCES app.organizations(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT seller_requests_org_name_not_blank CHECK (length(trim(organization_name)) >= 2),
  CONSTRAINT seller_requests_review_state_check CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND organization_id IS NULL) OR
    (status = 'approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND organization_id IS NOT NULL) OR
    (status = 'rejected' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND organization_id IS NULL)
  )
);

CREATE UNIQUE INDEX seller_requests_one_pending_per_user_idx
  ON app.seller_requests(user_id) WHERE status = 'pending';
CREATE UNIQUE INDEX seller_requests_one_approval_per_user_idx
  ON app.seller_requests(user_id) WHERE status = 'approved';
CREATE INDEX seller_requests_review_queue_idx
  ON app.seller_requests(status, created_at DESC, id DESC);
CREATE INDEX seller_requests_user_history_idx
  ON app.seller_requests(user_id, created_at DESC, id DESC);

CREATE TRIGGER seller_requests_set_updated_at BEFORE UPDATE ON app.seller_requests
FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

REVOKE ALL ON app.seller_requests FROM PUBLIC, anon, authenticated;
