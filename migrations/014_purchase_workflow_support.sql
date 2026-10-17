-- Phase 3, Chunk 2: support idempotent group creation and direct-order timeout.
ALTER TABLE app.purchase_groups ADD COLUMN request_key UUID;
CREATE UNIQUE INDEX purchase_groups_request_key_idx
  ON app.purchase_groups(organization_id, request_key)
  WHERE request_key IS NOT NULL;
CREATE UNIQUE INDEX purchase_group_one_active_share_per_buyer_idx
  ON app.orders(group_id, buyer_id)
  WHERE group_id IS NOT NULL AND status IN ('group_open', 'pending_payment', 'paid');

ALTER TABLE app.orders DROP CONSTRAINT orders_status_check;
ALTER TABLE app.orders ADD CONSTRAINT orders_status_check CHECK (status IN (
  'group_open', 'pending_seller_confirmation', 'pending_payment',
  'paid', 'rejected', 'seller_expired', 'payment_expired',
  'withdrawn', 'group_expired'
));

ALTER TABLE app.organization_membership_permissions
  DROP CONSTRAINT organization_membership_permissions_permission_check;
ALTER TABLE app.organization_membership_permissions
  ADD CONSTRAINT organization_membership_permissions_permission_check
  CHECK (permission IN ('listings.view', 'listings.manage', 'orders.confirm'));

CREATE FUNCTION app.guard_order_confirmation_grant() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.permission = 'orders.confirm' AND NOT EXISTS (
    SELECT 1 FROM app.organization_memberships m
    WHERE m.id=NEW.membership_id AND m.role='manager'
  ) THEN
    RAISE EXCEPTION 'orders.confirm may only be granted to Managers'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organization_manager_order_permission
BEFORE INSERT OR UPDATE OF permission, membership_id
ON app.organization_membership_permissions
FOR EACH ROW EXECUTE FUNCTION app.guard_order_confirmation_grant();
REVOKE ALL ON FUNCTION app.guard_order_confirmation_grant() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION app.clear_order_grant_on_role_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.role <> 'manager' THEN
    DELETE FROM app.organization_membership_permissions
    WHERE membership_id=NEW.id AND permission='orders.confirm';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER organization_membership_role_order_permission
AFTER UPDATE OF role ON app.organization_memberships
FOR EACH ROW EXECUTE FUNCTION app.clear_order_grant_on_role_change();
REVOKE ALL ON FUNCTION app.clear_order_grant_on_role_change() FROM PUBLIC, anon, authenticated;
