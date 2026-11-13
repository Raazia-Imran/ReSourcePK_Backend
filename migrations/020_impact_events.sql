-- Append-only impact events for completed orders and their reversals.
CREATE TABLE app.impact_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES app.orders(id) ON DELETE RESTRICT,
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL CHECK (unit IN ('kg', 'meter', 'roll', 'piece')),
  impact_entry_type TEXT NOT NULL
    CHECK (impact_entry_type IN ('diversion', 'reversal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX impact_events_order_id_idx
  ON app.impact_events(order_id);

-- An order can receive only one original diversion event.
CREATE UNIQUE INDEX impact_events_one_diversion_per_order_idx
  ON app.impact_events(order_id)
  WHERE impact_entry_type = 'diversion';
