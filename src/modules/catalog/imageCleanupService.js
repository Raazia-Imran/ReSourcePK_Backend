const db = require("../../db");
const repo = require("./repository");
const images = require("./imageAdapter");

async function cleanImageObjects() {
  return db.transaction(async (runner) => {
    const jobs = await repo.cleanupCandidates(runner);
    let removed = 0;
    let failed = 0;
    for (const job of jobs) {
      if (await repo.imageIsLinked(runner, job.object_key)) {
        await repo.finishImageCleanup(job.object_key, runner);
        continue;
      }
      try {
        await images.remove(job.object_key);
        await repo.finishImageCleanup(job.object_key, runner);
        removed++;
      } catch {
        await repo.retryImageCleanup(runner, job.object_key);
        failed++;
      }
    }
    return { queued: jobs.length, removed, failed };
  });
}
module.exports = { cleanImageObjects };
