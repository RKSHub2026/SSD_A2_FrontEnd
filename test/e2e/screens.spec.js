/**
 * Analytics, Map and Reviews. Analytics uses PostgreSQL only; Map and
 * Reviews read your seeded MongoDB and are skipped when it is not running.
 */
import { expect, test } from "@playwright/test";
import { RIDERS, VEHICLES, mongoUp } from "./helpers.js";

test("analytics: moving-average chart, ranking, and the view's refresh", async ({ page }) => {
  await page.goto("/#/analytics");
  await expect(page.locator(".chart-box canvas")).toBeVisible();
  await expect(page.getByText("The chart could not load")).toHaveCount(0);
  await expect(page.locator(".chart-legend li").first()).toBeVisible();
  expect(await page.locator(".chart-legend li").count()).toBeGreaterThanOrEqual(5); // top 5 (ties can add more)
  await expect(page.locator('table:has(caption:text("ranked")) tbody tr').first()).toBeVisible();

  // start from a fresh view (other specs may have booked rides already)
  await page.getByRole("button", { name: "Refresh statistics" }).click();
  await expect(page.locator(".freshness")).toContainText("Up to date with the trips table");

  // a new booking makes the materialized view stale until it is refreshed
  const res = await page.request.post("/api/trips", { data: { riderId: RIDERS.asha, vehicleId: VEHICLES.v2, fare: 100 } });
  expect(res.status()).toBe(201);
  await page.reload();
  await expect(page.locator(".freshness")).toContainText("1 new trip is not counted yet");
  await page.getByRole("button", { name: "Refresh statistics" }).click();
  await expect(page.locator(".freshness")).toContainText("Up to date with the trips table");
});

test("map: Leaflet map, 5 km search and the nearest list", async ({ page, request }) => {
  test.skip(!(await mongoUp(request)), "MongoDB is not running");
  await page.goto("/#/map");
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.getByText("The map could not")).toHaveCount(0);
  await expect(page.locator(".live")).toHaveText(/^Live/, { timeout: 15_000 });
  await expect(page.locator(".nearest__item, .nearest .empty").first()).toBeVisible();
  await page.getByLabel("Pickup point", { exact: true }).selectOption("csmt");
  await expect(page).toHaveURL(/origin=csmt/);
});

test("reviews: $facet summary and a catalog panel", async ({ page, request }) => {
  test.skip(!(await mongoUp(request)), "MongoDB is not running");
  await page.goto("/#/reviews");
  await expect(page.locator(".rating-hero__value")).toBeVisible();
  // the test vehicles exist only in PostgreSQL, so the catalog may be empty here
  await expect(page.locator(".catalog, :text('No catalog document')").first()).toBeVisible();
});
