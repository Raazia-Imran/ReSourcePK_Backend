const { z } = require("zod");
const service = require("../services/workspaceDataService");
const organizationId = z.string().uuid();
const nameInput = z
  .object({ name: z.string().trim().min(2).max(180) })
  .strict();
const pagination = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();
const send = (res, data) => res.json({ data });

async function buyerImpact(req, res) {
  send(res, await service.buyerImpact(req.auth.sub));
}
async function organizationAnalytics(req, res) {
  send(
    res,
    await service.organizationAnalytics(
      req.auth.sub,
      organizationId.parse(req.params.organizationId),
    ),
  );
}
async function getOrganizationSettings(req, res) {
  send(
    res,
    await service.organizationSettings(
      req.auth.sub,
      organizationId.parse(req.params.organizationId),
    ),
  );
}
async function updateOrganizationSettings(req, res) {
  send(
    res,
    await service.updateOrganizationSettings(
      req.auth.sub,
      organizationId.parse(req.params.organizationId),
      nameInput.parse(req.body).name,
      req.ip,
    ),
  );
}
async function platformOrganizations(req, res) {
  const page = pagination.parse(req.query);
  send(
    res,
    await service.platformOrganizations(req.auth.sub, page.limit, page.offset),
  );
}
async function platformUsers(req, res) {
  const page = pagination.parse(req.query);
  send(res, await service.platformUsers(req.auth.sub, page.limit, page.offset));
}
async function platformAnalytics(req, res) {
  send(res, await service.platformAnalytics(req.auth.sub));
}

module.exports = {
  buyerImpact,
  organizationAnalytics,
  getOrganizationSettings,
  updateOrganizationSettings,
  platformOrganizations,
  platformUsers,
  platformAnalytics,
};
