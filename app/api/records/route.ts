import { ensureCommunitySchema, getBindings } from "../../../db/runtime";

export async function GET() {
  await ensureCommunitySchema();
  const { DB } = getBindings();
  const result = await DB.prepare(`SELECT id, record_type AS recordType, name,
    category, description, latitude, longitude, photo_key AS photoKey,
    created_at AS createdAt FROM public_records
    WHERE status = 'active' ORDER BY created_at DESC LIMIT 250`).all();
  return Response.json({ records: result.results });
}
