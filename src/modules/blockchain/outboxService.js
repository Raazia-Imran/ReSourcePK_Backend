/**
 * Adds a passport anchoring job to the outbox.
 *
 * This function must receive the existing database transaction client.
 * The blockchain anchor and outbox job will therefore be committed
 * or rolled back together with the passport snapshot.
 */

async function enqueuePassportAnchor(tx, passportSnapshot) {
  if (!tx || typeof tx.query !== "function") {
    throw new TypeError("A valid transaction client is required");
  }

  if (
    !passportSnapshot ||
    !passportSnapshot.id ||
    !passportSnapshot.passport_hash
  ) {
    throw new TypeError("A valid passport snapshot is required");
  }

  // Create a tracking record for this passport's blockchain anchor.
  const anchorResult = await tx.query(
    `INSERT INTO app.blockchain_anchors (
       passport_snapshot_id,
       status
     )
     VALUES ($1, 'pending')
     ON CONFLICT (passport_snapshot_id) DO NOTHING
     RETURNING id`,
    [passportSnapshot.id],
  );

  // A new passport snapshot should have a new anchor record.
  // If one already exists, do not create another outbox job.
  if (anchorResult.rows.length === 0) {
    return {
      enqueued: false,
      reason: "anchor_already_exists",
    };
  }

  // Create the background job.
  // Only the snapshot ID and hash are needed by the worker.
  await tx.query(
    `INSERT INTO app.outbox (
       type,
       payload
     )
     VALUES ($1, $2)`,
    [
      "passport.anchor",
      {
        passportSnapshotId: passportSnapshot.id,
        passportHash: passportSnapshot.passport_hash,
      },
    ],
  );

  return {
    enqueued: true,
    anchorId: anchorResult.rows[0].id,
  };
}

module.exports = {
  enqueuePassportAnchor,
};
