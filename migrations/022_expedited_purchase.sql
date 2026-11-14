-- Seller-configured urgent orders use a fixed higher unit price and a clear
-- fulfillment deadline. Standard and group pricing remain unchanged.
ALTER TABLE app.listings
  ADD COLUMN expedited_price_per_unit NUMERIC(14,2),
  ADD COLUMN expedited_price_per_unit_minor BIGINT
    GENERATED ALWAYS AS ((expedited_price_per_unit * 100)::bigint) STORED,
  ADD COLUMN expedited_lead_time_days INTEGER,
  ADD CONSTRAINT listings_expedited_price_positive
    CHECK (expedited_price_per_unit IS NULL OR expedited_price_per_unit > price_per_unit),
  ADD CONSTRAINT listings_expedited_config_pair
    CHECK (
      (expedited_price_per_unit IS NULL AND expedited_lead_time_days IS NULL)
      OR
      (expedited_price_per_unit IS NOT NULL AND expedited_lead_time_days IS NOT NULL
        AND expedited_lead_time_days BETWEEN 1 AND 30)
    );

ALTER TABLE app.orders
  ADD COLUMN fulfilment_priority TEXT NOT NULL DEFAULT 'standard'
    CHECK (fulfilment_priority IN ('standard', 'expedited')),
  ADD COLUMN fulfilment_lead_time_days INTEGER,
  ADD COLUMN fulfilment_due_at TIMESTAMPTZ,
  ADD CONSTRAINT orders_expedited_snapshot_consistency CHECK (
    (fulfilment_priority = 'standard' AND fulfilment_lead_time_days IS NULL)
    OR
    (fulfilment_priority = 'expedited' AND group_id IS NULL
      AND fulfilment_lead_time_days IS NOT NULL
      AND fulfilment_lead_time_days BETWEEN 1 AND 30)
  );

CREATE INDEX orders_fulfilment_due_idx
  ON app.orders(fulfilment_due_at) WHERE fulfilment_due_at IS NOT NULL;

CREATE OR REPLACE FUNCTION app.protect_order_snapshot() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF ROW(NEW.buyer_id, NEW.listing_id, NEW.organization_id, NEW.group_id,
         NEW.quantity, NEW.unit, NEW.currency, NEW.listing_version,
         NEW.price_tier_min_quantity, NEW.unit_price_minor, NEW.total_minor,
         NEW.fulfilment_priority, NEW.fulfilment_lead_time_days)
     IS DISTINCT FROM
     ROW(OLD.buyer_id, OLD.listing_id, OLD.organization_id, OLD.group_id,
         OLD.quantity, OLD.unit, OLD.currency, OLD.listing_version,
         OLD.price_tier_min_quantity, OLD.unit_price_minor, OLD.total_minor,
         OLD.fulfilment_priority, OLD.fulfilment_lead_time_days) THEN
    RAISE EXCEPTION 'order terms are immutable' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION app.protect_order_snapshot() FROM PUBLIC,anon,authenticated;
