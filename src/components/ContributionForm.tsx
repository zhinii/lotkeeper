import { FormEvent, useEffect, useState } from "react";
import { db, upload } from "../lib/supabase";
import type { Instance, ModuleKey } from "../types";
import { definitions } from "../lib/modules";
import { gps as readGps, parse as readExif } from "exifr";
import GeoMap from "./GeoMap";

export default function ContributionForm({
  instance,
  navigate,
}: {
  instance: Instance;
  navigate: (route: string) => void;
}) {
  const publicModules = definitions(instance).filter(
    (module) => module.public_submit,
  );
  const [mode, setMode] = useState<"new_record" | "stock_change">("new_record");
  const [type, setType] = useState<ModuleKey>(publicModules[0]?.id || "");
  const [gps, setGps] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
  } | null>(null);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [locationSource, setLocationSource] = useState<
    "photo" | "browser" | "manual" | null
  >(null);
  const [photoTakenAt, setPhotoTakenAt] = useState<string | null>(null);
  useEffect(() => {
    if (!photo) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  async function choosePhoto(file: File | null) {
    setPhoto(file);
    setGps(null);
    setPin(null);
    setLocationSource(null);
    setPhotoTakenAt(null);
    if (!file) return;
    setStatus("Checking the photo for location and capture date…");
    try {
      const [coordinates, metadata] = await Promise.all([
        readGps(file).catch(() => null),
        readExif(file, ["DateTimeOriginal", "CreateDate"]).catch(() => null),
      ]);
      const captured = metadata?.DateTimeOriginal || metadata?.CreateDate;
      if (captured instanceof Date && !Number.isNaN(captured.getTime()))
        setPhotoTakenAt(captured.toISOString());
      if (coordinates?.latitude != null && coordinates?.longitude != null) {
        const point = {
          lat: coordinates.latitude,
          lng: coordinates.longitude,
          accuracy: 0,
        };
        setGps(point);
        setPin(point);
        setLocationSource("photo");
        setStatus(
          "GPS was found in the photo. Confirm or adjust the pin on the map.",
        );
      } else
        setStatus(
          "This photo has no embedded GPS. Capture your current location to continue.",
        );
    } catch {
      setStatus(
        "Photo metadata could not be read. Capture your current location to continue.",
      );
    }
  }
  function locate() {
    if (!navigator.geolocation)
      return setStatus("This browser cannot provide GPS.");
    setStatus("Requesting high-accuracy GPS…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point = {
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy: coords.accuracy,
        };
        setGps(point);
        setPin(point);
        setLocationSource("browser");
        setStatus(
          `GPS captured. Approximate accuracy: ±${Math.round(coords.accuracy)} m. Move the pin if needed.`,
        );
      },
      (error) =>
        setStatus(
          error.code === 1
            ? "Location permission is required."
            : "GPS could not be captured. Move outdoors and try again.",
        ),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!photo || !gps || !pin)
      return setStatus("Photo and current GPS are required.");
    setSending(true);
    setStatus("Sending to the administrator…");
    const form = new FormData(event.currentTarget);
    const selectedModule = publicModules.find((module) => module.id === type);
    const customData = Object.fromEntries(
      (selectedModule?.fields || [])
        .filter((field) => field.public_submit)
        .map((field) => [field.key, form.get(`field-${field.key}`)]),
    );
    const id = crypto.randomUUID();
    const extension =
      photo.name
        .split(".")
        .pop()
        ?.replace(/[^a-z0-9]/gi, "") || "jpg";
    const photoPath = `${instance.id}/${id}.${extension}`;
    try {
      await upload("submission-media", photoPath, photo);
      await db("submissions", "", {
        method: "POST",
        prefer: "return=minimal",
        body: {
          id,
          instance_id: instance.id,
          submission_type: mode,
          record_type: mode === "stock_change" ? "stock" : type,
          item_name: String(form.get("itemName") || "").trim(),
          category: selectedModule?.name || "Uncategorized",
          description: String(form.get("description") || "").trim() || null,
          quantity:
            mode === "stock_change" ? Number(form.get("quantity")) : null,
          quantity_unit:
            mode === "stock_change"
              ? String(form.get("unit") || "").trim()
              : null,
          latitude: pin.lat,
          longitude: pin.lng,
          gps_latitude: gps.lat,
          gps_longitude: gps.lng,
          gps_accuracy: gps.accuracy,
          contact_name: String(form.get("contactName") || "").trim() || null,
          contact_method:
            String(form.get("contactMethod") || "").trim() || null,
          contact_value: String(form.get("contactValue") || "").trim() || null,
          data: customData,
          photo_path: photoPath,
          photo_taken_at: photoTakenAt,
          location_source:
            locationSource === "photo"
              ? "photo_exif"
              : locationSource === "browser"
                ? "browser_gps"
                : "manual_pin",
          status: "pending",
        },
      });
      event.currentTarget.reset();
      setPhoto(null);
      setGps(null);
      setPin(null);
      setStatus(
        "Submitted. Nothing will be published or deducted until an administrator reviews it.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Submission failed.");
    } finally {
      setSending(false);
    }
  }
  return (
    <div className="form-page">
      <header className="plain-header">
        <button
          className="wordmark"
          onClick={() => navigate(`site/${instance.slug}`)}
        >
          <b>LOTKEEPER</b>
          <span>{instance.name}</span>
        </button>
        <button onClick={() => navigate(`site/${instance.slug}`)}>
          Return to directory
        </button>
      </header>
      <main className="form-wrap">
        <div className="form-heading">
          <small>PUBLIC CONTRIBUTION</small>
          <h1>Add useful information</h1>
          <p>
            No account or name is needed. A photo and GPS location are required.
            Staff approves or rejects every submission.
          </p>
        </div>
        <form onSubmit={submit}>
          <section>
            <h2>
              <span>1</span>Choose the report
            </h2>
            <div className="mode-grid">
              <label className={mode === "new_record" ? "selected" : ""}>
                <input
                  type="radio"
                  checked={mode === "new_record"}
                  onChange={() => setMode("new_record")}
                />
                <b>Add or update a mapped record</b>
                <small>Place, asset, stock location, or loose material</small>
              </label>
              {instance.modules.includes("stock") && (
                <label className={mode === "stock_change" ? "selected" : ""}>
                  <input
                    type="radio"
                    checked={mode === "stock_change"}
                    onChange={() => setMode("stock_change")}
                  />
                  <b>Report stock used or removed</b>
                  <small>Tell staff exactly what changed and how much</small>
                </label>
              )}
            </div>
          </section>
          <section>
            <h2>
              <span>2</span>Describe it
            </h2>
            {mode === "new_record" && (
              <label>
                Record type
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as ModuleKey)}
                >
                  {publicModules.map((module) => (
                    <option value={module.id} key={module.id}>
                      {module.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              What is it?
              <input name="itemName" required maxLength={140} />
            </label>
            {mode === "stock_change" && (
              <div className="field-pair">
                <label>
                  Amount
                  <input
                    name="quantity"
                    type="number"
                    min="0.01"
                    step="any"
                    required
                  />
                </label>
                <label>
                  Unit
                  <input
                    name="unit"
                    placeholder="pieces, pounds, gallons"
                    required
                  />
                </label>
              </div>
            )}
            <label>
              Details
              <textarea name="description" rows={4} maxLength={1500} />
            </label>
            {mode === "new_record" &&
              publicModules
                .find((module) => module.id === type)
                ?.fields.filter((field) => field.public_submit)
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
              <span>3</span>Take a current photo
            </h2>
            <label className="capture-box">
              <input
                type="file"
                accept="image/*"
                capture="environment"
                required
                onChange={(e) => choosePhoto(e.target.files?.[0] || null)}
              />
              {preview ? (
                <img src={preview} alt="Selected" />
              ) : (
                <>
                  <b>Open camera or select photo</b>
                  <small>Photograph the actual item or location.</small>
                </>
              )}
            </label>
            {photo && (
              <div className="photo-metadata">
                <b>
                  {locationSource === "photo"
                    ? "Photo GPS found"
                    : "No photo GPS found"}
                </b>
                <span>
                  {photoTakenAt
                    ? `Photo captured ${new Date(photoTakenAt).toLocaleString()}`
                    : "Photo capture date unavailable"}
                </span>
              </div>
            )}
          </section>
          <section className="location-preview">
            <h2>
              <span>4</span>Confirm the location
            </h2>
            {!gps && (
              <p>
                Embedded photo GPS was not available. Capture your current
                location or click the map to place the pin manually.
              </p>
            )}
            {locationSource === "photo" && (
              <p>
                Location came from the image. Check the map and move the pin if
                necessary.
              </p>
            )}
            {locationSource === "browser" && (
              <p>
                Location came from this device. Check the map and move the pin
                if necessary.
              </p>
            )}
            {locationSource === "manual" && (
              <p>
                The pin was placed manually. Staff will see that it was not
                verified by GPS.
              </p>
            )}
            {locationSource !== "photo" && (
              <button type="button" className="gps-button" onClick={locate}>
                Capture current location
              </button>
            )}
            {photo && (
              <GeoMap
                latitude={pin?.lat ?? instance.latitude}
                longitude={pin?.lng ?? instance.longitude}
                zoom={pin ? 18 : instance.map_zoom}
                picker
                onPick={(lat, lng) => {
                  setPin({ lat, lng });
                  if (!gps || locationSource === "manual") {
                    setGps({ lat, lng, accuracy: 0 });
                    setLocationSource("manual");
                    setStatus(
                      "Manual pin selected. Adjust it again or capture current GPS instead.",
                    );
                  }
                }}
              />
            )}{" "}
            {pin && (
              <code>
                {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}
              </code>
            )}
          </section>
          <section>
            <h2>
              <span>5</span>Contact (optional)
            </h2>
            <p className="section-help">
              You may submit anonymously. Contact details are visible only to
              staff and help if clarification is needed.
            </p>
            <label>
              Name or assigned username
              <input name="contactName" />
            </label>
            <div className="field-pair">
              <label>
                Contact type
                <select name="contactMethod">
                  <option value="">No contact</option>
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                  <option value="assigned_username">Assigned username</option>
                </select>
              </label>
              <label>
                Contact information
                <input name="contactValue" />
              </label>
            </div>
            <button
              className="primary-action submit-discrete"
              disabled={sending || !photo || !gps || !pin}
            >
              {sending ? "Submitting…" : "Send for administrator review"}
            </button>
            <p className="form-status" aria-live="polite">
              {status}
            </p>
          </section>
        </form>
      </main>
    </div>
  );
}
