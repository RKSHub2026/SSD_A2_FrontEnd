/**
 * Renders wireframes.html into one PNG per screen, next to this file.
 *   node docs/design/wireframes/render.js      (needs `npm run e2e:install` once)
 */
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const dir = fileURLToPath(new URL("./", import.meta.url));
const screens = ["browse", "book", "audit", "analytics", "map", "reviews", "phone-book"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 1 });
await page.goto(new URL("wireframes.html", import.meta.url).href);
for (const id of screens) {
  await page.locator(`#${id}`).screenshot({ path: `${dir}${id}.png` });
  console.log(`saved docs/design/wireframes/${id}.png`);
}
await browser.close();
