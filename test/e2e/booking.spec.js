/**
 * Workflow 1 in the browser: the transaction form's success and failure
 * cases, as a user sees them. Each test acts as its own fixture rider.
 */
import { expect, test } from "@playwright/test";
import { RIDERS, actAs, plateOf } from "./helpers.js";

test.describe.configure({ mode: "serial" });

test("booking shows the balance before and after and the new audit entry", async ({ page }) => {
  await actAs(page, RIDERS.farah);
  await page.goto("/#/book");
  await expect(page.locator(".actor__name")).toHaveText("Test Farah");
  await expect(page.locator(".wallet__balance")).toHaveText("₹3,000.00");

  await page.locator(".vehicle-option", { hasText: plateOf(1) }).click();
  await page.getByLabel("Fare").fill("250");
  await page.getByRole("button", { name: "Book ride" }).click();

  const result = page.locator(".book-result .alert--ok");
  await expect(result).toContainText("Ride booked");
  await expect(result.locator(".balance-change")).toContainText("₹3,000.00");
  await expect(result.locator(".balance-change")).toContainText("₹2,750.00");
  await expect(result).toContainText("Fare deduction"); // the audit row the trigger wrote
  await expect(result).toContainText("−₹250.00");
  await expect(page.locator(".actor__balance")).toHaveText("₹2,750.00");
  await expect(page.getByRole("button", { name: "Start trip" })).toBeVisible();
});

test("a second active trip is refused with the index name, and nothing is charged", async ({ page }) => {
  await actAs(page, RIDERS.farah);
  await page.goto("/#/book");
  await page.locator(".vehicle-option", { hasText: plateOf(2) }).click();
  await page.getByRole("button", { name: "Book ride" }).click();

  const error = page.locator(".book-result .alert--error");
  await expect(error).toContainText("Rider already has an active trip");
  await expect(error).toContainText("idx_unique_active_rider_trip");
  await expect(page.locator(".book-result")).toContainText("Nothing was charged");
  await expect(page.locator(".wallet__balance")).toHaveText("₹2,750.00");
});

test("insufficient balance is explained, and a top-up fixes it", async ({ page }) => {
  await actAs(page, RIDERS.gopal);
  await page.goto("/#/book");
  await expect(page.locator(".wallet__balance")).toHaveText("₹50.00");
  await page.locator(".vehicle-option", { hasText: plateOf(4) }).click();
  await page.getByLabel("Fare").fill("500");
  await page.getByRole("button", { name: "Book ride" }).click();

  const error = page.locator(".book-result .alert--error");
  await expect(error).toContainText("Insufficient wallet balance");
  await expect(error).toContainText("CHECK (wallet_balance >= 0)");
  await expect(page.locator(".wallet__balance")).toHaveText("₹50.00");

  await error.getByRole("button", { name: "Top up wallet" }).click();
  await expect(page.getByLabel("Amount")).toHaveValue("450"); // the shortfall
  await page.locator("form", { has: page.getByLabel("Amount") }).getByRole("button", { name: "Top up wallet" }).click();
  await expect(page.locator(".wallet__balance")).toHaveText("₹500.00");

  await page.getByRole("button", { name: "Book ride" }).click();
  await expect(page.locator(".book-result .alert--ok")).toContainText("Ride booked");
  await expect(page.locator(".wallet__balance")).toHaveText("₹0.00");
});

test("a trip moves forward only, and completing it frees the rider", async ({ page }) => {
  await actAs(page, RIDERS.hari);
  await page.goto("/#/book");
  await page.locator(".vehicle-option", { hasText: plateOf(6) }).click();
  await page.getByLabel("Fare").fill("100");
  await page.getByRole("button", { name: "Book ride" }).click();
  await expect(page.locator(".book-result .alert--ok")).toBeVisible();

  await page.getByRole("button", { name: "Try to skip to Completed" }).click();
  await expect(page.locator(".trip-actions__feedback")).toContainText("Status change not allowed");

  await page.getByRole("button", { name: "Start trip" }).click();
  await page.getByRole("button", { name: "Complete trip" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Complete trip" }).click();
  await expect(page.getByText("No active trip")).toBeVisible();
});
