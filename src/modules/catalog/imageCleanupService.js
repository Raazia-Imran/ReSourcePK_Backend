const db = require("../../db");
const repo = require("./repository");
const images = require("./imageAdapter");

async function cleanObject(runner, key) {
  if (await repo.imageIsLinked(runner, key)) {
    await repo.finishImageCleanup(key, runner);
    return "linked";
  }
  try {
    await images.remove(key);
    await repo.finishImageCleanup(key, runner);
    return "removed";
  } catch {
    await repo.retryImageCleanup(runner, key);
    return "failed";
  }
}
async function cleanImageObjects() {
  return db.transaction(async (runner) => {
    const jobs = await repo.cleanupCandidates(runner);
    // Each candidate is independently locked; provider work is bounded by
    // the repository batch size and never involves a shared object key.
    const results = await Promise.all(
      jobs.map((job) => cleanObject(runner, job.object_key)),
    );
    return {
      queued: jobs.length,
      removed: results.filter((result) => result === "removed").length,
      failed: results.filter((result) => result === "failed").length,
    };
  });
}
module.exports = { cleanImageObjects };
