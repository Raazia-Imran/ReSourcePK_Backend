-- Corrections use compensating events so recorded history remains intact.
CREATE FUNCTION app.protect_impact_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'impact events are append-only';
END;
$$;
CREATE TRIGGER impact_events_no_mutation BEFORE UPDATE OR DELETE ON app.impact_events
FOR EACH ROW EXECUTE FUNCTION app.protect_impact_event();
CREATE UNIQUE INDEX impact_events_one_reversal_per_order_idx
ON app.impact_events(order_id) WHERE impact_entry_type='reversal';
REVOKE ALL ON app.impact_events FROM PUBLIC, anon, authenticated;
