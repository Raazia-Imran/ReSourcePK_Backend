const crypto = require("node:crypto");
const db = require("../../db");
const repo = require("./repository");
const images = require("./imageAdapter");
const { AppError } = require("../../lib/errors");

async function requireSeller(user, org, runner = db) {
  const role = await repo.sellerRole(user, org, runner);
  if (!["owner", "manager"].includes(role))
    throw new AppError(
      403,
      "SELLER_ACCESS_DENIED",
      "Only an active Owner or Manager can manage listings",
    );
}
async function requireReviewer(user, runner = db) {
  if (!(await repo.isReviewer(user, runner)))
    throw new AppError(
      403,
      "PLATFORM_ACCESS_DENIED",
      "Platform review access required",
    );
}
function editable(listing, version) {
  if (!["draft", "rejected"].includes(listing.status))
    throw new AppError(
      409,
      "LISTING_NOT_EDITABLE",
      "Only draft or rejected listings can be edited",
    );
  if (listing.version !== version)
    throw new AppError(
      409,
      "VERSION_CONFLICT",
      "Stock changed. Reload before saving.",
    );
}
async function listSeller(user, org) {
  await requireSeller(user, org);
  return repo.listSeller(org);
}
async function create(user, org, input) {
  return db.transaction(async (runner) => {
    await requireSeller(user, org, runner);
    const listing = await repo.createListing(runner, org, user, input);
    await repo.audit(runner, user, org, listing.id, "listing.created");
    return listing;
  });
}
async function edit(user, org, id, input, version) {
  return db.transaction(async (runner) => {
    await requireSeller(user, org, runner);
    editable(await repo.lockListing(runner, org, id), version);
    const listing = await repo.editListing(runner, org, id, input, version);
    await repo.audit(runner, user, org, id, "listing.edited");
    return listing;
  });
}
async function transition(user, org, id, status, version) {
  return db.transaction(async (runner) => {
    await requireSeller(user, org, runner);
    const current = await repo.lockListing(runner, org, id);
    if (current.version !== version)
      throw new AppError(
        409,
        "VERSION_CONFLICT",
        "Stock changed. Reload before saving.",
      );
    if (status === "pending_review") editable(current, version);
    else if (current.status === "archived")
      throw new AppError(
        409,
        "LISTING_ARCHIVED",
        "Listing is already archived",
      );
    const listing = await repo.setListingStatus(runner, id, status);
    await repo.audit(runner, user, org, id, `listing.${status}`);
    return listing;
  });
}
async function pending(user) {
  await requireReviewer(user);
  return repo.listPending();
}
async function review(user, id, decision, reason, version) {
  return db.transaction(async (runner) => {
    await requireReviewer(user, runner);
    const current = await repo.reviewListingLock(runner, id);
    if (
      !current ||
      current.status !== "pending_review" ||
      current.version !== version
    )
      throw new AppError(
        409,
        "LISTING_NOT_PENDING",
        "Listing changed or is no longer awaiting review",
      );
    await requireActiveOrganization(current.organization_id, runner);
    const listing = await repo.setListingStatus(runner, id, decision, reason);
    await repo.audit(
      runner,
      user,
      current.organization_id,
      id,
      `listing.${decision}`,
      reason,
    );
    return listing;
  });
}
async function requireActiveOrganization(org, runner) {
  if (!(await repo.activeOrganization(runner, org)))
    throw new AppError(
      409,
      "ORGANIZATION_UNAVAILABLE",
      "Seller organization is not active",
    );
}
async function publicListing(id) {
  const listing = await repo.publicListing(id);
  if (!listing)
    throw new AppError(404, "LISTING_NOT_FOUND", "Listing unavailable");
  return listing;
}
async function createRequirement(user, input) {
  return db.transaction(async (runner) => {
    const requirement = await repo.createRequirement(runner, user, input);
    await repo.requirementAudit(
      runner,
      user,
      requirement.id,
      "requirement.created",
    );
    return requirement;
  });
}
async function requirementStatus(user, id, status, version) {
  return db.transaction(async (runner) => {
    const current = await repo.lockRequirement(runner, user, id);
    if (!current)
      throw new AppError(
        404,
        "REQUIREMENT_NOT_FOUND",
        "Requirement unavailable",
      );
    if (
      current.version !== version ||
      current.status === "closed" ||
      current.status === status
    )
      throw new AppError(
        409,
        "REQUIREMENT_STATE",
        "Requirement changed or cannot make this transition",
      );
    const result = await repo.setRequirementStatus(runner, id, status);
    await repo.requirementAudit(runner, user, id, `requirement.${status}`);
    return result;
  });
}
async function addImage(user, org, id, file, alt, version) {
  await requireSeller(user, org);
  const normalized = await images.normalizeImage(file?.buffer);
  const key = `${org}/${id}/${crypto.randomUUID()}.webp`;
  let uploaded = false;
  try {
    return await db.transaction(async (runner) => {
      await requireSeller(user, org, runner);
      editable(await repo.lockListing(runner, org, id), version);
      if ((await repo.imageCount(runner, id)) >= 8)
        throw new AppError(
          409,
          "IMAGE_LIMIT",
          "A listing can have at most eight images",
        );
      await images.upload(key, normalized);
      uploaded = true;
      const image = await repo.insertImage(runner, id, key, alt, normalized);
      await repo.bumpListing(runner, id);
      await repo.audit(runner, user, org, id, "listing.image_added");
      return image;
    });
  } catch (error) {
    if (uploaded)
      await images.remove(key).catch(async () => {
        await repo.queueImageCleanup(key);
      });
    throw error;
  }
}
async function imageUrl(user, id) {
  const image = await repo.findImage(id);
  if (!image) throw new AppError(404, "IMAGE_NOT_FOUND", "Image unavailable");
  if (image.status !== "published" || image.organization_status !== "active") {
    if (!user) throw new AppError(404, "IMAGE_NOT_FOUND", "Image unavailable");
    if (!(await repo.isReviewer(user)))
      await requireSeller(user, image.organization_id);
  }
  return { url: await images.signedUrl(image.object_key), expiresIn: 60 };
}
async function deleteImage(user, org, id, imageId, version) {
  return db.transaction(async (runner) => {
    await requireSeller(user, org, runner);
    editable(await repo.lockListing(runner, org, id), version);
    const image = await repo.findImage(imageId, runner);
    if (!image || image.listing_id !== id)
      throw new AppError(404, "IMAGE_NOT_FOUND", "Image unavailable");
    await repo.queueImageCleanup(image.object_key, runner);
    await repo.removeImageRecord(runner, imageId);
    await repo.bumpListing(runner, id);
    await repo.audit(runner, user, org, id, "listing.image_removed");
    return { removed: true };
  });
}
module.exports = {
  requireSeller,
  requireReviewer,
  editable,
  listSeller,
  create,
  edit,
  transition,
  pending,
  review,
  publicListing,
  createRequirement,
  requirementStatus,
  addImage,
  imageUrl,
  deleteImage,
};
