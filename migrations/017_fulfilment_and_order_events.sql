-- Recovery: If this migration fails, restore the test database to its pre-migration backup before retrying.
-- For an intentional reversal, create and review a separate compensating migration; do not edit applied migrations or patch the schema manually.

ALTER TABLE app.orders
  ADD COLUMN completed_at TIMESTAMPTZ,
  ADD COLUMN fulfilment_status TEXT,
  ADD CONSTRAINT orders_fulfilment_status_check CHECK (
    fulfilment_status IS NULL OR fulfilment_status IN (
      'pending_payment',
      'paid',
      'processing',
      'ready',
      'dispatched',
      'delivered',
      'completed',
      'cancelled',
      'refunded',
      'disputed'
    )
  );


CREATE TABLE app.shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES app.orders(id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  dispatched_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  tracking_id TEXT
);

CREATE TABLE app.disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  raised_by UUID NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  resolved_by UUID REFERENCES app.users(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- order_events already has an order_id index from migration 013.
-- shipments.order_id is indexed by its UNIQUE constraint.
CREATE INDEX disputes_order_id_idx ON app.disputes(order_id);