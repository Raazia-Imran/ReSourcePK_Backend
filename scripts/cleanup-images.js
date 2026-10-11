const { pool } = require("../src/db");
const {
  cleanImageObjects,
} = require("../src/modules/catalog/imageCleanupService");
cleanImageObjects()
  .then((result) => {
    console.log(JSON.stringify({ event: "image_cleanup", ...result }));
    if (result.failed) process.exitCode = 1;
  })
  .catch(() => {
    console.error(
      "Image cleanup failed; check storage configuration and retry.",
    );
    process.exitCode = 1;
  })
  .finally(() => pool.end());
