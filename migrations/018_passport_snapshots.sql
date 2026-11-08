-- Recovery: If this migration fails, restore the test database
-- to its pre-migration backup before retrying.
-- For reversal, create a separate compensating migration.

CREATE TABLE app.passport_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL
    REFERENCES app.orders(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  canonical_json TEXT NOT NULL,
  snapshot_data JSONB NOT NULL,
  passport_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT passport_snapshots_order_version_unique
    UNIQUE (order_id, version)
);

-- Protect immutable passport data while allowing status updates.
CREATE FUNCTION app.protect_passport_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'passport snapshots cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.canonical_json IS DISTINCT FROM OLD.canonical_json
     OR NEW.snapshot_data IS DISTINCT FROM OLD.snapshot_data
     OR NEW.passport_hash IS DISTINCT FROM OLD.passport_hash
     OR NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'passport snapshot data is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER passport_snapshots_immutable
BEFORE UPDATE OR DELETE ON app.passport_snapshots
FOR EACH ROW
EXECUTE FUNCTION app.protect_passport_snapshot();