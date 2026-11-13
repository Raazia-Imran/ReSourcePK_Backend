
-- Migration 019: Blockchain outbox and anchor tracking.
--
-- Recovery: If this migration fails, restore the test database
-- to its pre-migration backup before retrying.
-- For reversal, create a separate compensating migration.

-- =====================================================
-- 1. OUTBOX TABLE
-- =====================================================

CREATE TABLE app.outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    type TEXT NOT NULL,

    payload JSONB NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),

    attempts INTEGER NOT NULL DEFAULT 0
        CHECK (attempts >= 0),

    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    last_error TEXT,

    -- Allows recovery if a worker crashes while processing a job.
    locked_until TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for finding jobs waiting to be processed.
CREATE INDEX outbox_pending_jobs_idx
ON app.outbox (next_attempt_at)
WHERE status = 'pending';

-- Index for recovering jobs whose worker lease expired.
CREATE INDEX outbox_expired_locks_idx
ON app.outbox (locked_until)
WHERE status = 'processing';


-- =====================================================
-- 2. BLOCKCHAIN ANCHORS TABLE
-- =====================================================

CREATE TABLE app.blockchain_anchors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    passport_snapshot_id UUID NOT NULL
        REFERENCES app.passport_snapshots(id) ON DELETE RESTRICT,

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'anchored', 'failed')),

    tx_hash TEXT,

    network TEXT NOT NULL DEFAULT 'Polygon Amoy (testnet)',

    attempts INTEGER NOT NULL DEFAULT 0
        CHECK (attempts >= 0),

    last_error TEXT,

    anchored_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT blockchain_anchors_snapshot_unique
        UNIQUE (passport_snapshot_id)
);

-- Index for looking up anchors by status.
CREATE INDEX blockchain_anchors_status_idx
ON app.blockchain_anchors (status);
