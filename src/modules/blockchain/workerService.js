const { transaction } = require("../../db");
const { generatePassportKey } = require("./keyGenerator");
const { ZERO_HASH } = require("./fakeAdapter");

/**
 * Creates the worker service.
 *
 * The transaction function can be injected for testing.
 * The application uses the real database transaction by default.
 */
function createWorkerService(
    transactionFn = transaction,
    adapter = null,
    maxAttempts = 5,
) {
  /**
   * Claims one available blockchain job from the outbox.
   *
   * FOR UPDATE SKIP LOCKED prevents multiple workers
   * from claiming the same job simultaneously.
   */
  async function claimNextJob() {
    return transactionFn(async (tx) => {
        // Mark expired jobs as failed if they already exhausted all attempts.
        await tx.query(
            `WITH exhausted AS (
            UPDATE app.outbox
            SET
            status = 'failed',
            locked_until = NULL,
            last_error = COALESCE(
            last_error,
            'Worker lease expired after maximum attempts'
            ),
            updated_at = now()
            WHERE
            status = 'processing'
            AND attempts >= $1
            AND (locked_until IS NULL OR locked_until <= now())
            RETURNING payload, attempts, last_error
            )
            UPDATE app.blockchain_anchors AS a
            SET
            status = 'failed',
            attempts = exhausted.attempts,
            last_error = exhausted.last_error
            FROM exhausted
            WHERE a.passport_snapshot_id::text =
            exhausted.payload->>'passportSnapshotId'`,
            [maxAttempts],
        );


        const result = await tx.query(
        `WITH candidate AS (
        SELECT id
        FROM app.outbox
        WHERE
        attempts < $1
        AND (
        (
        status = 'pending'
        AND next_attempt_at <= now()
        )
        OR
        (
        status = 'processing'
        AND (
        locked_until IS NULL
        OR locked_until <= now()
        )
        )
        )
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
        )
        UPDATE app.outbox AS o
        SET
        status = 'processing',
        attempts = o.attempts + 1,
        locked_until = now() + interval '5 minutes',
        updated_at = now()
        FROM candidate
        WHERE o.id = candidate.id
        RETURNING o.*`,
        [maxAttempts],
    );

      if (result.rows.length === 0) {
        return null;
      }

      return result.rows[0];
    });
  }


    /**
   * Retrieves the passport snapshot associated with an outbox job.
   */
  async function getPassportSnapshot(snapshotId) {
    return transactionFn(async (tx) => {
        const result = await tx.query(
            `SELECT
            id,
            version,
            snapshot_data,
            passport_hash
            FROM app.passport_snapshots
            WHERE id = $1`,
            [snapshotId],
        );

      if (result.rows.length === 0) {
        throw new Error(
          `Passport snapshot not found: ${snapshotId}`,
        );
      }

      return result.rows[0];
    });
   }

     /**
   * Marks the passport anchor and outbox job as completed.
   */
    async function markJobCompleted(job, snapshotId, txHash) {
        return transactionFn(async (tx) => {
            await tx.query(
                `UPDATE app.blockchain_anchors
                SET
                status = 'anchored',
                tx_hash = COALESCE($2, tx_hash),
                attempts = $3,
                last_error = NULL,
                anchored_at = now()
                WHERE passport_snapshot_id = $1`,
                [snapshotId, txHash, job.attempts],
            );
            await tx.query(
                `UPDATE app.outbox
                SET
                status = 'completed',
                locked_until = NULL,
                last_error = NULL,
                updated_at = now()
                WHERE id = $1`,
                [job.id],
            );
        });
    }


    /***
     * * Records a failed attempt and schedules a retry if attempts remain.
     * */
    async function markJobFailed(job, snapshotId, error) {
        const errorMessage = String(error.message || error).slice(0, 2000);
        const exhausted = job.attempts >= maxAttempts;

        // Exponential backoff: 30s, 60s, 120s, 240s...
        const retryDelaySeconds = 30 * (2 ** (job.attempts - 1));

        return transactionFn(async (tx) => {
            await tx.query(
                `UPDATE app.blockchain_anchors
                SET
                status = $2,
                attempts = $3,
                last_error = $4
                WHERE passport_snapshot_id = $1`,
                [
                    snapshotId,
                    exhausted ? "failed" : "pending",
                    job.attempts,
                    errorMessage,
                ],
            );

            await tx.query(
                `UPDATE app.outbox
                SET
                status = $2,
                next_attempt_at = CASE
                WHEN $2 = 'pending'
                THEN now() + ($3 * interval '1 second')
                ELSE next_attempt_at
                END,
                locked_until = NULL,
                last_error = $4,
                updated_at = now()
                WHERE id = $1`,
                [
                    job.id,
                    exhausted ? "failed" : "pending",
                    retryDelaySeconds,
                    errorMessage,
                ],
            );
        });
    }

      /**
   * Processes one blockchain job from the outbox.
   */
    async function processNextJob() {
        if (
            !adapter ||
            typeof adapter.get !== "function" ||
            typeof adapter.anchor !== "function"
        ) {
            throw new Error("A valid blockchain adapter is required");
        }

        const job = await claimNextJob();
        if (!job) {
            return null;
        }

        const snapshotId = job.payload?.passportSnapshotId;

        try {
            if (job.type !== "passport.anchor") {
                throw new Error(`Unsupported outbox job type: ${job.type}`);
            }

            if (!snapshotId) {
                throw new Error("Passport snapshot ID is missing from job payload");
            }

            // Retrieve the original passport snapshot.
            const snapshot = await getPassportSnapshot(snapshotId);

            // Verify that the queued hash matches the stored snapshot hash.
            if (job.payload.passportHash !== snapshot.passport_hash) {
                throw new Error("Passport hash does not match the stored snapshot");
            }

            if (!/^[0-9a-f]{64}$/i.test(snapshot.passport_hash)) {
                throw new Error("Invalid passport hash format");
            }

            const passportId = snapshot.snapshot_data.passportId;
            const version = snapshot.snapshot_data.version;

            // Generate the blockchain key.
            const key = generatePassportKey(passportId, version);

            // Convert the stored SHA-256 hash into bytes32 format.
            const hash = `0x${snapshot.passport_hash}`;

            // Check the blockchain before attempting a new write.
            const existingHash = await adapter.get(key);

            if (
                typeof existingHash !== "string" ||
                !/^0x[0-9a-fA-F]{64}$/.test(existingHash)
            ) {
                throw new Error("Blockchain adapter returned an invalid hash");
            }

            let txHash = null;

            if (existingHash.toLowerCase() !== ZERO_HASH.toLowerCase()) {
                if (existingHash.toLowerCase() !== hash.toLowerCase()) {
                    throw new Error(
                        "Blockchain key already contains a different passport hash",
                    );
                }

                // The correct hash already exists. Do not write again.
                } else {
                    txHash = await adapter.anchor(key, hash);
                }

                await markJobCompleted(job, snapshotId, txHash);

                return {
                    jobId: job.id,
                    status: "completed",
                    txHash,
                };
            } catch (error) {
            await markJobFailed(job, snapshotId, error);
            return {
                jobId: job.id,
                status: job.attempts >= maxAttempts ? "failed" : "retrying",
                error: String(error.message || error).slice(0, 2000),
            };
        }
    }

  return {
    claimNextJob,
    getPassportSnapshot,
    markJobCompleted,
    markJobFailed,
    processNextJob,
  };
}

// Default service used by the actual application.
const { claimNextJob } = createWorkerService();

module.exports = {
  createWorkerService,
  claimNextJob,
};
