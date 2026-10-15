/** Shared helpers for the browser tests. */
export { MISSING, RIDERS, VEHICLES, plateOf } from "../support/ids.js";

/**
 * Acts as a fixture rider (what the header switcher does), before the page
 * loads. The app then re-reads the real name and balance from the API.
 */
export async function actAs(page, riderId) {
  await page.addInitScript((id) => {
    localStorage.setItem("ridesync.actor", JSON.stringify({ id, name: "…", walletBalance: 0 }));
  }, riderId);
}

/** True when the API reports MongoDB reachable (Map / Reviews tests need it). */
export async function mongoUp(request) {
  const res = await request.get("/api/health");
  return (await res.json()).mongo === true;
}
