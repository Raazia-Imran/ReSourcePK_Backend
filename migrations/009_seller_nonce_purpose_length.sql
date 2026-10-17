-- `seller_login` is longer than the original `login`/`link` purpose values.
ALTER TABLE app.google_auth_nonces
  ALTER COLUMN purpose TYPE VARCHAR(16);
