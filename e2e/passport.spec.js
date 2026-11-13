const { test, expect } = require("@playwright/test");
const id = "11111111-1111-4111-8111-111111111111";
for (const [status, matches, title] of [
  ["pending", null, "Anchoring is pending"],
  ["failed", null, "Anchoring failed"],
  ["anchored", true, "Passport matches the blockchain record"],
  ["anchored", false, "Passport integrity mismatch"],
]) {
  test(`public passport renders ${status}/${matches} without login`, async ({
    page,
  }) => {
    await page.route(`**/public/passports/${id}/verification`, (route) =>
      route.fulfill({
        json: {
          data: {
            passportId: id,
            version: 1,
            status,
            matches,
            snapshotHash: "a".repeat(64),
            transactionId: null,
            anchoredAt: null,
          },
        },
      }),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/verify/${id}`);
    await expect(
      page.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No transaction recorded", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
test("public passport handles unknown and invalid IDs", async ({ page }) => {
  await page.goto("/verify/not-a-uuid");
  await expect(page.getByRole("alert")).toContainText(
    "Enter a valid passport ID",
  );
  await page.route(`**/public/passports/${id}/verification`, (route) =>
    route.fulfill({
      status: 404,
      json: { error: { message: "Passport not found" } },
    }),
  );
  await page.goto(`/verify/${id}`);
  await expect(page.getByRole("alert")).toContainText(
    "No passport exists with this ID",
  );
});
