ALTER TABLE app.listings
  ADD COLUMN color VARCHAR(80) NOT NULL DEFAULT '',
  ADD COLUMN composition VARCHAR(200) NOT NULL DEFAULT '',
  ADD COLUMN location VARCHAR(180) NOT NULL DEFAULT '',
  ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN review_reason VARCHAR(1000),
  ADD COLUMN price_per_unit_minor BIGINT GENERATED ALWAYS AS ((price_per_unit * 100)::bigint) STORED;
CREATE INDEX listings_material_unit_price_idx ON app.listings(lower(material),unit,price_per_unit_minor,id) WHERE status='published';
CREATE INDEX listings_public_price_idx ON app.listings(price_per_unit_minor,id DESC) WHERE status='published';
CREATE INDEX listings_created_by_idx ON app.listings(created_by);

CREATE TABLE app.listing_price_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES app.listings(id) ON DELETE CASCADE,
  min_quantity NUMERIC(14,3) NOT NULL CHECK (min_quantity > 0),
  price_per_unit_minor BIGINT NOT NULL CHECK (price_per_unit_minor > 0 AND price_per_unit_minor <= 10000000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(listing_id,min_quantity)
);
CREATE TABLE app.listing_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES app.listings(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  alt_text VARCHAR(200) NOT NULL CHECK (length(trim(alt_text)) > 0),
  content_type TEXT NOT NULL CHECK (content_type='image/webp'),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 1600),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 1600),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX listing_images_listing_idx ON app.listing_images(listing_id,created_at,id);
CREATE TABLE app.image_cleanup_jobs (
  object_key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);
ALTER TABLE app.buyer_requirements DROP CONSTRAINT buyer_requirements_status_check;
ALTER TABLE app.buyer_requirements
  ADD CONSTRAINT buyer_requirements_status_check CHECK (status IN ('active','paused','closed')),
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN max_price_per_unit_minor BIGINT GENERATED ALWAYS AS ((max_price_per_unit * 100)::bigint) STORED;
CREATE INDEX buyer_requirements_active_idx ON app.buyer_requirements(buyer_id,status,created_at DESC);

CREATE FUNCTION app.bump_catalog_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.version = OLD.version + 1;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER listings_version BEFORE UPDATE ON app.listings
FOR EACH ROW EXECUTE FUNCTION app.bump_catalog_version();
CREATE TRIGGER buyer_requirements_version BEFORE UPDATE ON app.buyer_requirements
FOR EACH ROW EXECUTE FUNCTION app.bump_catalog_version();
REVOKE ALL ON FUNCTION app.bump_catalog_version() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON app.listing_price_tiers,app.listing_images FROM PUBLIC,anon,authenticated;
REVOKE ALL ON app.image_cleanup_jobs FROM PUBLIC,anon,authenticated;
CREATE TABLE app.demo_seed_records (
  seed_key VARCHAR(100) PRIMARY KEY,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('user','organization','listing')),
  record_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
REVOKE ALL ON app.demo_seed_records FROM PUBLIC,anon,authenticated;
