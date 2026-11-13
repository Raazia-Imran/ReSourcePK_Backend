const { query, transaction } = require("../../db");
const { AppError } = require("../../lib/errors");
const { hashPassport } = require("./canonical");
const { generatePassportKey } = require("../blockchain/keyGenerator");
const { PolygonAmoyAdapter } = require("../blockchain/polygonAmoyAdapter");
const { env } = require("../../config/env");
const {
  requirePlatformAdmin,
} = require("../../services/platformAccessService");

function createReadAdapter() {
  if (!env.AMOY_RPC_URL || !env.PASSPORT_CONTRACT_ADDRESS) {
    return null;
  }

  return new PolygonAmoyAdapter({
    rpcUrl: env.AMOY_RPC_URL,
    contractAddress: env.PASSPORT_CONTRACT_ADDRESS,
  });
}

function createVerificationService({
  queryFn = query,
  transactionFn = transaction,
  adapter = createReadAdapter(),
} = {}) {
  async function getPublicVerification(passportId) {
    const result = await queryFn(
      `SELECT
         s.id,
         s.version,
         s.canonical_json,
         s.passport_hash,
         s.snapshot_data,
         a.status,
         a.network,
         a.tx_hash,
         a.anchored_at
       FROM app.passport_snapshots s
       LEFT JOIN app.blockchain_anchors a
         ON a.passport_snapshot_id = s.id
       WHERE s.id = $1`,
      [passportId],
    );

    if (result.rows.length === 0) {
      throw new AppError(404, "PASSPORT_NOT_FOUND", "Passport not found");
    }

    const snapshot = result.rows[0];
    const status = snapshot.status || "pending";

    // Recompute the hash from the immutable canonical JSON.
    const computedHash = hashPassport(snapshot.canonical_json);

    if (!/^[0-9a-f]{64}$/i.test(computedHash)) {
      throw new AppError(
        500,
        "INVALID_PASSPORT_HASH",
        "Passport snapshot hash is invalid",
      );
    }

    let matches = null;

    if (status === "anchored") {
      if (!adapter || typeof adapter.get !== "function") {
        throw new AppError(
          503,
          "BLOCKCHAIN_READ_UNAVAILABLE",
          "Passport blockchain verification is temporarily unavailable",
        );
      }

      try {
        const passportKey = generatePassportKey(
          snapshot.snapshot_data.passportId,
          snapshot.snapshot_data.version,
        );

        const chainHash = await adapter.get(passportKey);

        if (
          typeof chainHash !== "string" ||
          !/^0x[0-9a-fA-F]{64}$/.test(chainHash)
        ) {
          throw new Error("Invalid blockchain hash");
        }

        // Check both database integrity and the actual on-chain value.
        matches =
          computedHash.toLowerCase() ===
            snapshot.passport_hash.trim().toLowerCase() &&
          chainHash.toLowerCase() === `0x${computedHash}`.toLowerCase();
      } catch (error) {
        if (error instanceof AppError) throw error;

        throw new AppError(
          503,
          "BLOCKCHAIN_READ_FAILED",
          "Could not verify the passport against the blockchain",
        );
      }
    }

    // Explicit allowlist: never return snapshot_data or canonical_json.
    return {
      passportId: snapshot.id,
      version: snapshot.version,
      status,
      network: snapshot.network || "Polygon Amoy (testnet)",
      transactionId: snapshot.tx_hash,
      anchoredAt: snapshot.anchored_at,
      snapshotHash: computedHash,
      matches,
    };
  }

  async function retryPassportAnchor(passportId, userId, reason, ipAddress) {
    return transactionFn(async (tx) => {
      // Authorization is checked before revealing whether the passport exists.
      await requirePlatformAdmin(userId, tx);

      const snapshotResult = await tx.query(
        `SELECT id
         FROM app.passport_snapshots
         WHERE id = $1
         FOR UPDATE`,
        [passportId],
      );

      if (snapshotResult.rows.length === 0) {
        throw new AppError(404, "PASSPORT_NOT_FOUND", "Passport not found");
      }

      const anchorResult = await tx.query(
        `SELECT status
         FROM app.blockchain_anchors
         WHERE passport_snapshot_id = $1
         FOR UPDATE`,
        [passportId],
      );

      if (anchorResult.rows.length === 0) {
        throw new AppError(
          404,
          "PASSPORT_ANCHOR_NOT_FOUND",
          "Passport anchor not found",
        );
      }

      if (anchorResult.rows[0].status !== "failed") {
        throw new AppError(
          409,
          "PASSPORT_NOT_FAILED",
          "Only failed passport anchors can be retried",
        );
      }

      const jobResult = await tx.query(
        `SELECT id, status
         FROM app.outbox
         WHERE type = 'passport.anchor'
           AND payload->>'passportSnapshotId' = $1
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [passportId],
      );

      if (
        jobResult.rows.length === 0 ||
        jobResult.rows[0].status !== "failed"
      ) {
        throw new AppError(
          409,
          "FAILED_ANCHOR_JOB_NOT_FOUND",
          "The failed anchoring job could not be found",
        );
      }

      const jobId = jobResult.rows[0].id;

      await tx.query(
        `UPDATE app.blockchain_anchors
         SET
           status = 'pending',
           attempts = 0,
           last_error = NULL
         WHERE passport_snapshot_id = $1`,
        [passportId],
      );

      await tx.query(
        `UPDATE app.outbox
         SET
           status = 'pending',
           attempts = 0,
           next_attempt_at = now(),
           locked_until = NULL,
           last_error = NULL,
           updated_at = now()
         WHERE id = $1`,
        [jobId],
      );

      await tx.query(
        `INSERT INTO app.audit_events (
           actor_id,
           action,
           resource_type,
           resource_id,
           reason,
           metadata,
           ip_address
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          userId,
          "passport.anchor_retry_requested",
          "passport_snapshot",
          passportId,
          reason,
          {
            previousStatus: "failed",
            newStatus: "pending",
            outboxJobId: jobId,
          },
          ipAddress || null,
        ],
      );

      return {
        passportId,
        status: "pending",
      };
    });
  }

  return {
    getPublicVerification,
    retryPassportAnchor,
  };
}

module.exports = {
  ...createVerificationService(),
  createVerificationService,
};
