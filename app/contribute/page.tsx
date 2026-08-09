"use client";

import { FormEvent, useEffect, useState } from "react";
import MapPicker from "../components/MapPicker";
import { siteConfig } from "../site-config";

export default function ContributePage() {
  const [mode, setMode] = useState("new_record");
  const [recordType, setRecordType] = useState("place");
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [gpsStatus, setGpsStatus] = useState("GPS has not been captured.");
  const [submitStatus, setSubmitStatus] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!photo) { setPreview(""); return; }
    const url = URL.createObjectURL(photo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  function captureGps() {
    if (!navigator.geolocation) { setGpsStatus("This browser does not provide GPS location."); return; }
    setGpsStatus("Requesting your current location…");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const next = { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy };
        setGps(next); setPin({ lat: next.lat, lng: next.lng });
        setGpsStatus(`GPS captured. Reported accuracy: approximately ±${Math.round(coords.accuracy)} m.`);
      },
      (error) => setGpsStatus(error.code === 1 ? "Location permission is required to submit." : "Could not capture GPS. Move outdoors and try again."),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!gps || !pin || !photo) { setSubmitStatus("Take a photo, capture GPS, and confirm the pin first."); return; }
    setSending(true); setSubmitStatus("Sending for administrator review…");
    const data = new FormData(event.currentTarget);
    data.set("submissionType", mode); data.set("recordType", recordType);
    data.set("gpsLatitude", String(gps.lat)); data.set("gpsLongitude", String(gps.lng));
    data.set("gpsAccuracy", String(gps.accuracy)); data.set("latitude", String(pin.lat)); data.set("longitude", String(pin.lng));
    data.set("photo", photo);
    const response = await fetch("/api/contributions", { method: "POST", body: data });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setSubmitStatus(result.error || "The submission could not be sent."); setSending(false); return; }
    event.currentTarget.reset(); setGps(null); setPin(null); setPhoto(null); setSending(false);
    setSubmitStatus("Submitted. An administrator will review it before it appears publicly or affects stock records.");
  }

  return <main className="contribute-shell">
    <header className="simple-header"><a className="brand" href="/"><span className="brand-mark">LK</span><span>{siteConfig.organizationName}</span></a><a href="/community">View community map</a></header>
    <section className="contribute-intro"><div className="eyebrow"><span/> COMMUNITY CONTRIBUTION</div><h1>Help keep this site current.</h1><p>No account is required. Take a current photo, capture your GPS location, move the pin onto the exact item or place, and send it to the administrator.</p><div className="review-notice"><b>Nothing is published automatically.</b> An administrator approves or rejects every submission. Your contact information is visible only to staff.</div></section>
    <form className="contribute-form" onSubmit={submit}>
      <section className="form-step"><span className="step-number">1</span><div><h2>What are you reporting?</h2><div className="choice-grid"><label className={mode === "new_record" ? "choice active" : "choice"}><input type="radio" name="modeChoice" checked={mode === "new_record"} onChange={() => setMode("new_record")}/><b>Add or update something on the map</b><span>Place, asset, loose material, or stock location</span></label><label className={mode === "stock_change" ? "choice active" : "choice"}><input type="radio" name="modeChoice" checked={mode === "stock_change"} onChange={() => { setMode("stock_change"); setRecordType("stock"); }}/><b>Report stock used or removed</b><span>Tell staff what changed and how much</span></label></div></div></section>
      <section className="form-step"><span className="step-number">2</span><div><h2>Describe it</h2>{mode === "new_record" && <label>Record type<select value={recordType} onChange={(e) => setRecordType(e.target.value)}><option value="place">Place or point of interest</option><option value="asset">Persistent asset or equipment</option><option value="stock">Consumable or sellable stock</option><option value="loose_material">Loose material, offcut, scrap, or temporary item</option></select></label>}<label>What is it?<input name="itemName" required maxLength={140} placeholder={mode === "stock_change" ? "Example: 2-inch square tubing" : "Name the place, item, material, or asset"}/></label><label>Category<input name="category" required maxLength={80} placeholder="Example: Trail feature, vehicle, steel, tools"/></label>{mode === "stock_change" && <div className="inline-fields"><label>Amount used or removed<input name="quantity" type="number" min="0.01" step="any" required/></label><label>Unit<input name="quantityUnit" required placeholder="pieces, pounds, gallons…"/></label></div>}<label>Useful details<textarea name="description" maxLength={1500} rows={4} placeholder="Condition, identifying details, access notes, or what changed"/></label></div></section>
      <section className="form-step"><span className="step-number">3</span><div><h2>Take a current photo</h2><label className="photo-picker"><input type="file" accept="image/*" capture="environment" required onChange={(e) => setPhoto(e.target.files?.[0] || null)}/>{preview ? <img src={preview} alt="Selected submission"/> : <><b>Open camera or choose photo</b><span>A photograph is required and must be under 10 MB.</span></>}</label></div></section>
      <section className="form-step"><span className="step-number">4</span><div><h2>Capture GPS and confirm the pin</h2><p className="field-help">GPS proves where you were. The movable pin identifies the exact object or place if it is several feet away.</p><button className="location-button" type="button" onClick={captureGps}>◎ Use my current GPS location</button><p className="status-line">{gpsStatus}</p>{pin && <><MapPicker latitude={pin.lat} longitude={pin.lng} onChange={(lat, lng) => setPin({ lat, lng })}/><p className="coordinate-line">Confirmed pin: {pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</p></>}</div></section>
      <section className="form-step"><span className="step-number">5</span><div><h2>How can staff identify or contact you?</h2><p className="field-help">Required for inventory and stock reports and used if staff needs clarification. It is never shown publicly.</p><label>Your name or assigned user name<input name="contactName" required maxLength={100}/></label><div className="inline-fields"><label>Contact type<select name="contactMethod" required><option value="phone">Phone</option><option value="email">Email</option><option value="assigned_username">Assigned user name</option></select></label><label>Contact information<input name="contactValue" required maxLength={160} placeholder="Phone, email, or assigned name"/></label></div><label className="honeypot">Website<input name="website" tabIndex={-1} autoComplete="off"/></label><button className="submit-contribution" disabled={sending} type="submit">{sending ? "Sending…" : "Send for administrator review"}</button><p className="submit-status" aria-live="polite">{submitStatus}</p></div></section>
    </form>
  </main>;
}
