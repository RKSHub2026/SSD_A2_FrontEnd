/**
 * In-memory stand-in for the MongoDB wrapper (api/db/mongo.js) used by the
 * API tests: records every pipeline it is given and returns canned
 * documents, so the tests check what the API sends to MongoDB and how it
 * shapes the answer, without a MongoDB server.
 *   fakeMongo({ TelemetryPings: { aggregate: [...] }, VehicleMetadata: { find: [...] } })
 */
export function fakeMongo(data = {}, { down = false } = {}) {
  const calls = [];
  const fail = () => {
    if (down) throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:27017"), { name: "MongoServerSelectionError" });
  };
  const cursor = (docs) => ({
    toArray: async () => {
      fail();
      return structuredClone(docs);
    },
  });
  const collection = (name) => ({
    aggregate(pipeline) {
      calls.push({ name, op: "aggregate", pipeline });
      return cursor(data[name]?.aggregate ?? []);
    },
    find(query, options) {
      calls.push({ name, op: "find", query, options });
      const docs = (data[name]?.find ?? []).filter((d) => !query?.vehicleId?.$in || query.vehicleId.$in.includes(d.vehicleId));
      return cursor(docs);
    },
    async findOne(query) {
      fail();
      calls.push({ name, op: "findOne", query });
      return structuredClone((data[name]?.find ?? []).find((d) => d.vehicleId === query.vehicleId) ?? null);
    },
    async countDocuments(query) {
      fail();
      calls.push({ name, op: "count", query });
      return data[name]?.count ?? 0;
    },
    async estimatedDocumentCount() {
      fail();
      return data[name]?.count ?? 0;
    },
  });
  return {
    calls,
    db: { collection },
    ping: async () => !down,
    isReplicaSet: async () => false,
    close: async () => {},
  };
}
