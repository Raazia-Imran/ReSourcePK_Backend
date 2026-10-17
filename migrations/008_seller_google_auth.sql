-- Keep the Google identity tied to the sign-in entry flow selected at signup.
-- Existing Google identities remain Buyer identities for backwards compatibility.
ALTER TABLE app.google_identities
  ADD COLUMN account_type VARCHAR(8) NOT NULL DEFAULT 'buyer'
    CHECK (account_type IN ('buyer', 'seller'));

ALTER TABLE app.google_auth_nonces
  DROP CONSTRAINT google_auth_nonce_purpose_user_check,
  ADD CONSTRAINT google_auth_nonce_purpose_user_check CHECK (
    (purpose IN ('login', 'seller_login') AND user_id IS NULL) OR
    (purpose = 'link' AND user_id IS NOT NULL)
  );

ALTER TABLE app.google_auth_nonces
  ALTER COLUMN purpose TYPE VARCHAR(16);

ALTER TABLE app.google_auth_nonces
  DROP CONSTRAINT google_auth_nonces_purpose_check;

ALTER TABLE app.google_auth_nonces
  ADD CONSTRAINT google_auth_nonces_purpose_check
    CHECK (purpose IN ('login', 'seller_login', 'link'));
