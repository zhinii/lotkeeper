import { FormEvent, useEffect, useState } from "react";
import {
  db,
  getSession,
  signIn,
  signOut,
  signedUrl,
  upload,
  removeObject,
} from "../lib/supabase";
import type { Instance, ModuleDefinition, Session, Submission } from "../types";
import { definitions } from "../lib/modules";
import GeoMap from "./GeoMap";
import ModuleBuilder from "./ModuleBuilder";

export default function AdminConsole({
  navigate,
}: {
  navigate: (route: string) => void;
}) {
  const [mapCenter, setMapCenter] = useState({
    latitude: 33.4484,
    longitude: -112.074,
  });
  const [mapZoom, setMapZoom] = useState(13);
  const [placeSearch, setPlaceSearch] = useState("");
  const [boundaryPoints, setBoundaryPoints] = useState<[number, number][]>([]);
  const [drawingBoundary, setDrawingBoundary] = useState(false);
  const [editCenter, setEditCenter] = useState({ latitude: 0, longitude: 0 });
  const [editZoom, setEditZoom] = useState(13);
  const [editBoundary, setEditBoundary] = useState<[number, number][]>([]);
  const [editDrawing, setEditDrawing] = useState(false);
  const [session, setSession] = useState<Session | null>(getSession());
  const [instances, setInstances] = useState<Instance[]>([]);
  const [selected, setSelected] = useState<Instance | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [message, setMessage] = useState("");
  const [tab, setTab] = useState<"instances" | "review">("instances");
  const [reviewView, setReviewView] = useState<"pending" | "resolved">(
    "pending",
  );
  const [instanceView, setInstanceView] = useState<"configure" | "create">(
    "configure",
  );
  const [createModules, setCreateModules] = useState<ModuleDefinition[]>([
    {
      id: "items",
      name: "Items",
      public_visible: true,
      public_submit: true,
      fields: [],
    },
  ]);
  const [editModules, setEditModules] = useState<ModuleDefinition[]>([]);

  async function findPlace() {
    if (!placeSearch.trim()) return;
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(placeSearch)}`,
      );
      const [result] = await response.json();
      if (!result) {
        setMessage(
          "That place was not found. Try a city and state or country.",
        );
        return;
      }
      setMapCenter({
        latitude: Number(result.lat),
        longitude: Number(result.lon),
      });
      setMapZoom(13);
      setMessage(
        `Map centered on ${result.display_name}. Refine the yellow pin if needed.`,
      );
    } catch {
      setMessage(
        "Place search is unavailable. You can still move the pin manually.",
      );
    }
  }

  function useCurrentLocation() {
    navigator.geolocation?.getCurrentPosition(
      (position) => {
        setMapCenter({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setMapZoom(15);
        setMessage(
          "Map centered on your current location. Refine the yellow pin if needed.",
        );
      },
      () =>
        setMessage(
          "Location permission was unavailable. Search for the city instead.",
        ),
      { enableHighAccuracy: true },
    );
  }
  async function loadInstances() {
    if (!getSession()) return;
    try {
      const rows = await db<Instance[]>(
        "instances",
        "select=*&order=created_at.desc",
      );
      setInstances(rows);
      const current = selected
        ? rows.find((row) => row.id === selected.id)
        : rows[0];
      setSelected(current || null);
      if (current) {
        setEditCenter({
          latitude: current.latitude,
          longitude: current.longitude,
        });
        setEditZoom(current.map_zoom);
        setEditBoundary(current.boundary || []);
        setEditModules(definitions(current));
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not load instances.");
    }
  }
  async function loadSubmissions(instance: Instance) {
    try {
      setSubmissions(
        await db<Submission[]>(
          "submissions",
          `instance_id=eq.${instance.id}&select=*&order=submitted_at.desc`,
        ),
      );
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not load review queue.",
      );
    }
  }
  useEffect(() => {
    loadInstances();
  }, [session]);
  useEffect(() => {
    if (selected) loadSubmissions(selected);
  }, [selected?.id]);
  useEffect(() => {
    if (!selected) return;
    setEditCenter({
      latitude: selected.latitude,
      longitude: selected.longitude,
    });
    setEditZoom(selected.map_zoom);
    setEditBoundary(selected.boundary || []);
    setEditModules(definitions(selected));
    setEditDrawing(false);
  }, [selected?.id]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const next = await signIn(
        String(form.get("email")),
        String(form.get("password")),
      );
      setSession(next);
      setMessage("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Sign-in failed.");
    }
  }
  async function createInstance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const slug = String(form.get("slug") || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-");
    const configured = createModules.filter((module) => module.name.trim());
    const modules = configured.map((module) => module.id);
    if (!modules.length)
      return setMessage("Enable at least one feature module.");
    const id = crypto.randomUUID();
    try {
      const [created] = await db<Instance[]>("instances", "select=*", {
        method: "POST",
        prefer: "return=representation",
        body: {
          id,
          name,
          slug,
          site_name: String(form.get("siteName") || "Main Site"),
          access_mode: form.get("accessMode"),
          modules,
          module_definitions: configured,
          terminology: Object.fromEntries(
            configured.map((module) => [module.id, module.name]),
          ),
          latitude: Number(form.get("latitude")),
          longitude: Number(form.get("longitude")),
          map_zoom: Number(form.get("zoom")),
          boundary: boundaryPoints,
          created_by: session.user.id,
        },
      });
      await db("instance_members", "", {
        method: "POST",
        prefer: "return=minimal",
        body: { instance_id: id, user_id: session.user.id, role: "admin" },
      });
      setMessage(`${created.name} is configured and ready.`);
      event.currentTarget.reset();
      setBoundaryPoints([]);
      setDrawingBoundary(false);
      await loadInstances();
      setSelected(created);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not create instance.");
    }
  }
  async function saveSelected(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const configured = editModules.filter((module) => module.name.trim());
    const modules = configured.map((module) => module.id);
    if (!modules.length)
      return setMessage("Enable at least one feature module.");
    try {
      await db("instances", `id=eq.${selected.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          site_name: String(form.get("edit-siteName") || selected.site_name),
          access_mode: form.get("edit-accessMode"),
          modules,
          module_definitions: configured,
          terminology: Object.fromEntries(
            configured.map((module) => [module.id, module.name]),
          ),
          latitude: editCenter.latitude,
          longitude: editCenter.longitude,
          map_zoom: editZoom,
          boundary: editBoundary,
          updated_at: new Date().toISOString(),
        },
      });
      setMessage(`${selected.name} settings updated.`);
      await loadInstances();
    } catch (e) {
      const detail =
        e instanceof Error ? e.message : "Could not update the instance.";
      setMessage(
        detail.includes("boundary")
          ? "Database upgrade required: run supabase/instance-boundary-upgrade.sql, reload, and save again."
          : detail,
      );
    }
  }
  async function toggleAccess(instance: Instance) {
    const access_mode =
      instance.access_mode === "public" ? "private" : "public";
    try {
      await db("instances", `id=eq.${instance.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { access_mode },
      });
      setMessage(`${instance.name} is now ${access_mode}.`);
      await loadInstances();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not update access.");
    }
  }
  async function review(item: Submission, decision: "approved" | "rejected") {
    if (!session || !selected) return;
    let stage = "updating the submission";
    setMessage(
      `${decision === "approved" ? "Approving" : "Rejecting"} ${item.item_name}…`,
    );
    try {
      if (decision === "approved" && item.submission_type === "new_record") {
        const moduleDefinition = definitions(selected).find(
          (module) => module.id === item.record_type,
        );
        const publicData = Object.fromEntries(
          Object.entries(item.data || {}).filter(
            ([key]) =>
              moduleDefinition?.fields.find((field) => field.key === key)
                ?.public_visible,
          ),
        );
        stage = "opening the private submission photo";
        const privateUrl = await signedUrl("submission-media", item.photo_path);
        stage = "downloading the private submission photo";
        const photo = await fetch(privateUrl).then((response) =>
          response.blob(),
        );
        const publicPath = `${item.instance_id}/${item.id}.${photo.type.includes("png") ? "png" : "jpg"}`;
        stage = "publishing the approved photo";
        await upload("public-media", publicPath, photo);
        stage = "creating the approved public record";
        await db("records", "on_conflict=id", {
          method: "POST",
          prefer: "resolution=merge-duplicates,return=minimal",
          body: {
            id: item.id,
            instance_id: item.instance_id,
            record_type: item.record_type,
            name: item.item_name,
            category: item.category,
            description: item.description,
            status: "active",
            latitude: item.latitude,
            longitude: item.longitude,
            photo_path: publicPath,
            public_visible: true,
            data: publicData,
            source_submission_id: item.id,
            updated_by: session.user.id,
            updated_by_email: session.user.email,
          },
        });
      }
      if (decision === "approved" && item.submission_type === "stock_change") {
        stage = "recording the approved stock change";
        await db("stock_events", "", {
          method: "POST",
          prefer: "return=minimal",
          body: {
            id: crypto.randomUUID(),
            instance_id: item.instance_id,
            submission_id: item.id,
            item_name: item.item_name,
            quantity: item.quantity,
            unit: item.quantity_unit,
            event_type: "reported_removed",
            created_by: session.user.id,
          },
        });
      }
      stage = "marking the submission resolved";
      await db("submissions", `id=eq.${item.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          status: decision,
          moderated_by: session.user.id,
          moderated_at: new Date().toISOString(),
        },
      });
      setMessage(`Submission ${decision}.`);
      await loadSubmissions(selected);
    } catch (e) {
      setMessage(
        `${stage}: ${e instanceof Error ? e.message : "Review failed."}`,
      );
    }
  }
  async function deleteSubmissionLegacy(item: Submission) {
    if (item.status === "pending")
      return setMessage("Review the submission before deleting it.");
    if (
      !confirm(
        `Permanently delete the ${item.status} submission for “${item.item_name}”? The published record, if approved, will remain.`,
      )
    )
      return;
    try {
      await removeObject("submission-media", item.photo_path);
      await db("submissions", `id=eq.${item.id}`, {
        method: "DELETE",
        prefer: "return=minimal",
      });
      setMessage(
        "Resolved submission and its private source photo deleted. Any approved public record remains available.",
      );
      if (selected) await loadSubmissions(selected);
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not delete the submission.",
      );
    }
  }
  async function deleteSubmission(item: Submission) {
    if (!selected || item.status === "pending") return;
    if (
      !confirm(
        `Delete the ${item.status} submission for “${item.item_name}”? The approved public record and stock history will remain.`,
      )
    )
      return;
    try {
      await db("stock_events", `submission_id=eq.${item.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { submission_id: null },
      });
      await removeObject("submission-media", item.photo_path);
      await db("submissions", `id=eq.${item.id}`, {
        method: "DELETE",
        prefer: "return=minimal",
      });
      setMessage(
        "Reviewed submission and its private original photo were deleted.",
      );
      await loadSubmissions(selected);
    } catch (e) {
      setMessage(
        e instanceof Error ? e.message : "Could not delete the submission.",
      );
    }
  }
  if (!session)
    return (
      <div className="login-page">
        <form onSubmit={login}>
          <b className="login-brand">LOTKEEPER ADMIN</b>
          <h1>Sign in</h1>
          <p>Use the administrator account configured in Supabase.</p>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" required />
          </label>
          <button>Sign in</button>
          <p className="form-status">{message}</p>
          <button
            type="button"
            className="text-button"
            onClick={() => navigate("home")}
          >
            Return to directory
          </button>
        </form>
      </div>
    );
  const pending = submissions.filter((item) => item.status === "pending");
  const resolved = submissions.filter((item) => item.status !== "pending");
  const visibleSubmissions = reviewView === "pending" ? pending : resolved;
  return (
    <div className="admin-page">
      <header className="admin-top">
        <button className="wordmark" onClick={() => navigate("home")}>
          <b>LOTKEEPER</b>
          <span>Deployment console</span>
        </button>
        <nav>
          <button
            className={tab === "instances" ? "active" : ""}
            onClick={() => setTab("instances")}
          >
            Instances
          </button>
          <button
            className={tab === "review" ? "active" : ""}
            onClick={() => setTab("review")}
          >
            Review queue <b>{pending.length}</b>
          </button>
        </nav>
        <div>
          <span>{session.user.email}</span>
          <button
            onClick={() => {
              signOut();
              setSession(null);
            }}
          >
            Sign out
          </button>
        </div>
      </header>
      <div className="admin-body">
        <aside className="instance-list">
          <div>
            <h2>Organizations</h2>
            <span>{instances.length}</span>
          </div>
          {instances.map((instance) => (
            <button
              className={selected?.id === instance.id ? "active" : ""}
              onClick={() => {
                setSelected(instance);
                setEditCenter({
                  latitude: instance.latitude,
                  longitude: instance.longitude,
                });
                setEditZoom(instance.map_zoom);
                setEditBoundary(instance.boundary || []);
                setEditModules(definitions(instance));
                setEditDrawing(false);
              }}
              key={instance.id}
            >
              <strong>{instance.name}</strong>
              <small>
                {instance.site_name} · {instance.access_mode}
              </small>
            </button>
          ))}
        </aside>
        <main className="admin-content">
          <p className="system-message" aria-live="polite">
            {message}
          </p>
          {tab === "instances" ? (
            <>
              <div className="admin-heading">
                <div>
                  <small>INSTANCE MANAGEMENT</small>
                  <h1>Deploy and configure organizations</h1>
                  <p>
                    Every instance uses this same GitHub Pages application and
                    receives its own database configuration, URL, access rules,
                    modules, map, and terminology.
                  </p>
                </div>
                {selected && (
                  <button onClick={() => navigate(`site/${selected.slug}`)}>
                    Open selected instance ↗
                  </button>
                )}
              </div>
              <div className="instance-view-tabs">
                <button
                  className={instanceView === "configure" ? "active" : ""}
                  onClick={() => setInstanceView("configure")}
                >
                  Configure selected
                </button>
                <button
                  className={instanceView === "create" ? "active" : ""}
                  onClick={() => setInstanceView("create")}
                >
                  + New organization
                </button>
              </div>
              {instanceView === "configure" && selected && (
                <section className="selected-instance">
                  <div>
                    <small>SELECTED INSTANCE</small>
                    <h2>{selected.name}</h2>
                    <code>#/site/{selected.slug}</code>
                  </div>
                  <div className="config-summary">
                    <span>
                      <b>{selected.access_mode}</b> access
                    </span>
                    <span>
                      <b>{selected.modules.length}</b> modules
                    </span>
                    <span>
                      <b>{selected.site_name}</b> site
                    </span>
                  </div>
                  <button onClick={() => toggleAccess(selected)}>
                    Make{" "}
                    {selected.access_mode === "public" ? "private" : "public"}
                  </button>
                </section>
              )}
              {instanceView === "configure" && selected && (
                <section className="deploy-panel edit-instance-panel">
                  <h2>Edit selected instance</h2>
                  <p className="section-help">
                    Change the public/private setting, enabled categories,
                    labels, map center, or site boundary at any time.
                  </p>
                  <form onSubmit={saveSelected} key={selected.id}>
                    <div className="form-columns">
                      <label>
                        Site name
                        <input
                          name="edit-siteName"
                          required
                          defaultValue={selected.site_name}
                        />
                      </label>
                      <label>
                        Access
                        <select
                          name="edit-accessMode"
                          defaultValue={selected.access_mode}
                        >
                          <option value="public">Public directory</option>
                          <option value="private">Private, members only</option>
                        </select>
                      </label>
                    </div>
                    <h3>Enabled categories and labels</h3>
                    <ModuleBuilder
                      value={editModules}
                      onChange={setEditModules}
                    />
                    <h3>Map and site boundary</h3>
                    <p className="section-help">
                      Move the center pin normally. Select Draw boundary, then
                      click points around the site in order. Three or more
                      points create the shaded boundary.
                    </p>
                    <div className="boundary-actions">
                      <button
                        type="button"
                        className={editDrawing ? "active" : ""}
                        onClick={() => setEditDrawing((value) => !value)}
                      >
                        {editDrawing ? "Stop drawing" : "Draw boundary"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setEditBoundary((points) => points.slice(0, -1))
                        }
                        disabled={!editBoundary.length}
                      >
                        Undo point
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditBoundary([])}
                        disabled={!editBoundary.length}
                      >
                        Clear boundary
                      </button>
                      <span>{editBoundary.length} boundary points</span>
                    </div>
                    <GeoMap
                      latitude={editCenter.latitude}
                      longitude={editCenter.longitude}
                      zoom={editZoom}
                      picker
                      boundary={editBoundary}
                      boundaryPicker={editDrawing}
                      onBoundaryChange={setEditBoundary}
                      onPick={(latitude, longitude) =>
                        setEditCenter({ latitude, longitude })
                      }
                    />
                    <div className="form-columns map-config">
                      <label>
                        Latitude
                        <input
                          type="number"
                          step="any"
                          value={editCenter.latitude}
                          onChange={(event) =>
                            setEditCenter((current) => ({
                              ...current,
                              latitude: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label>
                        Longitude
                        <input
                          type="number"
                          step="any"
                          value={editCenter.longitude}
                          onChange={(event) =>
                            setEditCenter((current) => ({
                              ...current,
                              longitude: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label>
                        Zoom
                        <div className="zoom-control">
                          <button
                            type="button"
                            onClick={() =>
                              setEditZoom((value) => Math.max(3, value - 1))
                            }
                          >
                            −
                          </button>
                          <input
                            type="range"
                            min="3"
                            max="22"
                            value={editZoom}
                            onChange={(event) =>
                              setEditZoom(Number(event.target.value))
                            }
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setEditZoom((value) => Math.min(22, value + 1))
                            }
                          >
                            +
                          </button>
                          <output>{editZoom}</output>
                        </div>
                      </label>
                    </div>
                    <button className="deploy-button">
                      Save instance settings
                    </button>
                  </form>
                </section>
              )}
              {instanceView === "create" && (
                <section className="deploy-panel">
                  <h2>Create a new instance</h2>
                  <div className="deployment-note">
                    <b>Shared public/free deployment</b>
                    <p>
                      This console creates an isolated instance in the shared
                      Lotkeeper database. “Private” means authenticated access
                      in that shared service. Customers requiring their own
                      database use the dedicated deployment workflow maintained
                      with this project.
                    </p>
                  </div>
                  <form onSubmit={createInstance}>
                    <div className="form-columns">
                      <label>
                        Organization name
                        <input
                          name="name"
                          required
                          placeholder="Example: Page Steel"
                        />
                      </label>
                      <label>
                        URL slug
                        <input
                          name="slug"
                          required
                          pattern="[a-z0-9-]+"
                          placeholder="page-steel"
                        />
                      </label>
                      <label>
                        Site name
                        <input
                          name="siteName"
                          required
                          defaultValue="Main Site"
                        />
                      </label>
                      <label>
                        Access
                        <select name="accessMode">
                          <option value="public">Public directory</option>
                          <option value="private">
                            Private access, shared database
                          </option>
                        </select>
                      </label>
                    </div>
                    <h3>Feature modules</h3>
                    <ModuleBuilder
                      value={createModules}
                      onChange={setCreateModules}
                    />
                    <h3>Initial map</h3>
                    <p className="section-help">
                      Search for a city, use your current location, then click
                      the map or drag the yellow pin to select the deployment
                      center. Optionally draw the site boundary before creating
                      it.
                    </p>
                    <div className="map-search">
                      <input
                        value={placeSearch}
                        onChange={(event) => setPlaceSearch(event.target.value)}
                        placeholder="City, state or country"
                        aria-label="Search for a map location"
                      />
                      <button type="button" onClick={findPlace}>
                        Find place
                      </button>
                      <button type="button" onClick={useCurrentLocation}>
                        Use my location
                      </button>
                    </div>
                    <div className="boundary-actions">
                      <button
                        type="button"
                        className={drawingBoundary ? "active" : ""}
                        onClick={() => setDrawingBoundary((value) => !value)}
                      >
                        {drawingBoundary ? "Stop drawing" : "Draw boundary"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setBoundaryPoints((points) => points.slice(0, -1))
                        }
                        disabled={!boundaryPoints.length}
                      >
                        Undo point
                      </button>
                      <button
                        type="button"
                        onClick={() => setBoundaryPoints([])}
                        disabled={!boundaryPoints.length}
                      >
                        Clear boundary
                      </button>
                      <span>{boundaryPoints.length} boundary points</span>
                    </div>
                    <GeoMap
                      latitude={mapCenter.latitude}
                      longitude={mapCenter.longitude}
                      zoom={mapZoom}
                      picker
                      boundary={boundaryPoints}
                      boundaryPicker={drawingBoundary}
                      onBoundaryChange={setBoundaryPoints}
                      onPick={(latitude, longitude) =>
                        setMapCenter({ latitude, longitude })
                      }
                    />
                    <div className="form-columns map-config">
                      <label>
                        Latitude
                        <input
                          name="latitude"
                          type="number"
                          step="any"
                          required
                          value={mapCenter.latitude}
                          onChange={(event) =>
                            setMapCenter((current) => ({
                              ...current,
                              latitude: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label>
                        Longitude
                        <input
                          name="longitude"
                          type="number"
                          step="any"
                          required
                          value={mapCenter.longitude}
                          onChange={(event) =>
                            setMapCenter((current) => ({
                              ...current,
                              longitude: Number(event.target.value),
                            }))
                          }
                        />
                      </label>
                      <label>
                        Zoom
                        <input
                          name="zoom"
                          type="number"
                          min="3"
                          max="22"
                          value={mapZoom}
                          onChange={(event) =>
                            setMapZoom(Number(event.target.value))
                          }
                        />
                      </label>
                    </div>
                    <button className="deploy-button">Create instance</button>
                  </form>
                </section>
              )}
            </>
          ) : (
            <>
              <div className="admin-heading">
                <div>
                  <small>MODERATION</small>
                  <h1>Review public submissions</h1>
                  <p>
                    Nothing becomes visible and no stock report is accepted
                    until an administrator reviews it.
                  </p>
                </div>
              </div>
              <div className="review-view-tabs">
                <button
                  className={reviewView === "pending" ? "active" : ""}
                  onClick={() => setReviewView("pending")}
                >
                  Needs review <b>{pending.length}</b>
                </button>
                <button
                  className={reviewView === "resolved" ? "active" : ""}
                  onClick={() => setReviewView("resolved")}
                >
                  Resolved <b>{resolved.length}</b>
                </button>
              </div>
              {!selected && <div className="empty">Select an instance.</div>}
              {selected && !visibleSubmissions.length && (
                <div className="empty">
                  <h2>
                    {reviewView === "pending"
                      ? "Queue is clear"
                      : "No resolved submissions"}
                  </h2>
                  <p>
                    {reviewView === "pending"
                      ? "No public submissions are waiting."
                      : "Approved and rejected submissions will appear here."}
                  </p>
                </div>
              )}
              <div className="review-grid">
                {visibleSubmissions.map((item) => (
                  <article key={item.id}>
                    <div className="review-tag">
                      {item.status !== "pending" ? `${item.status} · ` : ""}
                      {item.submission_type === "stock_change"
                        ? "STOCK USED / REMOVED"
                        : item.record_type.replace("_", " ")}
                    </div>
                    <h2>{item.item_name}</h2>
                    <p>{item.description || "No description supplied."}</p>
                    {item.quantity && (
                      <strong>
                        {item.quantity} {item.quantity_unit}
                      </strong>
                    )}
                    <dl>
                      <div>
                        <dt>Category</dt>
                        <dd>{item.category}</dd>
                      </div>
                      <div>
                        <dt>GPS accuracy</dt>
                        <dd>
                          {item.gps_accuracy
                            ? `±${Math.round(item.gps_accuracy)} m`
                            : "Unknown"}
                        </dd>
                      </div>
                      <div>
                        <dt>Contributor</dt>
                        <dd>{item.contact_name || "Anonymous"}</dd>
                      </div>
                      {item.contact_value && (
                        <div>
                          <dt>{item.contact_method}</dt>
                          <dd>{item.contact_value}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Submitted</dt>
                        <dd>{new Date(item.submitted_at).toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>Photo captured</dt>
                        <dd>
                          {item.photo_taken_at
                            ? new Date(item.photo_taken_at).toLocaleString()
                            : "Not available"}
                        </dd>
                      </div>
                      <div>
                        <dt>Location source</dt>
                        <dd>
                          {item.location_source === "photo_exif"
                            ? "Photo GPS"
                            : item.location_source === "browser_gps"
                              ? "Browser GPS"
                              : "Manual pin"}
                        </dd>
                      </div>
                    </dl>
                    <div className="review-actions">
                      <a
                        target="_blank"
                        href={`https://www.openstreetmap.org/?mlat=${item.latitude}&mlon=${item.longitude}#map=19/${item.latitude}/${item.longitude}`}
                      >
                        Check pin ↗
                      </a>
                      {item.status === "pending" ? (
                        <>
                          <button
                            className="reject"
                            onClick={() => review(item, "rejected")}
                          >
                            Reject
                          </button>
                          <button
                            className="approve"
                            onClick={() => review(item, "approved")}
                          >
                            Approve
                          </button>
                        </>
                      ) : (
                        <button
                          className="delete-submission"
                          onClick={() => deleteSubmission(item)}
                        >
                          Delete submission
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
