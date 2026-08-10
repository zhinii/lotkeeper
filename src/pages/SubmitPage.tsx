import { useEffect, useMemo, useRef, useState } from "react";
import { gps as readGps, parse as readExif } from "exifr";
import MapView from "../components/MapView";
import PhotoCropper, {
  cropPhoto,
  defaultCrop,
  type CropSelection,
} from "../components/PhotoCropper";
import {
  commercialCaptureFields,
  commercialCaptureKeys,
  customCollectionFields,
  emptyCommercialCaptureData,
  inventoryCaptureFields,
  inventoryFieldRequired,
  type CommercialCaptureKey,
} from "../lib/captureFields";
import { navigate } from "../lib/route";
import { publicPhoto, requireSupabase } from "../lib/supabase";
import type {
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

type SubmissionStep = "photo" | "crop" | "review" | "complete";
type AnalysisState = "idle" | "analyzing" | "complete" | "unavailable";

type EnrichmentResponse = {
  status?: string;
  suggestions?: Submission["ai_suggestions"];
};

type PreparedPhoto = {
  upload: File;
  analysisDataUrl: string;
  originalBytes: number;
  uploadBytes: number;
};

function localDateTime(isoDate: string | null) {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function browserLocation(): Promise<Point | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
          source: "browser_gps",
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });
}

function fileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function prepareSubmissionPhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file);
  const maximum = 1920;
  const ratio = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot prepare the photo.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const uploadBlob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("Photo preparation failed.")),
      "image/jpeg",
      0.8,
    ),
  );
  const analysisMaximum = 1280;
  const analysisRatio = Math.min(
    1,
    analysisMaximum / Math.max(canvas.width, canvas.height),
  );
  const analysisCanvas = document.createElement("canvas");
  analysisCanvas.width = Math.max(1, Math.round(canvas.width * analysisRatio));
  analysisCanvas.height = Math.max(
    1,
    Math.round(canvas.height * analysisRatio),
  );
  analysisCanvas
    .getContext("2d")
    ?.drawImage(canvas, 0, 0, analysisCanvas.width, analysisCanvas.height);
  const analysisBlob = await new Promise<Blob>((resolve, reject) =>
    analysisCanvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error("AI photo preparation failed.")),
      "image/jpeg",
      0.74,
    ),
  );
  const baseName = file.name.replace(/\.[^.]+$/, "") || "material-pin-photo";
  return {
    upload: new File([uploadBlob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    }),
    analysisDataUrl: await fileAsDataUrl(analysisBlob),
    originalBytes: file.size,
    uploadBytes: uploadBlob.size,
  };
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M15 11h6l3-4h8l3 4h4a5 5 0 0 1 5 5v22a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V16a5 5 0 0 1 5-5h6Zm9 26a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-5a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z" />
    </svg>
  );
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
  const [step, setStep] = useState<SubmissionStep>("photo");
  const [collectionId, setCollectionId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [keywords, setKeywords] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [commercialData, setCommercialData] = useState(() =>
    emptyCommercialCaptureData(),
  );
  const [customData, setCustomData] = useState<Record<string, string>>({});
  const [sourcePhoto, setSourcePhoto] = useState<File | null>(null);
  const [crop, setCrop] = useState<CropSelection>(defaultCrop);
  const [cropReady, setCropReady] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preparedPhoto, setPreparedPhoto] = useState<PreparedPhoto | null>(
    null,
  );
  const [preview, setPreview] = useState("");
  const [photoTakenAt, setPhotoTakenAt] = useState<string | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [publicVisible, setPublicVisible] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
  const [aiSuggestions, setAiSuggestions] = useState<
    Submission["ai_suggestions"] | null
  >(null);
  const metadataPromise = useRef<Promise<Point | null> | null>(null);

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
      const { data: user } = await client.auth.getUser();
      if (!user.user) {
        setStatus("Employee sign-in is required to add or update items.");
        return;
      }
      const { data: memberships } = await client
        .from("organization_members")
        .select("organization_id")
        .eq("organization_id", organizationData.id);
      if (!memberships?.length) {
        setStatus("Your account is not assigned to this organization.");
        return;
      }
      setIsMember(true);
      const first = organizationData.collections[0];
      setCollectionId(first?.id || "");

      if (!recordId) return;
      const { data } = await client
        .from("records")
        .select("*")
        .eq("id", recordId)
        .single();
      if (!data) return;
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
      setCategory(item.category);
      setKeywords(item.keywords.join(", "));
      setQuantity(item.quantity === null ? "1" : String(item.quantity));
      setUnit(item.unit || "");
      setPublicVisible(item.public_visible);
      setPhotoTakenAt(item.photo_taken_at);
      setCustomData(
        Object.fromEntries(
          Object.entries(item.data).map(([key, value]) => [
            key,
            value == null ? "" : String(value),
          ]),
        ),
      );
      setCommercialData(
        Object.fromEntries(
          commercialCaptureFields.map((field) => [
            field.key,
            item.data[field.key] == null ? "" : String(item.data[field.key]),
          ]),
        ) as Record<CommercialCaptureKey, string>,
      );
      setPoint({
        lat: item.latitude,
        lng: item.longitude,
        accuracy: null,
        source: item.location_source,
      });
    })();
  }, [slug, recordId]);

  useEffect(() => {
    if (!photo) return setPreview("");
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const collections = useMemo(
    () => organization?.collections || [],
    [organization],
  );
  const collection =
    collections.find((item) => item.id === collectionId) || null;

  function applySuggestions(suggestions: Submission["ai_suggestions"]) {
    setAiSuggestions(suggestions);
    if (suggestions.collection_id) {
      const suggestedCollection = collections.find(
        (item) => item.id === suggestions.collection_id,
      );
      if (suggestedCollection) setCollectionId(suggestedCollection.id);
    }
    if (suggestions.name) setName(suggestions.name);
    if (suggestions.description) setDescription(suggestions.description);
    if (suggestions.category) setCategory(suggestions.category);
    if (suggestions.quantity && Number.isFinite(Number(suggestions.quantity)))
      setQuantity(suggestions.quantity);
    if (suggestions.unit) setUnit(suggestions.unit);
    if (suggestions.keywords?.length)
      setKeywords(suggestions.keywords.join(", "));
    for (const field of suggestions.fields || []) {
      if (commercialCaptureKeys.has(field.key as CommercialCaptureKey)) {
        setCommercialData((current) => ({
          ...current,
          [field.key]: field.value,
        }));
      } else {
        setCustomData((current) => ({
          ...current,
          [field.key]: field.value,
        }));
      }
    }
  }

  async function analyzeSelectedPhoto(imageDataUrl: string) {
    if (!organization?.ai_enabled) return;
    setAnalysisState("analyzing");
    try {
      const { data, error } = await requireSupabase().functions.invoke(
        "enrich-submission",
        {
          body: {
            organization_id: organization.id,
            image_data_url: imageDataUrl,
          },
        },
      );
      if (error) throw error;
      const result = data as EnrichmentResponse | null;
      if (result?.status !== "complete" || !result.suggestions)
        throw new Error("Suggestions were unavailable.");
      applySuggestions(result.suggestions);
      setAnalysisState("complete");
    } catch {
      setAnalysisState("unavailable");
    }
  }

  async function readPhotoLocation(file: File) {
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
      const exifPoint: Point = {
        lat: coordinates.latitude,
        lng: coordinates.longitude,
        accuracy: null,
        source: "photo_exif",
      };
      setPoint(exifPoint);
      return exifPoint;
    }
    const current = await browserLocation();
    if (current) setPoint(current);
    return current;
  }

  function selectPhoto(file: File | null) {
    if (!file || !organization) return;
    setSourcePhoto(file);
    setCrop(defaultCrop);
    setCropReady(false);
    setPhoto(null);
    setPreparedPhoto(null);
    setPhotoTakenAt(null);
    setPoint(null);
    setAiSuggestions(null);
    setAnalysisState("idle");
    setPreparing(false);
    setStatus("Crop the photo so the item is clear.");
    metadataPromise.current = readPhotoLocation(file);
    setStep("crop");
  }

  async function confirmCrop() {
    if (!sourcePhoto || !organization) return;
    setPreparing(true);
    setStatus("Cropping and preparing the photo...");
    let file: File;
    try {
      file = await cropPhoto(sourcePhoto, crop);
    } catch {
      setPreparing(false);
      setStep("crop");
      setStatus("This photo could not be cropped. Try another photo.");
      return;
    }
    setPhoto(file);
    setPreparedPhoto(null);
    setAiSuggestions(null);
    setAnalysisState("idle");
    setStatus("Preparing a smaller photo…");

    const metadataTask = metadataPromise.current || Promise.resolve(null);

    const analysisTask = prepareSubmissionPhoto(file).then(async (prepared) => {
      setPreparedPhoto(prepared);
      await analyzeSelectedPhoto(prepared.analysisDataUrl);
    });
    let mapped: Point | null;
    try {
      [mapped] = await Promise.all([metadataTask, analysisTask]);
    } catch {
      setPreparing(false);
      setAnalysisState("unavailable");
      setStatus(
        "This photo could not be prepared. Try taking another photo or choose a JPEG, PNG or WebP image.",
      );
      return;
    }
    setStatus(
      mapped
        ? mapped.source === "photo_exif"
          ? "Photo location found. Review the pin before submitting."
          : "Current location captured. Review the pin before submitting."
        : "No location was found. Tap the map to place the pin.",
    );
    setPreparing(false);
    setStep("review");
  }

  async function locate() {
    setStatus("Getting your current location…");
    const current = await browserLocation();
    if (current) {
      setPoint(current);
      setStatus(
        `Current location captured (approximately ±${Math.round(current.accuracy || 0)} m).`,
      );
    } else {
      setStatus(
        "Current location was unavailable. Tap the map to place the pin.",
      );
    }
  }

  function reviewExisting() {
    if (!recordId || !target) return;
    setAnalysisState("idle");
    setStep("review");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization || !collection || !point)
      return setStatus("Place the item on the map before submitting.");
    if (!recordId && !photo)
      return setStatus("Take or choose a photo before submitting.");
    if (photo && !preparedPhoto)
      return setStatus(
        "Wait for the photo to finish preparing before submitting.",
      );

    setSending(true);
    setStatus(photo ? "Uploading the optimized photo…" : "Saving the update…");
    const id = crypto.randomUUID();
    let photoPath: string | null = null;
    const client = requireSupabase();
    try {
      if (photo) {
        photoPath = `${organization.id}/${id}.jpg`;
        const { error } = await client.storage
          .from("submission-media")
          .upload(photoPath, preparedPhoto!.upload, {
            contentType: "image/jpeg",
            upsert: false,
          });
        if (error) throw error;
        setStatus("Saving the item details…");
      }

      const configurableData = Object.fromEntries(
        customCollectionFields(collection).map((field) => [
          field.key,
          customData[field.key] || "",
        ]),
      );
      const data = {
        ...configurableData,
        ...commercialData,
      };
      const confirmedKeywords = keywords
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 16);
      const confirmedSuggestions = {
        ...(aiSuggestions || {}),
        name: name.trim(),
        collection_id: collection.id,
        description: description.trim(),
        category: category.trim() || collection.name,
        keywords: confirmedKeywords,
      };
      const { data: user } = await client.auth.getUser();
      const proposed = {
        name: name.trim(),
        description: description.trim(),
        category: category.trim() || collection.name,
        keywords: confirmedKeywords,
        data,
        collection_id: collection.id,
        quantity:
          collection.kind !== "place" && quantity !== ""
            ? Number(quantity)
            : null,
        unit: collection.kind !== "place" ? unit.trim() || null : null,
        public_visible: publicVisible,
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
          analysisState === "complete"
            ? "complete"
            : organization.ai_enabled && photo
              ? "failed"
              : "not_requested",
        ai_suggestions: confirmedSuggestions,
      });
      if (error) throw error;
      setStep("complete");
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Submission failed.");
    } finally {
      setSending(false);
    }
  }

  if (!organization)
    return (
      <div className="loading">
        Loading photo capture… <small>{status}</small>
      </div>
    );

  if (!isMember)
    return (
      <main className="access-page">
        <button className="access-back" onClick={() => navigate(`org/${slug}`)}>
          ← Public site
        </button>
        <section className="access-card">
          <div className="brand">MATERIAL PIN</div>
          <small>EMPLOYEE ACCESS REQUIRED</small>
          <h1>Sign in before changing this map</h1>
          <p>{status || "Only assigned employees can add or update items."}</p>
          <button onClick={() => navigate("staff")}>Employee sign in</button>
        </section>
      </main>
    );

  const mapLat = point?.lat ?? organization.center_lat;
  const mapLng = point?.lng ?? organization.center_lng;
  const displayPhoto =
    preview || (target?.photo_path ? publicPhoto(target.photo_path) : "");

  if (step === "complete")
    return (
      <div className="submission-page submission-flow-page">
        <header className="topbar submission-topbar">
          <div className="brand-button">
            <b>MATERIAL PIN</b>
            <span>{organization.name}</span>
          </div>
        </header>
        <main className="submission-complete">
          <section className="submitted-card">
            <span className="submitted-check" aria-hidden="true">
              ✓
            </span>
            <small>SUBMITTED</small>
            <h1>Your photo is in review</h1>
            <p>
              An administrator will verify it before it appears publicly. You do
              not need to submit it again.
            </p>
            {displayPhoto && <img src={displayPhoto} alt="Submitted" />}
            <dl>
              <div>
                <dt>Item</dt>
                <dd>{name}</dd>
              </div>
              <div>
                <dt>Collection</dt>
                <dd>{collection?.name}</dd>
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
          <button
            className="return-to-place"
            onClick={() => navigate(`org/${organization.slug}`)}
          >
            Return to {organization.name}
          </button>
        </main>
      </div>
    );

  if (step === "crop" && sourcePhoto)
    return (
      <div className="submission-page submission-flow-page">
        <header className="topbar submission-topbar">
          <button className="brand-button" onClick={() => setStep("photo")}>
            <b>BACK</b>
            <span>{organization.name}</span>
          </button>
          <button onClick={() => navigate(`org/${organization.slug}`)}>
            Cancel
          </button>
        </header>
        <main className="capture-first crop-step">
          <div className="submission-progress" aria-label="Step 2 of 3">
            <i>✓</i>
            <span />
            <b>2</b>
            <span />
            <i>3</i>
          </div>
          <section className="capture-intro">
            <small>FOCUS THE PHOTO</small>
            <h1>Crop to the item</h1>
            <p>
              Zoom and reposition the photo so the item you are adding is clear.
              Only the area inside the frame will be analyzed and saved.
            </p>
          </section>
          <section className="crop-panel" aria-busy={preparing}>
            <PhotoCropper
              file={sourcePhoto}
              crop={crop}
              onChange={setCrop}
              onReadyChange={setCropReady}
            />
            <div className="crop-step-actions">
              <button type="button" onClick={() => setCrop(defaultCrop)}>
                Reset crop
              </button>
              <button
                type="button"
                className="crop-confirm"
                disabled={preparing || !cropReady}
                onClick={() => void confirmCrop()}
              >
                {preparing ? "Preparing..." : "Use this crop"}
              </button>
            </div>
          </section>
        </main>
      </div>
    );

  if (step === "photo")
    return (
      <div className="submission-page submission-flow-page">
        <header className="topbar submission-topbar">
          <button
            className="brand-button"
            onClick={() => navigate(`org/${organization.slug}`)}
          >
            <b>MATERIAL PIN</b>
            <span>{organization.name}</span>
          </button>
          <button onClick={() => navigate(`org/${organization.slug}`)}>
            Cancel
          </button>
        </header>
        <main className="capture-first">
          <div className="submission-progress" aria-label="Step 1 of 3">
            <b>1</b>
            <span />
            <i>2</i>
            <span />
            <i>3</i>
          </div>
          <section className="capture-intro">
            <small>{recordId ? "UPDATE AN ENTRY" : "ADD TO THE MAP"}</small>
            <h1>
              {recordId ? "Start with a new photo" : "First, take a photo"}
            </h1>
            <p>
              The photo is the starting point. Material Pin will read its date
              and location, then prepare details for you to review.
            </p>
          </section>

          {preparing && displayPhoto ? (
            <section className="photo-preparing" aria-live="polite">
              <img src={displayPhoto} alt="Selected for review" />
              <div>
                <span className="ai-spinner" aria-hidden="true" />
                <small>PREPARING YOUR SUBMISSION</small>
                <h2>
                  {analysisState === "analyzing"
                    ? "Reading the photo and suggesting details…"
                    : "Reading the photo date and location…"}
                </h2>
                <p>Please keep this page open for a moment.</p>
              </div>
            </section>
          ) : (
            <section className="capture-panel">
              {target?.photo_path && (
                <div className="current-record-photo">
                  <img
                    src={publicPhoto(target.photo_path)}
                    alt="Current entry"
                  />
                  <span>Current photo</span>
                </div>
              )}
              <div className="capture-actions">
                <label className="capture-choice primary">
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(event) =>
                      selectPhoto(event.target.files?.[0] || null)
                    }
                  />
                  <CameraIcon />
                  <strong>Take a photo</strong>
                  <small>Open the camera</small>
                </label>
                <label className="capture-choice">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) =>
                      selectPhoto(event.target.files?.[0] || null)
                    }
                  />
                  <span className="upload-icon" aria-hidden="true">
                    ↑
                  </span>
                  <strong>Choose a photo</strong>
                  <small>Use one already on this device</small>
                </label>
              </div>
              {recordId && target && (
                <button
                  className="review-without-photo"
                  onClick={reviewExisting}
                >
                  Review the existing details without a new photo
                </button>
              )}
            </section>
          )}
          <p className="capture-privacy">
            Your signed-in employee account and every inventory change are
            recorded.
          </p>
        </main>
      </div>
    );

  return (
    <div className="submission-page submission-flow-page">
      <header className="topbar submission-topbar">
        <button className="brand-button" onClick={() => setStep("photo")}>
          <b>← PHOTO</b>
          <span>{organization.name}</span>
        </button>
        <button onClick={() => navigate(`org/${organization.slug}`)}>
          Cancel
        </button>
      </header>
      <main className="submission-review">
        <div className="submission-progress" aria-label="Step 3 of 3">
          <i>✓</i>
          <span />
          <i>✓</i>
          <span />
          <b>3</b>
        </div>
        <div className="review-heading">
          <small>REVIEW BEFORE SENDING</small>
          <h1>Check what Material Pin found</h1>
          <p>
            Correct anything that is not right, confirm the pin, then submit.
          </p>
        </div>

        <form onSubmit={submit}>
          <section className="visual-review-grid">
            <div className="review-photo-card">
              {displayPhoto ? (
                <img src={displayPhoto} alt="Photo being submitted" />
              ) : (
                <div className="review-photo-empty">
                  Using the existing photo
                </div>
              )}
              <button type="button" onClick={() => setStep("photo")}>
                {photo ? "Retake or change photo" : "Add a new photo"}
              </button>
              {photo && preparedPhoto && (
                <small className="photo-optimization-note">
                  Optimized for faster upload:{" "}
                  {fileSize(preparedPhoto.originalBytes)} →{" "}
                  {fileSize(preparedPhoto.uploadBytes)}
                </small>
              )}
            </div>
            <div className="review-map-card">
              <div className="review-map-heading">
                <div>
                  <small>LOCATION</small>
                  <strong>
                    {point
                      ? "Pin found—tap the map to adjust"
                      : "Place the pin"}
                  </strong>
                </div>
                <button type="button" onClick={locate}>
                  Use my location
                </button>
              </div>
              <MapView
                latitude={mapLat}
                longitude={mapLng}
                zoom={point ? 18 : organization.map_zoom}
                picker
                compact
                onPick={(lat, lng) => {
                  setPoint({ lat, lng, accuracy: null, source: "manual_pin" });
                  setStatus("Pin adjusted manually.");
                }}
              />
              <div className="coordinate-readout">
                <span>GPS coordinates</span>
                <code>
                  {point
                    ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`
                    : "Location required"}
                </code>
              </div>
            </div>
          </section>

          <section
            className={`review-details-card ${analysisState === "complete" ? "ai-filled" : ""}`}
          >
            <div className="review-card-title">
              <div>
                <small>PHOTO DETAILS</small>
                <h2>Review and edit</h2>
              </div>
              {analysisState === "complete" && <span>Filled from photo</span>}
              {analysisState === "unavailable" && (
                <span className="neutral">AI unavailable—enter details</span>
              )}
            </div>

            <div className="review-field-grid">
              <label>
                Collection
                <select
                  value={collectionId}
                  onChange={(event) => setCollectionId(event.target.value)}
                  required
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
              <label className="wide-field">
                Description
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                  required
                  maxLength={2000}
                />
              </label>
              <label>
                Category
                <input
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  required
                  maxLength={100}
                />
              </label>
              <label className="wide-field">
                Search keywords
                <input
                  value={keywords}
                  onChange={(event) => setKeywords(event.target.value)}
                  placeholder="tree, shade, damaged branch"
                />
                <small>Separate words or short phrases with commas.</small>
              </label>
              <label className="capture-date-field wide-field">
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
                <small>Filled from the photo when available.</small>
              </label>
            </div>

            {collection?.kind !== "place" && (
              <fieldset className="inventory-capture-fields">
                <legend>Inventory details</legend>
                <p>
                  AI fills what it can see. Review the values and complete only
                  the details marked Required.
                </p>
                {inventoryCaptureFields.map((field) => {
                  const required = inventoryFieldRequired(
                    collection,
                    field.key,
                  );
                  return (
                    <label key={field.key}>
                      <span>
                        {field.label}
                        <small>{required ? "Required" : "Optional"}</small>
                      </span>
                      {field.key === "quantity" ? (
                        <input
                          value={quantity}
                          onChange={(event) => setQuantity(event.target.value)}
                          type="number"
                          min="0"
                          step="any"
                          placeholder={field.placeholder}
                          required={required}
                        />
                      ) : field.key === "unit" ? (
                        <input
                          value={unit}
                          onChange={(event) => setUnit(event.target.value)}
                          placeholder={field.placeholder}
                          required={required}
                        />
                      ) : (
                        <input
                          value={commercialData[field.key]}
                          onChange={(event) =>
                            setCommercialData((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))
                          }
                          type={field.type}
                          placeholder={field.placeholder}
                          required={required}
                        />
                      )}
                    </label>
                  );
                })}
              </fieldset>
            )}

            <label className="visibility-choice wide-field">
              <input
                type="checkbox"
                checked={publicVisible}
                onChange={(event) => setPublicVisible(event.target.checked)}
              />
              <span>
                <b>Show this item on the public site</b>
                <small>
                  Turn this off for employee-only inventory, equipment or site
                  information.
                </small>
              </span>
            </label>

            {customCollectionFields(collection).map((field) => (
              <label key={field.key}>
                {field.label}
                {field.type === "boolean" ? (
                  <input
                    checked={customData[field.key] === "true"}
                    onChange={(event) =>
                      setCustomData((current) => ({
                        ...current,
                        [field.key]: String(event.target.checked),
                      }))
                    }
                    type="checkbox"
                    required={field.required}
                  />
                ) : (
                  <input
                    value={customData[field.key] || ""}
                    onChange={(event) =>
                      setCustomData((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                    type={field.type}
                    required={field.required}
                  />
                )}
              </label>
            ))}

            {!!aiSuggestions?.warnings?.length && (
              <p className="ai-review-note">
                Please double-check: {aiSuggestions.warnings.join(" ")}
              </p>
            )}
          </section>

          <section className="review-submit-card">
            <div>
              <h2>Ready to send?</h2>
              <p>An administrator will review this before it is published.</p>
              <p className="notice" aria-live="polite">
                {status}
              </p>
            </div>
            <button disabled={sending || !point || (!recordId && !photo)}>
              {sending ? "Submitting…" : "Submit for review"}
            </button>
          </section>
        </form>
      </main>
    </div>
  );
}
