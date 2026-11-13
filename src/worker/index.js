const crypto = require("node:crypto");
const { pool, transaction } = require("../db");
const { env } = require("../config/env");
const { createWorkerService } = require("../modules/blockchain/workerService");
const {
  PolygonAmoyAdapter,
} = require("../modules/blockchain/polygonAmoyAdapter");

function log(level, event, details = {}) {
  console.log(
    JSON.stringify({
      level,
      event,
      correlationId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const requiredSettings = [
    env.AMOY_RPC_URL,
    env.ANCHOR_PRIVATE_KEY,
    env.PASSPORT_CONTRACT_ADDRESS,
  ];

  if (requiredSettings.some((value) => !value)) {
    throw new Error("Polygon Amoy worker configuration is incomplete");
  }

  const adapter = new PolygonAmoyAdapter({
    rpcUrl: env.AMOY_RPC_URL,
    privateKey: env.ANCHOR_PRIVATE_KEY,
    contractAddress: env.PASSPORT_CONTRACT_ADDRESS,
  });

  const worker = createWorkerService(transaction, adapter, 5);
  let stopping = false;

  async function run() {
    log("info", "blockchain_worker_started");

    while (true) {
      if (stopping) break;
      try {
        const result = await worker.processNextJob();

        if (result) {
          log("info", "blockchain_job_processed", {
            jobId: result.jobId,
            status: result.status,
          });
        } else {
          await sleep(5000);
        }
      } catch (error) {
        log("error", "blockchain_worker_error", {
          errorName: error.name || "Error",
        });
        await sleep(5000);
      }
    }

    log("info", "blockchain_worker_stopped");
  }

  const loopPromise = run();

  async function shutdown(signal) {
    if (stopping) return;

    stopping = true;
    log("info", "blockchain_worker_shutdown_requested", { signal });

    await loopPromise;
    await pool.end();
  }

  process.once("SIGINT", () => {
    shutdown("SIGINT").catch(() => {
      process.exitCode = 1;
    });
  });

  process.once("SIGTERM", () => {
    shutdown("SIGTERM").catch(() => {
      process.exitCode = 1;
    });
  });

  await loopPromise;
}

main().catch(async (error) => {
  log("error", "blockchain_worker_startup_failed", {
    errorName: error.name || "Error",
  });

  await pool.end();
  process.exitCode = 1;
});
