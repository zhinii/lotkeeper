import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureCommunitySchema, getBindings } from "../../../db/runtime";

const allowedRecordTypes = new Set(["place", "asset", "stock", "loose_material"]);
const allowedContactMethods = new Set(["phone", "email", "assigned_username"]);

function textValue(form: FormData, key: string, limit: number) {
  return String(form.get(key) || "").trim().slice(0, limit);
}

function finiteNumber(form: FormData, key: string) {
  const value = Number(form.get(key));
  return Number.isFinite(value) ? value : null;
}

export async function POST(request: Request) {
  await ensureCommunitySchema();
  const form = await request.formData();
  if (textValue(form, "website", 100)) return Response.json({ ok: true });

  const submissionType = textValue(form, "submissionType", 30);
  const recordType = textValue(form, "recordType", 30);
  const itemName = textValue(form, "itemName", 140);
  const category = textValue(form, "category", 80);
  const description = textValue(form, "description", 1500);
  const contactName = textValue(form, "contactName", 100);
  const contactMethod = textValue(form, "contactMethod", 30);
  const contactValue = textValue(form, "contactValue", 160);
  const latitude = finiteNumber(form, "latitude");
  const longitude = finiteNumber(form, "longitude");
  const gpsLatitude = finiteNumber(form, "gpsLatitude");
  const gpsLongitude = finiteNumber(form, "gpsLongitude");
  const gpsAccuracy = finiteNumber(form, "gpsAccuracy");
  const quantity = finiteNumber(form, "quantity");
  const quantityUnit = textValue(form, "quantityUnit", 40);
  const photo = form.get("photo");

  if (!["new_record", "stock_change"].includes(submissionType))
    return Response.json({ error: "Choose what you are reporting." }, { status: 400 });
  if (!allowedRecordTypes.has(recordType))
    return Response.json({ error: "Choose a valid record type." }, { status: 400 });
  if (!itemName || !category || !contactName || !contactValue)
    return Response.json({ error: "Complete the required description and contact fields." }, { status: 400 });
  if (!allowedContactMethods.has(contactMethod))
    return Response.json({ error: "Choose a valid contact method." }, { status: 400 });
  if (latitude === null || longitude === null || gpsLatitude === null || gpsLongitude === null)
    return Response.json({ error: "Capture GPS and confirm the pin before submitting." }, { status: 400 });
  if (Math.abs(latitude) > 90 || Math.abs(gpsLatitude) > 90 || Math.abs(longitude) > 180 || Math.abs(gpsLongitude) > 180)
    return Response.json({ error: "The submitted coordinates are invalid." }, { status: 400 });
  if (submissionType === "stock_change" && (!quantity || quantity <= 0 || !quantityUnit))
    return Response.json({ error: "Enter how much was used or removed and its unit." }, { status: 400 });
  if (!(photo instanceof File) || !photo.type.startsWith("image/") || photo.size === 0)
    return Response.json({ error: "Take or choose a photograph." }, { status: 400 });
  if (photo.size > 10 * 1024 * 1024)
    return Response.json({ error: "The photograph must be smaller than 10 MB." }, { status: 400 });

  const id = crypto.randomUUID();
  const photoKey = `contribution-${id}`;
  const now = Date.now();
  const { DB, MEDIA } = getBindings();
  await MEDIA.put(photoKey, photo.stream(), {
    httpMetadata: { contentType: photo.type },
    customMetadata: { submissionId: id },
  });

  try {
    await DB.prepare(`INSERT INTO contributions (
      id, submission_type, record_type, item_name, category, description,
      quantity, quantity_unit, latitude, longitude, gps_latitude, gps_longitude,
      gps_accuracy, contact_name, contact_method, contact_value, photo_key,
      photo_content_type, status, submitted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .bind(id, submissionType, recordType, itemName, category, description || null,
        quantity, quantityUnit || null, latitude, longitude, gpsLatitude,
        gpsLongitude, gpsAccuracy, contactName, contactMethod, contactValue,
        photoKey, photo.type, now).run();
  } catch (error) {
    await MEDIA.delete(photoKey);
    throw error;
  }

  return Response.json({ ok: true, id, status: "pending" }, { status: 201 });
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  await ensureCommunitySchema();
  const result = await getBindings().DB.prepare(`SELECT id,
    submission_type AS submissionType, record_type AS recordType,
    item_name AS itemName, category, description, quantity,
    quantity_unit AS quantityUnit, latitude, longitude,
    gps_accuracy AS gpsAccuracy, contact_name AS contactName,
    contact_method AS contactMethod, contact_value AS contactValue,
    photo_key AS photoKey, status, submitted_at AS submittedAt,
    moderated_at AS moderatedAt, moderated_by AS moderatedBy,
    moderation_note AS moderationNote
    FROM contributions ORDER BY
      CASE status WHEN 'pending' THEN 0 ELSE 1 END, submitted_at DESC
    LIMIT 250`).all();
  return Response.json({ contributions: result.results });
}
