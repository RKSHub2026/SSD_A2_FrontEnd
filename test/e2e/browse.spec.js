/** Browsing: pagination, filters kept in the URL, detail views, empty states. */
import { expect, test } from "@playwright/test";

const rows = (page) => page.locator(".table tbody tr");

test("trips are paginated and filters survive a reload", async ({ page }) => {
  await page.goto("/#/browse/trips");
  await expect(rows(page)).toHaveCount(20);
  // the total grows when other specs book rides, so only the pattern is fixed
  await expect(page.locator(".pager")).toContainText(/1–20 of \d{3}/);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.locator(".pager")).toContainText(/21–40 of \d{3}/);

  await page.getByLabel("Status").selectOption("REQUESTED");
  await expect(page).toHaveURL(/status=REQUESTED/);
  await expect(page.locator(".pager")).toContainText(/1–\d+ of \d+$|of \d+Previous/); // filtered list loaded
  await expect(rows(page).locator(".status--completed")).toHaveCount(0);
  const ids = await rows(page).locator("th").allInnerTexts();
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.length).toBeLessThan(20);

  await page.reload();
  await expect(page.getByLabel("Status")).toHaveValue("REQUESTED");
  await expect(rows(page)).toHaveCount(ids.length);
  expect(await rows(page).locator("th").allInnerTexts()).toEqual(ids);
});

test("a trip's detail view shows its linked audit entry", async ({ page }) => {
  await page.goto("/#/browse/trips?status=REQUESTED");
  await rows(page).first().click();
  await expect(page.locator("h1")).toHaveText(/^Trip /);
  await expect(page.locator(".table")).toContainText("Fare deduction");
});

test("search with no match shows an empty state, not a blank page", async ({ page }) => {
  await page.goto("/#/browse/riders");
  await page.getByLabel("Search riders").fill("zzz-nobody");
  await expect(page.getByText("No riders match this search")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).first().click();
  await expect(rows(page)).toHaveCount(20);
});

test("vehicles can be filtered to the ones out of service", async ({ page }) => {
  await page.goto("/#/browse/vehicles");
  await page.getByLabel("Availability").selectOption("inactive");
  await expect(rows(page)).toHaveCount(1);
  await rows(page).first().click();
  await expect(page.getByText("Out of service").first()).toBeVisible();
});

test("works on a phone without sideways scrolling @phone", async ({ page }) => {
  for (const path of ["/#/browse/trips", "/#/book", "/#/audit", "/#/analytics"]) {
    await page.goto(path);
    await expect(page.locator("h1")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
