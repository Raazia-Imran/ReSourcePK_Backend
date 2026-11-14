-- New purchase flows use 48-hour response/payment windows. Existing orders
-- keep their already-issued 72-hour payment deadlines.
ALTER TABLE app.orders
  DROP CONSTRAINT orders_payment_due_after_confirmation,
  ADD CONSTRAINT orders_payment_due_after_confirmation CHECK (
    payment_due_at IS NULL
    OR payment_due_at = seller_confirmed_at + INTERVAL '48 hours'
    OR payment_due_at = seller_confirmed_at + INTERVAL '72 hours'
  );
