import { useEffect, useMemo, useState } from "react";
import { gps as readGps, parse as readExif } from "exifr";
import MapView from "../components/MapView";
import { navigate } from "../lib/route";
import { publicPhoto, requireSupabase } from "../lib/supabase";
import type {
  CollectionDefinition,
  LocationSource,
  Organization,
  RecordItem,
} from "../types";

type Point = {
  lat: number;
  lng: number;
  accuracy: number | null;
  source: LocationSource;
};

export default function SubmitPage({
  slug,
  recordId,
}: {
  slug: string;
  recordId: string | null;
}) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [target, setTarget] = useState<RecordItem | null>(null);
  const [collectionId, setCollectionId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [photoTakenAt, setPhotoTakenAt] = useState<string | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      const client = requireSupabase();
      const { data: org, error } = await client
        .from("organizations")
        .select("*")
        .eq("slug", slug)
        .single();
      if (error) return setStatus(error.message);
      const organizationData = org as Organization;
      setOrganization(organizationData);
      const first = organizationData.collections.find(
        (item) => organizationData.mode === "commercial" || item.publicSubmit,
      );
      setCollectionId(first?.id || "");
      if (recordId) {
        const { data } = await client
          .from("records")
          .select("*")
          .eq("id", recordId)
          .single();
        if (data) {
          const item = data as RecordItem;
          setTarget(item);
          setCollectionId(item.collection_id);
          setName(item.name);
          setDescription(item.description);
          setQuantity(item.quantity === null ? "" : String(item.quantity));
          setUnit(item.unit || "");
          setPoint({
            lat: item.latitude,
            lng: item.longitude,
            accuracy: null,
            source: item.location_source,
          });
        }
      }
    })();
  }, [slug, recordId]);
  useEffect(() => {
    if (!photo) return setPreview("");
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const collections = useMemo(
    () =>
      organization?.collections.filter(
        (item) => organization.mode === "commercial" || item.publicSubmit,
      ) || [],
    [organization],
  );
  const collection =
    collections.find((item) => item.id === collectionId) || null;

  async function selectPhoto(file: File | null) {
    setPhoto(file);
    setPhotoTakenAt(null);
    if (!file) return;
    setStatus("Reading photo date and GPS…");
    const [coordinates, metadata] = await Promise.all([
      readGps(file).catch(() => null),
      readExif(file, ["DateTimeOriginal", "CreateDate"]).catch(() => null),
    ]);
    const captured = metadata?.DateTimeOriginal || metadata?.CreateDate;
    if (captured instanceof Date && !Number.isNaN(captured.getTime()))
      setPhotoTakenAt(captured.toISOString());
    if (coordinates?.latitude != null && coordinates?.longitude != null) {
      setPoint({
        lat: coordinates.latitude,
        lng: coordinates.longitude,
        accuracy: null,
        source: "photo_exif",
      });
      setStatus("Photo GPS found. Confirm or adjust the pin.");
    } else
      setStatus(
        "No photo GPS found. Capture current GPS or place the pin manually.",
      );
  }

  function locate() {
    navigator.geolocation?.getCurrentPosition(
      ({ coords }) => {
        setPoint({
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
          source: "browser_gps",
        });
        setStatus(
          `Current GPS captured (approximately ±${Math.round(coords.accuracy)} m).`,
        );
      },
      () =>
        setStatus(
          "Current GPS was unavailable. Place the pin manually on the map.",
        ),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization || !collection || !point)
      return setStatus("A mapped location is required.");
    if (!recordId && !photo)
      return setStatus("A photo is required for a new record.");
    setSending(true);
    const form = new FormData(event.currentTarget);
    const id = crypto.randomUUID();
    let photoPath: string | null = null;
    try {
      const client = requireSupabase();
      if (photo) {
        const extension =
          photo.name
            .split(".")
            .pop()
            ?.replace(/[^a-z0-9]/gi, "") || "jpg";
        photoPath = `${organization.id}/${id}.${extension}`;
        const { error } = await client.storage
          .from("submission-media")
          .upload(photoPath, photo, { contentType: photo.type, upsert: false });
        if (error) throw error;
      }
      const data = Object.fromEntries(
        collection.fields
          .filter(
            (field) => field.publicSubmit || organization.mode === "commercial",
          )
          .map((field) => [field.key, form.get(`field-${field.key}`)]),
      );
      const { data: user } = await client.auth.getUser();
      const proposed = {
        name: name.trim(),
        description: description.trim(),
        data,
        collection_id: collection.id,
        quantity:
          collection.kind === "consumable" && quantity !== ""
            ? Number(quantity)
            : null,
        unit: collection.kind === "consumable" ? unit.trim() || null : null,
        latitude: point.lat,
        longitude: point.lng,
        location_source: point.source,
        photo_taken_at: photoTakenAt,
      };
      const { error } = await client.from("submissions").insert({
        id,
        organization_id: organization.id,
        submission_type: recordId ? "update" : "new",
        target_record_id: recordId,
        collection_id: collection.id,
        proposed,
        photo_path: photoPath,
        latitude: point.lat,
        longitude: point.lng,
        location_source: point.source,
        gps_accuracy: point.accuracy,
        photo_taken_at: photoTakenAt,
        submitted_by: user.user?.id || null,
        status: "pending",
        ai_status:
          organization.ai_enabled && photo ? "queued" : "not_requested",
      });
      if (error) throw error;
      if (organization.ai_enabled && photo)
        client.functions
          .invoke("enrich-submission", { body: { submission_id: id } })
          .catch(() => undefined);
      setStatus(
        "Submitted for administrator review. The current public record remains unchanged until approval.",
      );
      setSending(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Submission failed.");
      setSending(false);
    }
  }

  if (!organization)
    return (
      <div className="loading">
        Loading submission form… <small>{status}</small>
      </div>
    );
  const mapLat = point?.lat ?? organization.center_lat;
  const mapLng = point?.lng ?? organization.center_lng;
  return (
    <div className="submission-page">
      <header className="topbar">
        <button
          className="brand-button"
          onClick={() => navigate(`org/${organization.slug}`)}
        >
          <b>LOTKEEPER</b>
          <span>{organization.name}</span>
        </button>
        <button onClick={() => navigate(`org/${organization.slug}`)}>
          Cancel
        </button>
      </header>
      <main className="submission-wrap">
        <div className="form-title">
          <small>
            {recordId ? "PROPOSE AN UPDATE" : "NEW MAPPED SUBMISSION"}
          </small>
          <h1>
            {recordId
              ? `Update ${target?.name || "record"}`
              : "Photograph it. Pin it. Describe it."}
          </h1>
          <p>
            {organization.mode === "civic"
              ? "No account or name is required. Every change is reviewed before it becomes public."
              : "Your signed-in account and all inventory changes are recorded."}
          </p>
        </div>
        <form onSubmit={submit}>
          <section>
            <h2>
              <span>1</span>Describe it
            </h2>
            <label>
              Collection
              <select
                value={collectionId}
                onChange={(event) => setCollectionId(event.target.value)}
              >
                {collections.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={140}
              />
            </label>
            <label>
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                required
                maxLength={2000}
              />
            </label>
            {collection?.kind === "consumable" && (
              <div className="field-pair">
                <label>
                  Current quantity
                  <input
                    value={quantity}
                    onChange={(event) => setQuantity(event.target.value)}
                    type="number"
                    min="0"
                    step="any"
                    required
                  />
                </label>
                <label>
                  Unit
                  <input
                    value={unit}
                    onChange={(event) => setUnit(event.target.value)}
                    placeholder="pieces, feet, cases"
                    required
                  />
                </label>
              </div>
            )}
            {collection?.fields
              .filter(
                (field) =>
                  field.publicSubmit || organization.mode === "commercial",
              )
              .map((field) => (
                <label key={field.key}>
                  {field.label}
                  <input
                    name={`field-${field.key}`}
                    type={field.type === "boolean" ? "checkbox" : field.type}
                    required={field.required}
                  />
                </label>
              ))}
          </section>
          <section>
            <h2>
              <span>2</span>
              {recordId ? "Update the photo (optional)" : "Add a current photo"}
            </h2>
            <label className="photo-picker">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                required={!recordId}
                onChange={(event) =>
                  selectPhoto(event.target.files?.[0] || null)
                }
              />
              {preview ? (
                <img src={preview} alt="Selected" />
              ) : target?.photo_path ? (
                <img src={publicPhoto(target.photo_path)} alt="Current" />
              ) : (
                <div>
                  <b>Open camera or choose photo</b>
                  <small>GPS and capture date are read when available.</small>
                </div>
              )}
            </label>
            {photo && (
              <div className="metadata-line">
                <b>
                  {point?.source === "photo_exif"
                    ? "Photo GPS found"
                    : "Photo GPS not found"}
                </b>
                <span>
                  {photoTakenAt
                    ? new Date(photoTakenAt).toLocaleString()
                    : "Capture date unavailable"}
                </span>
              </div>
            )}
          </section>
          <section>
            <h2>
              <span>3</span>Confirm the location
            </h2>
            <div className="location-toolbar">
              <button type="button" onClick={locate}>
                Use current GPS
              </button>
              <span>
                {point
                  ? point.source.replaceAll("_", " ")
                  : "Click the map to place a manual pin"}
              </span>
            </div>
            <MapView
              latitude={mapLat}
              longitude={mapLng}
              zoom={point ? 18 : organization.map_zoom}
              picker
              compact
              onPick={(lat, lng) =>
                setPoint({ lat, lng, accuracy: null, source: "manual_pin" })
              }
            />
            <code>
              {point
                ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`
                : "Location required"}
            </code>
          </section>
          <section className="submit-action">
            <h2>
              <span>4</span>Submit for review
            </h2>
            <p>
              Submission time, photo date, GPS source and proposed changes are
              retained in the audit history.
            </p>
            <button disabled={sending || !point || (!recordId && !photo)}>
              {sending ? "Submitting…" : "Submit for administrator review"}
            </button>
            <p className="notice" aria-live="polite">
              {status}
            </p>
          </section>
        </form>
      </main>
    </div>
  );
}
