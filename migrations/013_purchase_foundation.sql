-- Phase 3, Chunk 1: purchase configuration and durable order/group records.
-- Runtime checkout, payment-provider callbacks and settlement are implemented
-- in later purchase chunks.

ALTER TABLE app.listings
  ADD COLUMN purchase_mode TEXT NOT NULL DEFAULT 'direct'
    CHECK (purchase_mode IN ('direct', 'group', 'both')),
  ADD CONSTRAINT listings_id_organization_unique UNIQUE (id, organization_id);

CREATE TABLE app.purchase_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  created_by UUID NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  target_quantity NUMERIC(14,3) NOT NULL CHECK (target_quantity > 0),
  unit TEXT NOT NULL CHECK (unit IN ('kg', 'meter', 'roll', 'piece')),
  closes_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'ready_for_confirmation', 'payment_open',
    'reconfirmation_required', 'paid', 'expired'
  )),
  confirmed_quantity NUMERIC(14,3) CHECK (confirmed_quantity > 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  seller_confirmed_by UUID REFERENCES app.users(id) ON DELETE RESTRICT,
  seller_confirmed_at TIMESTAMPTZ,
  deadline_decided_by UUID REFERENCES app.users(id) ON DELETE RESTRICT,
  deadline_decision TEXT CHECK (deadline_decision IN ('expire', 'confirm_smaller')),
  deadline_decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT purchase_groups_listing_org_fk
    FOREIGN KEY (listing_id, organization_id)
    REFERENCES app.listings(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT purchase_groups_close_after_create
    CHECK (closes_at > created_at),
  CONSTRAINT purchase_groups_deadline_decision_consistency CHECK (
    (deadline_decision IS NULL AND deadline_decided_by IS NULL AND deadline_decided_at IS NULL)
    OR (deadline_decision IS NOT NULL AND deadline_decided_by IS NOT NULL AND deadline_decided_at IS NOT NULL)
  ),
  CONSTRAINT purchase_groups_seller_confirmation_consistency CHECK (
    (seller_confirmed_by IS NULL AND seller_confirmed_at IS NULL)
    OR (seller_confirmed_by IS NOT NULL AND seller_confirmed_at IS NOT NULL)
  ),
  UNIQUE (id, listing_id, organization_id)
);

CREATE TABLE app.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  listing_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  group_id UUID,
  request_key UUID NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL CHECK (unit IN ('kg', 'meter', 'roll', 'piece')),
  currency CHAR(3) NOT NULL DEFAULT 'PKR' CHECK (currency = 'PKR'),
  listing_version INTEGER NOT NULL CHECK (listing_version > 0),
  price_tier_min_quantity NUMERIC(14,3) NOT NULL CHECK (price_tier_min_quantity > 0),
  unit_price_minor BIGINT NOT NULL CHECK (unit_price_minor > 0),
  total_minor BIGINT NOT NULL CHECK (total_minor > 0),
  status TEXT NOT NULL CHECK (status IN (
    'group_open', 'pending_seller_confirmation', 'pending_payment',
    'paid', 'rejected', 'payment_expired', 'withdrawn', 'group_expired'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seller_response_due_at TIMESTAMPTZ,
  seller_confirmed_by UUID REFERENCES app.users(id) ON DELETE RESTRICT,
  seller_confirmed_at TIMESTAMPTZ,
  payment_due_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT orders_listing_org_fk
    FOREIGN KEY (listing_id, organization_id)
    REFERENCES app.listings(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT orders_group_listing_org_fk
    FOREIGN KEY (group_id, listing_id, organization_id)
    REFERENCES app.purchase_groups(id, listing_id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT orders_direct_or_group CHECK (group_id IS NOT NULL OR status <> 'group_open'),
  CONSTRAINT orders_seller_response_deadline CHECK (
    (group_id IS NOT NULL AND seller_response_due_at IS NULL)
    OR (group_id IS NULL AND seller_response_due_at IS NOT NULL
        AND seller_response_due_at > created_at)
  ),
  CONSTRAINT orders_seller_confirmation_consistency CHECK (
    (seller_confirmed_by IS NULL AND seller_confirmed_at IS NULL AND payment_due_at IS NULL)
    OR (seller_confirmed_by IS NOT NULL AND seller_confirmed_at IS NOT NULL AND payment_due_at IS NOT NULL)
  ),
  CONSTRAINT orders_payment_due_after_confirmation CHECK (
    payment_due_at IS NULL OR payment_due_at = seller_confirmed_at + INTERVAL '72 hours'
  ),
  CONSTRAINT orders_paid_consistency CHECK (
    (status = 'paid' AND paid_at IS NOT NULL)
    OR (status <> 'paid' AND paid_at IS NULL)
  ),
  UNIQUE (buyer_id, request_key),
  UNIQUE (id, listing_id)
);

CREATE INDEX orders_buyer_created_idx ON app.orders(buyer_id, created_at DESC, id DESC);
CREATE INDEX orders_org_status_created_idx ON app.orders(organization_id, status, created_at DESC);
CREATE INDEX orders_group_status_idx ON app.orders(group_id, status) WHERE group_id IS NOT NULL;
CREATE INDEX orders_payment_expiry_idx ON app.orders(payment_due_at) WHERE status = 'pending_payment';
CREATE INDEX purchase_groups_listing_status_idx ON app.purchase_groups(listing_id, status, closes_at);
CREATE INDEX purchase_groups_org_status_idx ON app.purchase_groups(organization_id, status, created_at DESC);

CREATE TABLE app.inventory_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE,
  listing_id UUID NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'committed', 'released')),
  release_reason TEXT CHECK (release_reason IN (
    'seller_rejected', 'seller_timeout', 'buyer_withdrew', 'group_expired',
    'payment_timeout', 'order_cancelled'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  committed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ,
  CONSTRAINT inventory_reservation_terminal_state CHECK (
    (status = 'active' AND committed_at IS NULL AND released_at IS NULL AND release_reason IS NULL)
    OR (status = 'committed' AND committed_at IS NOT NULL AND released_at IS NULL AND release_reason IS NULL)
    OR (status = 'released' AND committed_at IS NULL AND released_at IS NOT NULL AND release_reason IS NOT NULL)
  ),
  CONSTRAINT inventory_reservation_order_listing_fk
    FOREIGN KEY (order_id, listing_id)
    REFERENCES app.orders(id, listing_id) ON DELETE RESTRICT
);
CREATE INDEX inventory_reservations_listing_status_idx
  ON app.inventory_reservations(listing_id, status);

CREATE TABLE app.order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  actor_id UUID REFERENCES app.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (length(trim(event_type)) BETWEEN 2 AND 80),
  prior_status TEXT,
  new_status TEXT,
  reason TEXT,
  correlation_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_created_idx ON app.order_events(order_id, created_at, id);
CREATE INDEX order_events_actor_created_idx ON app.order_events(actor_id, created_at DESC);

CREATE TABLE app.payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK (length(trim(provider)) BETWEEN 2 AND 80),
  method TEXT NOT NULL CHECK (method IN ('jazzcash', 'easypaisa', 'raast', 'card', 'bank_transfer')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL DEFAULT 'PKR' CHECK (currency = 'PKR'),
  idempotency_key UUID NOT NULL,
  provider_reference TEXT,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
    'created', 'pending', 'succeeded', 'failed', 'expired', 'refund_pending', 'refunded'
  )),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, idempotency_key),
  UNIQUE (provider, provider_reference)
);
CREATE INDEX payment_attempts_order_created_idx ON app.payment_attempts(order_id, created_at DESC);
CREATE INDEX payment_attempts_expiry_idx ON app.payment_attempts(expires_at) WHERE status IN ('created', 'pending');

CREATE TABLE app.payment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id UUID NOT NULL REFERENCES app.payment_attempts(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_hash CHAR(64) NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  signature_verified BOOLEAN NOT NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX payment_events_attempt_created_idx ON app.payment_events(payment_attempt_id, created_at);

-- Snapshot fields cannot be altered after order creation, even when lifecycle
-- status and timestamps are advanced by trusted application code.
CREATE FUNCTION app.protect_order_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF ROW(NEW.buyer_id, NEW.listing_id, NEW.organization_id, NEW.group_id,
         NEW.quantity, NEW.unit, NEW.currency, NEW.listing_version,
         NEW.price_tier_min_quantity, NEW.unit_price_minor, NEW.total_minor)
     IS DISTINCT FROM
     ROW(OLD.buyer_id, OLD.listing_id, OLD.organization_id, OLD.group_id,
         OLD.quantity, OLD.unit, OLD.currency, OLD.listing_version,
         OLD.price_tier_min_quantity, OLD.unit_price_minor, OLD.total_minor) THEN
    RAISE EXCEPTION 'order terms are immutable' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER orders_snapshot_immutable BEFORE UPDATE ON app.orders
FOR EACH ROW EXECUTE FUNCTION app.protect_order_snapshot();

-- Do not let a seller lower advertised stock beneath active reservations and
-- paid/committed quantities. Reservations are the stock accounting source.
CREATE FUNCTION app.protect_reserved_listing_quantity() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  reserved NUMERIC(14,3);
BEGIN
  IF NEW.quantity < OLD.quantity THEN
    SELECT COALESCE(sum(r.quantity), 0) INTO reserved
      FROM app.inventory_reservations r
     WHERE r.listing_id = OLD.id AND r.status IN ('active', 'committed');
    IF NEW.quantity < reserved THEN
      RAISE EXCEPTION 'listing quantity is below reserved or committed stock'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER listings_reserved_quantity BEFORE UPDATE OF quantity ON app.listings
FOR EACH ROW EXECUTE FUNCTION app.protect_reserved_listing_quantity();

REVOKE ALL ON app.purchase_groups, app.orders, app.inventory_reservations,
  app.order_events, app.payment_attempts, app.payment_events
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.protect_order_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.protect_reserved_listing_quantity() FROM PUBLIC, anon, authenticated;
