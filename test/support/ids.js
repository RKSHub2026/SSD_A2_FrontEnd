/** Fixture ids and names (test/support/fixtures.sql). */
const rider = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const vehicle = (n) => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const RIDERS = {
  asha: rider(1), // 5000, no active trip
  bala: rider(2), // 50, too little for most fares
  chen: rider(3), // active REQUESTED trip in vehicle 3
  dev: rider(4), // status flow
  ekta: rider(5), // audit history: +500, +250, -120  -> 3630
  farah: rider(6), // browser tests
  gopal: rider(7),
  hari: rider(8),
};
export const VEHICLES = {
  v1: vehicle(1),
  v2: vehicle(2),
  busy: vehicle(3), // Test Chen's active trip
  v4: vehicle(4),
  v6: vehicle(6),
  inactive: vehicle(13),
};
export const plateOf = (n) => `MH${String(n).padStart(2, "0")}TS${String(n).padStart(4, "0")}`;
export const MISSING = "11111111-1111-4111-8111-111111111111";
export const COUNTS = { riders: 30, vehicles: 13, activeVehicles: 12, trips: 242 };
