-- RapidGateway hosted checkout references and persisted redirect URLs.
ALTER TABLE app.payment_attempts
  ADD COLUMN checkout_url TEXT;

ALTER TABLE app.payment_attempts
  DROP CONSTRAINT payment_attempts_method_check,
  ADD CONSTRAINT payment_attempts_method_check
    CHECK (method IN ('jazzcash', 'easypaisa', 'raast', 'card', 'bank_transfer', 'hosted_checkout'));
