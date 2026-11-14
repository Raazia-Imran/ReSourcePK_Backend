-- Buyer-created pooling: one total target plus a small set of allowed share
-- sizes. Existing Seller-created groups remain readable without share options.
ALTER TABLE app.purchase_groups
  ADD COLUMN extension_count SMALLINT NOT NULL DEFAULT 0
    CHECK (extension_count BETWEEN 0 AND 1),
  ADD COLUMN choice_deadline_at TIMESTAMPTZ,
  ADD COLUMN seller_response_due_at TIMESTAMPTZ;

ALTER TABLE app.purchase_groups DROP CONSTRAINT purchase_groups_status_check;
ALTER TABLE app.purchase_groups ADD CONSTRAINT purchase_groups_status_check
  CHECK (status IN (
    'open', 'ready_for_confirmation', 'deadline_choices', 'payment_open',
    'reconfirmation_required', 'paid', 'expired', 'rejected'
  ));

CREATE TABLE app.purchase_group_share_options (
  group_id UUID NOT NULL REFERENCES app.purchase_groups(id) ON DELETE CASCADE,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, quantity)
);
CREATE INDEX purchase_group_share_options_group_idx
  ON app.purchase_group_share_options(group_id, quantity);
REVOKE ALL ON app.purchase_group_share_options FROM PUBLIC,anon,authenticated;

ALTER TABLE app.listings
  ADD COLUMN expedited_min_order_quantity NUMERIC(14,3),
  ADD CONSTRAINT listings_expedited_min_quantity_valid CHECK (
    expedited_min_order_quantity IS NULL
    OR (expedited_price_per_unit IS NOT NULL
      AND expedited_min_order_quantity > 0
      AND expedited_min_order_quantity <= quantity)
  );

ALTER TABLE app.inventory_reservations
  DROP CONSTRAINT inventory_reservations_release_reason_check,
  ADD CONSTRAINT inventory_reservations_release_reason_check CHECK (
    release_reason IN (
      'seller_rejected', 'seller_timeout', 'buyer_withdrew', 'group_expired',
      'payment_timeout', 'order_cancelled', 'buyer_switched_to_direct'
    )
  );
