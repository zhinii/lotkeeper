import { useEffect, useMemo, useState } from "react";
import { gps as readGps, parse as readExif } from "exifr";
import MapView from "../components/MapView";
import {
  commercialCaptureFields,
  commercialCaptureKeys,
  emptyCommercialCaptureData,
  type CommercialCaptureKey,
} from "../lib/captureFields";
import { navigate } from "../lib/route";
import { publicPhoto, requireSupabase } from "../lib/supabase";
import type {
  CollectionDefinition,
  LocationSource,
  Organization,
  RecordItem,
  Submission,
} from "../types";

type Point = {
  lat: number;
  lng: number;
  accuracy: number | null;
  source: LocationSource;
};

type AnalysisState = "idle" | "analyzing" | "complete" | "unavailable";

type EnrichmentResponse = {
  status?: string;
  suggestions?: Submission["ai_suggestions"];
  description_applied?: boolean;
};

function localDateTime(isoDate: string | null) {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

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
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [commercialData, setCommercialData] = useState(() =>
    emptyCommercialCaptureData(),
  );
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [photoTakenAt, setPhotoTakenAt] = useState<string | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submittedDescription, setSubmittedDescription] = useState("");
  const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
  const [aiSuggestions, setAiSuggestions] = useState<
    Submission["ai_suggestions"] | null
  >(null);
  const [aiDescriptionApplied, setAiDescriptionApplied] = useState(false);

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
          const { data: privateRow } = await client
            .from("record_private_data")
            .select("data")
            .eq("record_id", recordId)
            .maybeSingle();
          const item = {
            ...(data as RecordItem),
            data: {
              ...(data as RecordItem).data,
              ...((privateRow?.data as Record<string, unknown>) || {}),
            },
          };
          setTarget(item);
          setCollectionId(item.collection_id);
          setName(item.name);
          setDescription(item.description);
          setQuantity(item.quantity === null ? "1" : String(item.quantity));
          setUnit(item.unit || "");
          setPhotoTakenAt(item.photo_taken_at);
          setCommercialData(
            (current) =>
              Object.fromEntries(
                commercialCaptureFields.map((field) => [
                  field.key,
                  item.data[field.key] == null
                    ? current[field.key]
                    : String(item.data[field.key]),
                ]),
              ) as Record<CommercialCaptureKey, string>,
          );
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
    const fileDate = new Date(file.lastModified);
    setPhotoTakenAt(
      captured instanceof Date && !Number.isNaN(captured.getTime())
        ? captured.toISOString()
        : file.lastModified > 0 && !Number.isNaN(fileDate.getTime())
          ? fileDate.toISOString()
          : new Date().toISOString(),
    );
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
    const client = requireSupabase();
    try {
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
      const configurableData = Object.fromEntries(
        collection.fields
          .filter(
            (field) =>
              (field.publicSubmit || organization.mode === "commercial") &&
              !commercialCaptureKeys.has(field.key),
          )
          .map((field) => [field.key, form.get(`field-${field.key}`)]),
      );
      const data = {
        ...configurableData,
        ...(organization.mode === "commercial" ? commercialData : {}),
      };
      const { data: user } = await client.auth.getUser();
      const proposed = {
        name: name.trim(),
        description: description.trim(),
        data,
        collection_id: collection.id,
        quantity: quantity !== "" ? Number(quantity) : null,
        unit: organization.mode === "commercial" ? unit.trim() || null : null,
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
      setSubmittedDescription(description.trim());
      setSubmitted(true);
      setSending(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Submission failed.");
      setSending(false);
      return;
    }

    if (organization.ai_enabled && photo) {
      setAnalysisState("analyzing");
      try {
        const { data: enrichment, error } = await client.functions.invoke(
          "enrich-submission",
          { body: { submission_id: id } },
        );
        if (error) throw error;
        const result = enrichment as EnrichmentResponse | null;
        if (result?.status === "complete" && result.suggestions) {
          setAiSuggestions(result.suggestions);
          setAiDescriptionApplied(Boolean(result.description_applied));
          setAnalysisState("complete");
        } else setAnalysisState("unavailable");
      } catch {
        setAnalysisState("unavailable");
      }
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
  if (submitted)
    return (
      <div className="submission-page">
        <header className="topbar">
          <div className="brand-button">
            <b>LOTKEEPER</b>
            <span>{organization.name}</span>
          </div>
        </header>
        <main className="submission-complete">
          <section className="submitted-card">
            <span className="submitted-check" aria-hidden="true">
              ✓
            </span>
            <small>SUBMITTED</small>
            <h1>Your submission is in review</h1>
            <p>
              It will not appear publicly until an administrator approves it.
              You do not need to submit it again.
            </p>
            {preview && <img src={preview} alt="Submitted" />}
            <dl>
              <div>
                <dt>Item</dt>
                <dd>{name}</dd>
              </div>
              <div>
                <dt>Description sent for review</dt>
                <dd>
                  {submittedDescription ||
                    (aiDescriptionApplied
                      ? aiSuggestions?.description
                      : analysisState === "analyzing"
                        ? "Waiting for photo suggestions"
                        : "No description was provided")}
                </dd>
              </div>
              <div>
                <dt>GPS coordinates</dt>
                <dd>
                  {point
                    ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`
                    : "Recorded"}
                </dd>
              </div>
            </dl>
          </section>

          {analysisState === "analyzing" && (
            <section className="submitter-ai-card analyzing" aria-live="polite">
              <span className="ai-spinner" aria-hidden="true" />
              <div>
                <small>PHOTO SUGGESTIONS</small>
                <h2>Looking at the image…</h2>
                <p>This normally takes a few seconds.</p>
              </div>
            </section>
          )}
          {analysisState === "complete" && aiSuggestions && (
            <section className="submitter-ai-card" aria-live="polite">
              <small>AI PHOTO SUGGESTIONS</small>
              <h2>{aiSuggestions.category || "Suggested details"}</h2>
              <p>{aiSuggestions.description}</p>
              {aiDescriptionApplied && (
                <b className="ai-applied-note">
                  This description was added to your submission for review.
                </b>
              )}
              {!!aiSuggestions.keywords?.length && (
                <div className="suggestion-keywords">
                  {aiSuggestions.keywords.map((keyword) => (
                    <span key={keyword}>{keyword}</span>
                  ))}
                </div>
              )}
              <small>
                These are suggestions only. The administrator will verify them.
              </small>
            </section>
          )}
          {analysisState === "unavailable" && (
            <section
              className="submitter-ai-card unavailable"
              aria-live="polite"
            >
              <small>PHOTO SUGGESTIONS</small>
              <h2>Suggestions were not available</h2>
              <p>
                Your submission was still received and can be reviewed normally.
              </p>
            </section>
          )}
          <button
            className="return-to-place"
            onClick={() => navigate(`org/${organization.slug}`)}
          >
            Return to {organization.name}
          </button>
        </main>
      </div>
    );
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
              Item name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={140}
              />
            </label>
            <label>
              Description{organization.ai_enabled ? " (optional)" : ""}
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={4}
                required={!organization.ai_enabled || !photo}
                maxLength={2000}
                placeholder={
                  organization.ai_enabled
                    ? "Add any helpful details."
                    : "Describe what is shown."
                }
              />
              {organization.ai_enabled && (
                <small className="field-helper">
                  Optional. If left blank, a description will be filled in
                  automatically from the photo.
                </small>
              )}
            </label>
            {organization.mode === "civic" && (
              <label>
                Quantity
                <input
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  type="number"
                  min="0"
                  step="any"
                  required
                />
              </label>
            )}
            {organization.mode === "commercial" && (
              <fieldset className="inventory-capture-fields">
                <legend>Inventory details</legend>
                <p>
                  These identify the item. Quantity can be updated later without
                  taking another photo.
                </p>
                {commercialCaptureFields.map((field) => (
                  <label key={field.key}>
                    {field.label}
                    <input
                      value={commercialData[field.key]}
                      onChange={(event) =>
                        setCommercialData((current) => ({
                          ...current,
                          [field.key]: event.target.value,
                        }))
                      }
                      placeholder={field.placeholder}
                      required={field.required}
                    />
                  </label>
                ))}
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
              </fieldset>
            )}
            {collection?.fields
              .filter(
                (field) =>
                  (field.publicSubmit || organization.mode === "commercial") &&
                  !commercialCaptureKeys.has(field.key),
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
                <div className="selected-photo-preview">
                  <img src={preview} alt="Selected" />
                  <strong>Tap to change photo</strong>
                </div>
              ) : target?.photo_path ? (
                <div className="selected-photo-preview">
                  <img src={publicPhoto(target.photo_path)} alt="Current" />
                  <strong>Tap to replace this photo</strong>
                </div>
              ) : (
                <div className="photo-picker-copy">
                  <span className="photo-add-icon" aria-hidden="true">
                    +
                  </span>
                  <b>Take or upload a photo</b>
                  <small>
                    Tap here to open the camera or choose an image from your
                    device.
                  </small>
                  <strong>Choose photo</strong>
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
            <label className="capture-date-field">
              Date of capture
              <input
                type="datetime-local"
                value={localDateTime(photoTakenAt)}
                onChange={(event) =>
                  setPhotoTakenAt(
                    event.target.value
                      ? new Date(event.target.value).toISOString()
                      : null,
                  )
                }
                required={!recordId || Boolean(photo)}
              />
              <small>
                Filled from the photo when available. Adjust it if the date is
                incorrect.
              </small>
            </label>
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
            <div className="coordinate-readout">
              <span>GPS coordinates</span>
              <code>
                {point
                  ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`
                  : "Location required"}
              </code>
            </div>
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
