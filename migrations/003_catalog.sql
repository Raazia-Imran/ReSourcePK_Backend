CREATE TABLE app.listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES app.organizations(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  title VARCHAR(160) NOT NULL CHECK (length(trim(title)) >= 3),
  description TEXT NOT NULL CHECK (length(trim(description)) >= 20),
  material VARCHAR(80) NOT NULL CHECK (length(trim(material)) >= 2),
  condition VARCHAR(80) NOT NULL CHECK (length(trim(condition)) >= 2),
  unit VARCHAR(16) NOT NULL CHECK (unit IN ('kg', 'meter', 'roll', 'piece')),
  quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
  min_order_quantity NUMERIC(14,3) NOT NULL CHECK (min_order_quantity > 0 AND min_order_quantity <= quantity),
  price_per_unit NUMERIC(14,2) NOT NULL CHECK (price_per_unit > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','published','rejected','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX listings_org_status_idx ON app.listings(organization_id,status,created_at DESC);
CREATE INDEX listings_public_idx ON app.listings(created_at DESC,id DESC) WHERE status='published';
CREATE INDEX listings_search_idx ON app.listings USING gin(to_tsvector('simple',title || ' ' || description || ' ' || material));

CREATE TABLE app.buyer_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id UUID NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  material VARCHAR(80) NOT NULL CHECK (length(trim(material)) >= 2),
  min_quantity NUMERIC(14,3) NOT NULL CHECK (min_quantity > 0),
  unit VARCHAR(16) NOT NULL CHECK (unit IN ('kg','meter','roll','piece')),
  max_price_per_unit NUMERIC(14,2) CHECK (max_price_per_unit > 0),
  notes VARCHAR(1000),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX buyer_requirements_buyer_idx ON app.buyer_requirements(buyer_id,created_at DESC);

CREATE TABLE app.listing_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES app.organizations(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES app.users(id) ON DELETE RESTRICT,
  request_key UUID NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  listing_count INTEGER NOT NULL CHECK (listing_count BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id,request_key)
);

REVOKE ALL ON app.listings,app.buyer_requirements,app.listing_import_batches FROM PUBLIC,anon,authenticated;
