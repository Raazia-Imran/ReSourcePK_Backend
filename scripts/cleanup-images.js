const { pool, transaction } = require("../src/db");
const images = require("../src/modules/catalog/imageAdapter");
async function clean() {
  return transaction(async (runner) => {
    const jobs = await runner.query(
      "SELECT object_key FROM app.image_cleanup_jobs ORDER BY created_at LIMIT 20 FOR UPDATE SKIP LOCKED",
    );
    let removed = 0;
    for (const job of jobs.rows) {
      try {
        await images.remove(job.object_key);
        await runner.query(
          "DELETE FROM app.image_cleanup_jobs WHERE object_key=$1",
          [job.object_key],
        );
        removed++;
      } catch {
        await runner.query(
          "UPDATE app.image_cleanup_jobs SET attempts=attempts+1 WHERE object_key=$1",
          [job.object_key],
        );
      }
    }
    console.log(`Removed ${removed} of ${jobs.rowCount} queued image objects`);
  });
}
clean()
  .catch(() => {
    console.error(
      "Image cleanup failed; check storage configuration and retry.",
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
