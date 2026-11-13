-- These trigger functions inspect NEW/OLD records without querying app tables.
-- Pin their search path so callers cannot change name resolution.
ALTER FUNCTION app.protect_passport_snapshot() SET search_path = '';
ALTER FUNCTION app.protect_impact_event() SET search_path = '';
