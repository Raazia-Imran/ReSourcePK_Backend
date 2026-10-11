-- Advisor review found the original import batch actor FK had no index.
CREATE INDEX listing_import_batches_created_by_idx ON app.listing_import_batches(created_by);
