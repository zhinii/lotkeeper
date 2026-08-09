import { FormEvent, useEffect, useState } from "react";
import { db, upload } from "../lib/supabase";
import type { Instance, ModuleKey } from "../types";
import { definitions } from "../lib/modules";
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
  useEffect(() => {
    if (!photo) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
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
          category: String(form.get("category") || "").trim(),
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
            <label>
              Category
              <input name="category" required maxLength={80} />
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
                onChange={(e) => setPhoto(e.target.files?.[0] || null)}
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
          </section>
          <section>
            <h2>
              <span>4</span>Capture GPS and set the pin
            </h2>
            <button type="button" className="gps-button" onClick={locate}>
              Use my current GPS location
            </button>
            {pin && (
              <GeoMap
                latitude={pin.lat}
                longitude={pin.lng}
                zoom={18}
                picker
                onPick={(lat, lng) => setPin({ lat, lng })}
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
            <button className="primary-action" disabled={sending}>
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
