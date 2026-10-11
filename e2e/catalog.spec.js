const { test, expect } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const crypto = require("node:crypto");

async function signIn(page, account, destination) {
  await page.goto(destination);
  await expect(page).toHaveURL(/\/login$/);
  await page
    .getByLabel("Email address")
    .fill(`${account}@resourcepk.example.invalid`);
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(destination + "$"));
}
async function inspect(page, name, testInfo) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(name, { body: screenshot, contentType: "image/png" });
  expect(
    results.violations,
    JSON.stringify(
      results.violations.map(({ id, nodes }) => ({
        id,
        targets: nodes.map((node) => node.target),
      })),
    ),
  ).toEqual([]);

}
async function checkDrawer(page, width) {
  if (width >= 1024) return;
  const opener = page.getByRole("button", {
    name: "Open navigation",
    exact: true,
  });
  await opener.click();
  const drawer = page.getByRole("dialog", { name: "Workspace navigation" });
  await expect(drawer).toBeVisible();
  await expect(
    drawer.getByRole("link", { name: "ReSource PK home" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(drawer.getByRole("button", { name: "Sign out" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    drawer.getByRole("link", { name: "ReSource PK home" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await expect(drawer).toHaveCount(0);
}

for (const width of [360, 390, 768, 1024, 1280, 1440]) {
  test(`seller → reviewer → buyer at ${width}px with real sessions and PostgreSQL`, async ({
    browser,
  }, testInfo) => {
    const contexts = await Promise.all(
      [0, 1, 2].map(() =>
        browser.newContext({
          viewport: { width, height: 900 },
          reducedMotion: "reduce",
        }),
      ),
    );
    try {
      const [seller, reviewer, buyer] = await Promise.all(
        contexts.map((context) => context.newPage()),
      );
      await signIn(seller, "demo-owner-1", "/org/demo-organization-1/listings");
      await checkDrawer(seller, width);
      const title = `Acceptance cotton ${width} ${crypto.randomUUID()}`;
      await seller.getByLabel("Listing title", { exact: true }).fill(title);
      await seller
        .getByLabel("Material", { exact: true })
        .fill("Acceptance cotton");
      await seller.getByLabel("Condition", { exact: true }).fill("Unused");
      await seller
        .getByLabel("Available quantity", { exact: true })
        .fill("100");
      await seller
        .getByLabel("Minimum order quantity", { exact: true })
        .fill("10");
      await seller
        .getByLabel("Price per unit in PKR", { exact: true })
        .fill("100.29");
      await seller
        .getByLabel("Description (at least 20 characters)", { exact: true })
        .fill(
          "Synthetic acceptance fixture. Clean cotton stock for testing only.",
        );
      await seller
        .getByRole("button", { name: "Add price tier", exact: true })
        .click();
      await seller
        .getByLabel("Tier 1 minimum quantity", { exact: true })
        .fill("50");
      await seller
        .getByLabel("Tier 1 PKR per unit", { exact: true })
        .fill("90.01");
      await seller
        .getByRole("button", { name: "Save draft", exact: true })
        .click();
      const stock = seller.locator("article.catalog-card").filter({
        has: seller.getByRole("heading", { name: title, exact: true }),
      });
      await expect(stock).toContainText("draft");
      await inspect(seller, `seller-${width}`, testInfo);
      await stock
        .getByRole("button", { name: "Submit for review", exact: true })
        .click();
      await expect(stock).toContainText("pending review");
      await signIn(reviewer, "demo-admin", "/admin/review-queue");
      const review = reviewer.locator("article.catalog-card").filter({
        has: reviewer.getByRole("heading", { name: title, exact: true }),
      });
      await review
        .getByLabel(`Review reason for ${title} (required)`, { exact: true })
        .fill("Synthetic acceptance review completed.");
      await inspect(reviewer, `reviewer-${width}`, testInfo);
      await review
        .getByRole("button", { name: "Publish", exact: true })
        .click();
      await expect(review).toHaveCount(0);
      await buyer.goto("/marketplace");
      await buyer.getByRole("button", { name: "Next", exact: true }).click();
      await expect(
        buyer.getByText("Page 2 of 2", { exact: true }),
      ).toBeVisible();
      await buyer
        .getByRole("button", { name: "Previous", exact: true })
        .click();
      await buyer.getByLabel("Search", { exact: true }).fill(title);
      await buyer
        .getByRole("button", { name: "Find materials", exact: true })
        .click();
      await buyer
        .getByRole("link", { name: `View ${title}`, exact: true })
        .click();
      await expect(
        buyer.getByRole("heading", { level: 1, name: title }),
      ).toBeVisible();
      await expect(buyer.getByRole("table")).toContainText("90.01");
      await inspect(buyer, `detail-${width}`, testInfo);
      await buyer.reload();
      await expect(
        buyer.getByRole("heading", { level: 1, name: title }),
      ).toBeVisible();
      await signIn(buyer, "demo-buyer", "/buyer/requirements");
      await buyer
        .getByLabel("Material", { exact: true })
        .fill("Acceptance cotton");
      await buyer.getByLabel("Quantity", { exact: true }).fill("60");
      await buyer
        .getByLabel("Maximum PKR per unit (optional)", { exact: true })
        .fill("91");
      await buyer
        .getByRole("button", { name: "Save requirement", exact: true })
        .click();
      const requirement = buyer.locator(".requirement-row").first();
      await requirement
        .getByRole("button", { name: "See matches", exact: true })
        .click();
      await expect(
        buyer.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
      await expect(buyer.locator(".catalog-panel")).toContainText(
        "Meets current MOQ",
      );
      await inspect(buyer, `buyer-${width}`, testInfo);
      await requirement
        .getByRole("button", { name: "Pause", exact: true })
        .click();
      await expect(requirement).toContainText("paused");
      await expect(
        requirement.getByRole("button", { name: "See matches" }),
      ).toBeDisabled();
      await requirement
        .getByRole("button", { name: "Resume", exact: true })
        .click();
      await expect(requirement).toContainText("active");
      await requirement.getByText("Close requirement", { exact: true }).click();
      await requirement
        .getByRole("button", { name: "Confirm close", exact: true })
        .click();
      await expect(requirement).toContainText("closed");
      await seller.reload();
      await expect(stock).toContainText("published");
      await stock.getByText("Archive this listing", { exact: true }).click();
      await stock
        .getByRole("button", { name: "Confirm archive", exact: true })
        .click();
      await expect(stock).toContainText("archived");
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
}

test("public discovery reports a transport failure and recovers on retry", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/v1/listings?*", (route) => {
    if (fail) {
      fail = false;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "TEST_OUTAGE", message: "Simulated transport outage" },
        }),
      });
    }
    return route.continue();
  });
  await page.goto("/marketplace");
  await expect(page.getByRole("alert")).toContainText(
    "Simulated transport outage",
  );
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator("article.catalog-card").first()).toBeVisible();
  await page.getByLabel("Search", { exact: true }).fill(crypto.randomUUID());
  await page
    .getByRole("button", { name: "Find materials", exact: true })
    .click();
  await expect(
    page.getByText("No published materials match yet. Try a broader search."),
  ).toBeVisible();
});
