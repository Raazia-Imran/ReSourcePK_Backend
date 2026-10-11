const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");
const { env } = require("../../config/env");
const { AppError } = require("../../lib/errors");
const MAX_BYTES = 5 * 1024 * 1024;
let client;
function bucket() {
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_SERVICE_ROLE_KEY ||
    !env.LISTING_IMAGE_BUCKET
  )
    throw new AppError(
      503,
      "STORAGE_NOT_CONFIGURED",
      "Listing image storage has not been configured",
    );
  client ||= createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, options) =>
        fetch(url, { ...options, signal: AbortSignal.timeout(15000) }),
    },
  });
  return client.storage.from(env.LISTING_IMAGE_BUCKET);
}
async function normalizeImage(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES)
    throw new AppError(
      422,
      "IMAGE_SIZE",
      "Choose an image no larger than 5 MB",
    );
  // Reject active formats before invoking any vector renderer.
  const raster =
    buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ||
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    (buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP");
  if (!raster)
    throw new AppError(
      422,
      "IMAGE_TYPE",
      "Choose a JPEG, PNG or WebP raster image",
    );
  try {
    const decoder = sharp(buffer, {
      failOn: "warning",
      limitInputPixels: 16000000,
      animated: false,
    });
    const metadata = await decoder.metadata();
    if (
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      (metadata.pages || 1) > 1
    )
      throw new Error("Unsupported image");
    const result = await decoder
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .timeout({ seconds: 10 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length > MAX_BYTES) throw new Error("Image too large");
    return {
      buffer: result.data,
      width: result.info.width,
      height: result.info.height,
    };
  } catch {
    throw new AppError(
      422,
      "INVALID_IMAGE",
      "Image is invalid, animated, or exceeds the 16 megapixel limit",
    );
  }
}
async function upload(key, image) {
  const result = await bucket().upload(key, image.buffer, {
    contentType: "image/webp",
    upsert: false,
    cacheControl: "60",
  });
  if (result.error)
    throw new AppError(
      503,
      "STORAGE_UNAVAILABLE",
      "Image storage is temporarily unavailable",
    );
}
async function remove(key) {
  const result = await bucket().remove([key]);
  if (result.error)
    throw new AppError(
      503,
      "STORAGE_UNAVAILABLE",
      "Image storage is temporarily unavailable",
    );
}
async function signedUrl(key) {
  const result = await bucket().createSignedUrl(key, 60);
  if (result.error)
    throw new AppError(
      503,
      "STORAGE_UNAVAILABLE",
      "Image storage is temporarily unavailable",
    );
  return result.data.signedUrl;
}
module.exports = { normalizeImage, upload, remove, signedUrl, MAX_BYTES };
