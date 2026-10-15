/**
 * Saves a screenshot of every screen from a RUNNING app into docs/design/screens/.
 *
 *   npm run dev                       (in another terminal, on seeded data, with --live running for the map)
 *   npm run screenshots               (or: npm run screenshots -- http://localhost:4000)
 *
 * Read-only: it only opens pages. It picks a rider who has an active trip (so Book and Audit have something to
 * show) and puts them in the actor switcher of this headless browser, not yours. Needs `npm run e2e:install` once.
 */
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const base = (process.argv[2] ?? process.env.SCREENSHOT_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const outDir = fileURLToPath(new URL("../../docs/design/screens/", import.meta.url));

async function json(path) {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
}

async function pickRider() {
  const active = await json("/api/trips?status=REQUESTED&pageSize=1");
  const trip = active.items[0] ?? (await json("/api/trips?pageSize=1")).items[0];
  if (trip) return json(`/api/riders/${trip.riderId}`);
  return (await json("/api/riders?pageSize=1")).items[0];
}

const shots = [
  { name: "browse", hash: "#/browse/trips", ready: "table tbody tr" },
  { name: "book", hash: "#/book", ready: "form" },
  { name: "audit", hash: "#/audit", ready: "table tbody tr" },
  { name: "analytics", hash: "#/analytics", ready: ".chart-box canvas", settle: 1500 },
  { name: "map", hash: "#/map", ready: ".leaflet-container", settle: 5000 },
  { name: "reviews", hash: "#/reviews", ready: ".rating-hero__value" },
];

try {
  await json("/api/health");
} catch (err) {
  console.error(`The app is not answering at ${base} (${err.message}). Start it with "npm run dev" first.`);
  process.exit(1);
}

const rider = await pickRider();
await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
await page.addInitScript((actor) => {
  localStorage.setItem("ridesync.actor", JSON.stringify(actor));
}, { id: rider.id, name: rider.name, walletBalance: Number(rider.walletBalance) });

let failed = 0;
for (const s of shots) {
  try {
    await page.goto(`${base}/${s.hash}`);
    await page.waitForSelector(s.ready, { timeout: 20_000 });
    await page.waitForTimeout(s.settle ?? 700);
    await page.evaluate(() => document.activeElement?.blur());
    await page.screenshot({ path: `${outDir}${s.name}.png`, fullPage: true });
    console.log(`saved docs/design/screens/${s.name}.png`);
  } catch (err) {
    failed++;
    console.error(`${s.name}: ${err.message.split("\n")[0]}`);
  }
}
await browser.close();
if (failed) {
  console.error(`${failed} screen(s) not saved. Map and Reviews need MongoDB seeded (and --live for the map).`);
  process.exit(1);
}
