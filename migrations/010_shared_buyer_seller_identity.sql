-- Buyer and Seller are separate application contexts on the same person/user.
-- Approval adds seller organization membership without removing Buyer access.
ALTER TABLE app.google_identities
  DROP COLUMN account_type;
