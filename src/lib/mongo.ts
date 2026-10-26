/**
 * MongoDB access for the activity log (the project's second database paradigm).
 */
import { MongoClient, type Collection, type Db as MongoDb } from "mongodb";
import { env } from "./env";

export type ActivityDoc = {
  event_id: string;
  entity_type: "donor" | "request" | "donation" | "hospital" | "recipient";
  entity_id: number;
  action: string;
  timestamp: Date;
  /** Shape depends on the action — the reason this lives in a document store. */
  details: Record<string, unknown>;
  performed_by: { user_id: number | null; role: string; email: string | null };
  /** Ids of related records so one entity's full history is a single lookup. */
  related: { donor_id?: number; request_id?: number; hospital_id?: number; recipient_id?: number };
};

export const ACTIVITY_COLLECTION = "activity_logs";

const g = globalThis as unknown as { __bdmMongo?: MongoClient; __bdmMongoReady?: Promise<void>; __bdmMongoUri?: string };

export function getMongoClient(): MongoClient {
  const uri = env.mongoUri;
  if (!g.__bdmMongo || g.__bdmMongoUri !== uri) {
    g.__bdmMongo = new MongoClient(uri, {
      // Fail fast: a slow/unavailable log store must not hang business requests.
      serverSelectionTimeoutMS: 2000,
      connectTimeoutMS: 2000,
    });
    g.__bdmMongoUri = uri;
    g.__bdmMongoReady = undefined;
  }
  return g.__bdmMongo;
}

export function getMongoDb(): MongoDb {
  return getMongoClient().db(env.mongoDb);
}

/** Create the collection (with a JSON-schema validator) and its indexes once. */
export async function ensureActivityCollection(): Promise<void> {
  if (!g.__bdmMongoReady) {
    g.__bdmMongoReady = (async () => {
      const db = getMongoDb();
      const validator = {
        $jsonSchema: {
          bsonType: "object",
          required: ["event_id", "entity_type", "entity_id", "action", "timestamp", "details", "performed_by"],
          properties: {
            event_id: { bsonType: "string" },
            entity_type: { enum: ["donor", "request", "donation", "hospital", "recipient"] },
            entity_id: { bsonType: ["int", "long", "double"] },
            action: { bsonType: "string" },
            timestamp: { bsonType: "date" },
            details: { bsonType: "object" },
            performed_by: { bsonType: "object" },
            related: { bsonType: "object" },
          },
        },
      };
      const existing = await db.listCollections({ name: ACTIVITY_COLLECTION }).toArray();
      if (existing.length === 0) {
        await db.createCollection(ACTIVITY_COLLECTION, { validator }).catch((err) => {
          if (err?.codeName !== "NamespaceExists") throw err;
        });
      }
      const logs = db.collection(ACTIVITY_COLLECTION);
      await logs.createIndexes([
        // Idempotency: redelivering the same outbox row can never duplicate an event.
        { key: { event_id: 1 }, name: "uq_event_id", unique: true },
        // "History of donor #12", newest first.
        { key: { entity_type: 1, entity_id: 1, timestamp: -1 }, name: "idx_entity_history" },
        // Recent-activity feed and date-range scans for the aggregation.
        { key: { timestamp: -1 }, name: "idx_timestamp" },
        // Filter the feed by action.
        { key: { action: 1, timestamp: -1 }, name: "idx_action_time" },
        // Everything that touched a given donor / request, whatever the entity.
        { key: { "related.donor_id": 1, timestamp: -1 }, name: "idx_related_donor", sparse: true },
        { key: { "related.request_id": 1, timestamp: -1 }, name: "idx_related_request", sparse: true },
      ]);
    })().catch((err) => {
      g.__bdmMongoReady = undefined;
      throw err;
    });
  }
  return g.__bdmMongoReady;
}

export async function getActivityCollection(): Promise<Collection<ActivityDoc>> {
  await ensureActivityCollection();
  return getMongoDb().collection<ActivityDoc>(ACTIVITY_COLLECTION);
}

export async function closeMongo(): Promise<void> {
  if (g.__bdmMongo) {
    await g.__bdmMongo.close();
    g.__bdmMongo = undefined;
    g.__bdmMongoReady = undefined;
  }
}
