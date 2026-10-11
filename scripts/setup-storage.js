const { createClient } = require("@supabase/supabase-js");
const { env } = require("../src/config/env");
async function setup() {
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !env.LISTING_IMAGE_BUCKET
  )
    throw new Error("Configure the three storage environment variables first");
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const existing = await client.storage.getBucket(env.LISTING_IMAGE_BUCKET);
  if (existing.error) {
    if (String(existing.error.statusCode) !== "404")
      throw new Error(
        "Could not inspect the image bucket; check credentials and project status",
      );
    const result = await client.storage.createBucket(env.LISTING_IMAGE_BUCKET, {
      public: false,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: ["image/webp"],
    });
    if (result.error)
      throw new Error("Could not create the private image bucket");
  } else {
    const b = existing.data;
    if (
      b.public ||
      b.file_size_limit !== 5 * 1024 * 1024 ||
      b.allowed_mime_types?.length !== 1 ||
      b.allowed_mime_types[0] !== "image/webp"
    )
      throw new Error(
        "Existing bucket settings are unsafe or incompatible. Use a new private bucket restricted to WebP and 5 MB",
      );
  }
  console.log(
    "Private image bucket configured. Do not add anonymous or authenticated Storage policies; the API checks access.",
  );
}
setup().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
