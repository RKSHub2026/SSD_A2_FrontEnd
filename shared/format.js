/** Formatting helpers (browser-safe, no imports). Currency is INR (fares 100-800). */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const inrCompact = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});
const int = new Intl.NumberFormat("en-IN");

export const formatMoney = (v) =>
  v == null || Number.isNaN(v) ? "—" : inr.format(v);

/**
 * Compact money for big headline figures: "₹14.9L", "₹4.5Cr". Below one lakh
 * the full amount is shown, because en-IN abbreviates thousands as "T",
 * which readers take for trillion.
 */
export const formatMoneyCompact = (v) =>
  v == null || Number.isNaN(v) ? "—" : Math.abs(v) < 100_000 ? inr.format(v) : inrCompact.format(v);

/** Signed amount, e.g. "+₹500.00" / "−₹120.00" (true minus sign). */
export const formatSignedMoney = (v) =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${inr.format(Math.abs(v))}`;

export const formatInt = (v) =>
  v == null || Number.isNaN(v) ? "—" : int.format(v);

export const formatKm = (km) =>
  km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`;

export const formatDateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

export const formatDate = (iso) =>
  iso
    ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

/** "12 s ago", "3 min ago", "2 h ago" */
export function formatRelative(iso, now = Date.now()) {
  if (!iso) return "—";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** First 8 chars of a UUID, for compact display. */
export const shortId = (id) => (id ? id.slice(0, 8) : "—");

/** Local calendar date as YYYY-MM-DD (for date inputs / query params). */
export function toIsoDate(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}
