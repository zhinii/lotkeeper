import { env } from "cloudflare:workers";

type AppBindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
};

export function getBindings(): AppBindings {
  const bindings = env as unknown as Partial<AppBindings>;
  if (!bindings.DB) throw new Error("D1 binding DB is unavailable.");
  if (!bindings.MEDIA) throw new Error("R2 binding MEDIA is unavailable.");
  return bindings as AppBindings;
}

let initialized = false;

export async function ensureCommunitySchema() {
  if (initialized) return;
  const { DB } = getBindings();
  await DB.batch([
    DB.prepare(`CREATE TABLE IF NOT EXISTS contributions (
      id TEXT PRIMARY KEY NOT NULL,
      submission_type TEXT NOT NULL,
      record_type TEXT NOT NULL,
      item_name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      quantity REAL,
      quantity_unit TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      gps_latitude REAL NOT NULL,
      gps_longitude REAL NOT NULL,
      gps_accuracy REAL,
      contact_name TEXT NOT NULL,
      contact_method TEXT NOT NULL,
      contact_value TEXT NOT NULL,
      photo_key TEXT NOT NULL,
      photo_content_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      submitted_at INTEGER NOT NULL,
      moderated_at INTEGER,
      moderated_by TEXT,
      moderation_note TEXT
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS idx_contributions_status_submitted
      ON contributions(status, submitted_at)`),
    DB.prepare(`CREATE TABLE IF NOT EXISTS public_records (
      id TEXT PRIMARY KEY NOT NULL,
      record_type TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      photo_key TEXT,
      source_submission_id TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    DB.prepare(`CREATE INDEX IF NOT EXISTS idx_public_records_type_status
      ON public_records(record_type, status)`),
  ]);
  initialized = true;
}
