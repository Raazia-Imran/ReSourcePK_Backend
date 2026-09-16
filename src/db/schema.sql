-- ReSource PK — PostgreSQL Phase 1 Schema
-- Run this file against a new PostgreSQL database.
-- This schema uses UUID identifiers and PostgreSQL enums for state fields.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('BUYER', 'SELLER', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('ACTIVE', 'SUSPENDED', 'PENDING');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE listing_status AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'SOLD_OUT', 'REMOVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE requirement_status AS ENUM ('OPEN', 'MATCHED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE group_order_status AS ENUM (
    'OPEN',
    'TARGET_REACHED',
    'PAYMENT_CAPTURE_PENDING',
    'CONFIRMED',
    'COMPLETED',
    'EXPIRED',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE contribution_payment_status AS ENUM (
    'NOT_STARTED',
    'AUTHORIZED',
    'CAPTURED',
    'RELEASED',
    'REFUNDED',
    'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM (
    'PENDING',
    'CONFIRMED',
    'READY_FOR_PICKUP',
    'RECEIVED',
    'COMPLETED',
    'DISPUTED',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM (
    'CREATED',
    'PENDING',
    'AUTHORIZED',
    'CAPTURED',
    'RELEASED',
    'REFUNDED',
    'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE blockchain_status AS ENUM ('PENDING', 'CONFIRMED', 'FAILED', 'SIMULATED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE dispute_status AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Shared trigger function
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Users and Admin invitations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  phone VARCHAR(30) NOT NULL,
  city VARCHAR(100) NOT NULL,
  role user_role NOT NULL DEFAULT 'BUYER',
  status user_status NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique_idx
  ON users (LOWER(email));

CREATE INDEX IF NOT EXISTS users_role_status_idx
  ON users (role, status);

CREATE TABLE IF NOT EXISTS admin_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT admin_invitation_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS admin_invitations_email_idx
  ON admin_invitations (LOWER(email));

CREATE INDEX IF NOT EXISTS admin_invitations_active_idx
  ON admin_invitations (expires_at)
  WHERE accepted_at IS NULL;

-- ---------------------------------------------------------------------------
-- Listings and price tiers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  material_type VARCHAR(100) NOT NULL,
  color VARCHAR(80),
  condition VARCHAR(80),
  quantity_available_kg NUMERIC(12, 3) NOT NULL,
  minimum_group_quantity_kg NUMERIC(12, 3) NOT NULL,
  location VARCHAR(150) NOT NULL,
  photos JSONB NOT NULL DEFAULT '[]'::JSONB,
  status listing_status NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT listings_quantity_positive_check CHECK (quantity_available_kg > 0),
  CONSTRAINT listings_minimum_positive_check CHECK (minimum_group_quantity_kg > 0),
  CONSTRAINT listings_minimum_within_quantity_check
    CHECK (minimum_group_quantity_kg <= quantity_available_kg)
);

CREATE INDEX IF NOT EXISTS listings_seller_idx
  ON listings (seller_id);

CREATE INDEX IF NOT EXISTS listings_active_search_idx
  ON listings (status, material_type, location);

CREATE INDEX IF NOT EXISTS listings_created_at_idx
  ON listings (created_at DESC);

CREATE TABLE IF NOT EXISTS listing_price_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  minimum_quantity_kg NUMERIC(12, 3) NOT NULL,
  price_per_kg_pkr NUMERIC(14, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT listing_tier_quantity_positive_check CHECK (minimum_quantity_kg > 0),
  CONSTRAINT listing_tier_price_positive_check CHECK (price_per_kg_pkr > 0),
  CONSTRAINT listing_tier_quantity_unique UNIQUE (listing_id, minimum_quantity_kg)
);

CREATE INDEX IF NOT EXISTS listing_price_tiers_listing_quantity_idx
  ON listing_price_tiers (listing_id, minimum_quantity_kg);

-- ---------------------------------------------------------------------------
-- Buyer requirements
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  material_type VARCHAR(100),
  description TEXT NOT NULL,
  minimum_quantity_kg NUMERIC(12, 3),
  maximum_quantity_kg NUMERIC(12, 3),
  maximum_price_per_kg_pkr NUMERIC(14, 2),
  location VARCHAR(150),
  status requirement_status NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT requirements_minimum_quantity_check
    CHECK (minimum_quantity_kg IS NULL OR minimum_quantity_kg > 0),
  CONSTRAINT requirements_maximum_quantity_check
    CHECK (maximum_quantity_kg IS NULL OR maximum_quantity_kg > 0),
  CONSTRAINT requirements_quantity_range_check
    CHECK (
      minimum_quantity_kg IS NULL OR
      maximum_quantity_kg IS NULL OR
      minimum_quantity_kg <= maximum_quantity_kg
    ),
  CONSTRAINT requirements_max_price_check
    CHECK (maximum_price_per_kg_pkr IS NULL OR maximum_price_per_kg_pkr > 0)
);

CREATE INDEX IF NOT EXISTS requirements_buyer_status_idx
  ON requirements (buyer_id, status);

CREATE INDEX IF NOT EXISTS requirements_open_material_idx
  ON requirements (status, material_type);

-- ---------------------------------------------------------------------------
-- Group orders and contributions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS group_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_quantity_kg NUMERIC(12, 3) NOT NULL,
  pooled_quantity_kg NUMERIC(12, 3) NOT NULL DEFAULT 0,
  current_price_per_kg_pkr NUMERIC(14, 2) NOT NULL,
  status group_order_status NOT NULL DEFAULT 'OPEN',
  deadline_at TIMESTAMPTZ NOT NULL,
  listing_snapshot JSONB NOT NULL,
  price_tiers_snapshot JSONB NOT NULL,
  confirmed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT group_order_target_positive_check CHECK (target_quantity_kg > 0),
  CONSTRAINT group_order_pooled_nonnegative_check CHECK (pooled_quantity_kg >= 0),
  CONSTRAINT group_order_price_positive_check CHECK (current_price_per_kg_pkr > 0),
  CONSTRAINT group_order_pooled_not_over_target_check
    CHECK (pooled_quantity_kg <= target_quantity_kg),
  CONSTRAINT group_order_deadline_check CHECK (deadline_at > created_at)
);

CREATE INDEX IF NOT EXISTS group_orders_listing_status_idx
  ON group_orders (listing_id, status);

CREATE INDEX IF NOT EXISTS group_orders_seller_status_idx
  ON group_orders (seller_id, status);

CREATE INDEX IF NOT EXISTS group_orders_deadline_open_idx
  ON group_orders (deadline_at)
  WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS group_order_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_order_id UUID NOT NULL REFERENCES group_orders(id) ON DELETE RESTRICT,
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  quantity_kg NUMERIC(12, 3) NOT NULL,
  price_per_kg_pkr NUMERIC(14, 2) NOT NULL,
  amount_pkr NUMERIC(14, 2) NOT NULL,
  payment_status contribution_payment_status NOT NULL DEFAULT 'NOT_STARTED',
  payment_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT contribution_quantity_positive_check CHECK (quantity_kg > 0),
  CONSTRAINT contribution_price_positive_check CHECK (price_per_kg_pkr > 0),
  CONSTRAINT contribution_amount_positive_check CHECK (amount_pkr > 0),
  CONSTRAINT contribution_buyer_once_per_group UNIQUE (group_order_id, buyer_id)
);

CREATE INDEX IF NOT EXISTS contributions_group_order_idx
  ON group_order_contributions (group_order_id);

CREATE INDEX IF NOT EXISTS contributions_buyer_status_idx
  ON group_order_contributions (buyer_id, payment_status);

-- ---------------------------------------------------------------------------
-- Orders and payments
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_order_id UUID NOT NULL REFERENCES group_orders(id) ON DELETE RESTRICT,
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  buyer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  contribution_id UUID NOT NULL UNIQUE REFERENCES group_order_contributions(id) ON DELETE RESTRICT,
  quantity_kg NUMERIC(12, 3) NOT NULL,
  price_per_kg_pkr NUMERIC(14, 2) NOT NULL,
  total_amount_pkr NUMERIC(14, 2) NOT NULL,
  status order_status NOT NULL DEFAULT 'PENDING',
  received_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_quantity_positive_check CHECK (quantity_kg > 0),
  CONSTRAINT order_price_positive_check CHECK (price_per_kg_pkr > 0),
  CONSTRAINT order_total_positive_check CHECK (total_amount_pkr > 0)
);

CREATE INDEX IF NOT EXISTS orders_buyer_status_idx
  ON orders (buyer_id, status);

CREATE INDEX IF NOT EXISTS orders_seller_status_idx
  ON orders (seller_id, status);

CREATE INDEX IF NOT EXISTS orders_group_order_idx
  ON orders (group_order_id);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  group_order_id UUID REFERENCES group_orders(id) ON DELETE RESTRICT,
  contribution_id UUID UNIQUE REFERENCES group_order_contributions(id) ON DELETE RESTRICT,
  provider VARCHAR(50) NOT NULL DEFAULT 'RAPID_GATEWAY',
  provider_transaction_id VARCHAR(255),
  method VARCHAR(50),
  amount_pkr NUMERIC(14, 2) NOT NULL,
  status payment_status NOT NULL DEFAULT 'CREATED',
  idempotency_key VARCHAR(255) UNIQUE,
  provider_payload JSONB,
  failure_reason TEXT,
  authorized_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT payment_amount_positive_check CHECK (amount_pkr > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_transaction_unique_idx
  ON payments (provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payments_user_status_idx
  ON payments (user_id, status);

CREATE INDEX IF NOT EXISTS payments_group_order_status_idx
  ON payments (group_order_id, status);

-- Add this relationship after both tables exist.
ALTER TABLE group_order_contributions
  DROP CONSTRAINT IF EXISTS group_order_contributions_payment_id_fkey;

ALTER TABLE group_order_contributions
  ADD CONSTRAINT group_order_contributions_payment_id_fkey
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Ratings and blockchain records
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  rater_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  ratee_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  stars SMALLINT NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rating_stars_check CHECK (stars BETWEEN 1 AND 5),
  CONSTRAINT rating_no_self_rating_check CHECK (rater_id <> ratee_id),
  CONSTRAINT rating_once_per_order_per_rater UNIQUE (order_id, rater_id)
);

CREATE INDEX IF NOT EXISTS ratings_ratee_created_idx
  ON ratings (ratee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ratings_order_idx
  ON ratings (order_id);

CREATE TABLE IF NOT EXISTS blockchain_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
  hash VARCHAR(128) NOT NULL,
  network VARCHAR(50) NOT NULL DEFAULT 'POLYGON_AMOY',
  contract_address VARCHAR(255),
  transaction_hash VARCHAR(255),
  status blockchain_status NOT NULL DEFAULT 'PENDING',
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS blockchain_records_status_idx
  ON blockchain_records (status);

CREATE UNIQUE INDEX IF NOT EXISTS blockchain_records_transaction_unique_idx
  ON blockchain_records (transaction_hash)
  WHERE transaction_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Notifications, disputes, and audit logs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(80) NOT NULL,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  data JSONB,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  opened_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  status dispute_status NOT NULL DEFAULT 'OPEN',
  resolution TEXT,
  resolved_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS disputes_status_created_idx
  ON disputes (status, created_at DESC);

CREATE INDEX IF NOT EXISTS disputes_order_idx
  ON disputes (order_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(120) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id UUID,
  metadata JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_actor_created_idx
  ON audit_logs (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_resource_idx
  ON audit_logs (resource_type, resource_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Updated-at triggers
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS listings_set_updated_at ON listings;
CREATE TRIGGER listings_set_updated_at
BEFORE UPDATE ON listings
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS requirements_set_updated_at ON requirements;
CREATE TRIGGER requirements_set_updated_at
BEFORE UPDATE ON requirements
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS group_orders_set_updated_at ON group_orders;
CREATE TRIGGER group_orders_set_updated_at
BEFORE UPDATE ON group_orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS contributions_set_updated_at ON group_order_contributions;
CREATE TRIGGER contributions_set_updated_at
BEFORE UPDATE ON group_order_contributions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS orders_set_updated_at ON orders;
CREATE TRIGGER orders_set_updated_at
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS payments_set_updated_at ON payments;
CREATE TRIGGER payments_set_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS disputes_set_updated_at ON disputes;
CREATE TRIGGER disputes_set_updated_at
BEFORE UPDATE ON disputes
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Role invariants
-- ---------------------------------------------------------------------------

-- These checks are enforced in the application service layer because PostgreSQL
-- CHECK constraints cannot safely query another table. Every service creating
-- a resource must verify the expected role and ownership before inserting.
COMMENT ON TABLE users IS 'Buyer, Seller, and invite-created Admin accounts.';
COMMENT ON TABLE group_orders IS 'Pooled buyer demand against a seller listing; lock this row while joining.';
COMMENT ON TABLE payments IS 'Rapid Gateway fiat payment records; crypto is intentionally out of MVP scope.';
COMMENT ON TABLE blockchain_records IS 'Polygon Amoy verification records, not payment settlement records.';
