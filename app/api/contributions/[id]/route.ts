import { getChatGPTUser } from "../../../chatgpt-auth";
import { ensureCommunitySchema, getBindings } from "../../../../db/runtime";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  await ensureCommunitySchema();
  const { id } = await context.params;
  const body = await request.json() as { decision?: string; note?: string };
  if (!body.decision || !["approved", "rejected"].includes(body.decision))
    return Response.json({ error: "Choose approve or reject." }, { status: 400 });

  const { DB } = getBindings();
  const contribution = await DB.prepare(`SELECT * FROM contributions WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!contribution) return Response.json({ error: "Submission not found." }, { status: 404 });
  if (contribution.status !== "pending")
    return Response.json({ error: "This submission has already been reviewed." }, { status: 409 });

  const now = Date.now();
  const note = String(body.note || "").trim().slice(0, 800) || null;
  const statements = [DB.prepare(`UPDATE contributions SET status = ?,
    moderated_at = ?, moderated_by = ?, moderation_note = ?
    WHERE id = ? AND status = 'pending'`)
    .bind(body.decision, now, user.email, note, id)];

  if (body.decision === "approved" && contribution.submission_type === "new_record") {
    statements.push(DB.prepare(`INSERT INTO public_records (
      id, record_type, name, category, description, latitude, longitude,
      photo_key, source_submission_id, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`)
      .bind(crypto.randomUUID(), contribution.record_type, contribution.item_name,
        contribution.category, contribution.description, contribution.latitude,
        contribution.longitude, contribution.photo_key, id, now, now));
  }

  await DB.batch(statements);
  return Response.json({ ok: true, status: body.decision });
}
