/** Audit trail in the browser: running balance, filters, and the read-only log. */
import { expect, test } from "@playwright/test";
import { RIDERS, actAs } from "./helpers.js";

test.beforeEach(async ({ page }) => {
  await actAs(page, RIDERS.ekta); // 3000 -> +500 -> +250 -> -120 = 3630
  await page.goto("/#/audit");
  await expect(page.locator("h1")).toHaveText("Audit trail: Test Ekta");
});

const rows = (page) => page.locator(".table tbody tr");

test("shows every wallet change with a running balance", async ({ page }) => {
  await expect(rows(page)).toHaveCount(3);
  const after = await rows(page).locator("td:nth-child(5)").allInnerTexts();
  const before = await rows(page).locator("td:nth-child(4)").allInnerTexts();
  expect(after).toEqual(["₹3,630.00", "₹3,750.00", "₹3,500.00"]);
  expect(before.slice(0, 2)).toEqual(after.slice(1)); // each "before" is the previous "after"
  await expect(page.locator(".wallet-now")).toContainText("₹3,630.00");
});

test("trying to delete an entry is refused by the database", async ({ page }) => {
  await rows(page).first().getByRole("button", { name: "Try to delete" }).click();
  const error = page.locator(".alert--error");
  await expect(error).toContainText("Audit log is read-only");
  await expect(error).toContainText("trg_wallet_audit_immutable");
  await expect(rows(page)).toHaveCount(3);
});

test("filters by type and date, with an empty state", async ({ page }) => {
  await page.getByLabel("Type").selectOption("TOP_UP");
  await expect(rows(page)).toHaveCount(2);
  await expect(page).toHaveURL(/action=TOP_UP/);
  await page.getByLabel("From").fill("2099-01-01");
  await page.getByLabel("From").blur();
  await expect(page.getByText("No wallet changes match these filters")).toBeVisible();
});
