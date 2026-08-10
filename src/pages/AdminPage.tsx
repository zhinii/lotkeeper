import { useEffect, useState } from "react";
import CollectionEditor from "../components/CollectionEditor";
import MapView from "../components/MapView";
import OrganizationMapEditor, {
  type MapConfiguration,
} from "../components/OrganizationMapEditor";
import { civicDefaults, commercialDefaults } from "../lib/collections";
import { navigate } from "../lib/route";
import { requireSupabase } from "../lib/supabase";
import type {
  AlertItem,
  CollectionDefinition,
  Organization,
  RecordItem,
  Submission,
} from "../types";

type Tab = "overview" | "review" | "records" | "configure" | "create";

export default function AdminPage() {
  const [session, setSession] = useState<any>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selected, setSelected] = useState<Organization | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [submissionPhotos, setSubmissionPhotos] = useState<
    Record<string, string>
  >({});
  const [tab, setTab] = useState<Tab>("overview");
  const [reviewView, setReviewView] = useState<"pending" | "resolved">(
    "pending",
  );
  const [message, setMessage] = useState("");
  const [editCollections, setEditCollections] = useState<
    CollectionDefinition[]
  >([]);
  const [editMap, setEditMap] = useState<MapConfiguration>({
    latitude: 36.9148,
    longitude: -111.4573,
    zoom: 14,
    boundary: [],
  });
  const [editPublic, setEditPublic] = useState(false);
  const [editAi, setEditAi] = useState(false);
  const [createMode, setCreateMode] = useState<"civic" | "commercial">("civic");
  const [createPublic, setCreatePublic] = useState(true);
  const [createMap, setCreateMap] = useState<MapConfiguration>({
    latitude: 36.9148,
    longitude: -111.4573,
    zoom: 14,
    boundary: [],
  });

  useEffect(() => {
    const client = requireSupabase();
    client.auth.getSession().then(({ data }) => setSession(data.session));
    return client.auth.onAuthStateChange((_event, next) => setSession(next))
      .data.subscription.unsubscribe;
  }, []);
  useEffect(() => {
    if (session) loadOrganizations();
  }, [session]);
  useEffect(() => {
    if (selected) {
      setEditCollections(selected.collections);
      setEditMap({
        latitude: selected.center_lat,
        longitude: selected.center_lng,
        zoom: selected.map_zoom,
        boundary: selected.boundary || [],
      });
      setEditPublic(selected.public_access);
      setEditAi(selected.ai_enabled);
      loadWorkspace(selected.id);
    }
  }, [selected?.id]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { error } = await requireSupabase().auth.signInWithPassword({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (error) setMessage(error.message);
  }
  async function loadOrganizations() {
    const { data, error } = await requireSupabase()
      .from("organizations")
      .select("*")
      .order("name");
    if (error) return setMessage(error.message);
    const rows = (data || []) as Organization[];
    setOrganizations(rows);
    setSelected(
      (current) =>
        rows.find((item) => item.id === current?.id) || rows[0] || null,
    );
  }
  async function loadWorkspace(organizationId: string) {
    const client = requireSupabase();
    const [submissionRows, recordRows, alertRows] = await Promise.all([
      client
        .from("submissions")
        .select("*")
        .eq("organization_id", organizationId)
        .order("submitted_at", { ascending: false }),
      client
        .from("records")
        .select("*")
        .eq("organization_id", organizationId)
        .order("updated_at", { ascending: false }),
      client
        .from("alerts")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
    ]);
    setSubmissions((submissionRows.data || []) as Submission[]);
    setRecords((recordRows.data || []) as RecordItem[]);
    setAlerts((alertRows.data || []) as AlertItem[]);
    const photoEntries = await Promise.all(
      ((submissionRows.data || []) as Submission[])
        .filter((item) => item.photo_path)
        .map(async (item) => {
          const { data } = await client.storage
            .from("submission-media")
            .createSignedUrl(item.photo_path!, 1800);
          return [item.id, data?.signedUrl || ""] as const;
        }),
    );
    setSubmissionPhotos(Object.fromEntries(photoEntries));
  }

  async function createOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const mode = createMode;
    const collections = mode === "civic" ? civicDefaults : commercialDefaults;
    const client = requireSupabase();
    const { data: newId, error } = await client.rpc("create_organization", {
      org_name: String(form.get("name")),
      org_slug: String(form.get("slug")),
      org_mode: mode,
      is_public: createPublic,
      latitude: createMap.latitude,
      longitude: createMap.longitude,
      zoom_level: createMap.zoom,
      collection_config: collections,
    });
    if (error) return setMessage(error.message);
    if (newId && createMap.boundary.length) {
      const { error: boundaryError } = await client
        .from("organizations")
        .update({ boundary: createMap.boundary })
        .eq("id", newId);
      if (boundaryError) return setMessage(boundaryError.message);
    }
    setMessage("Organization created.");
    setTab("overview");
    await loadOrganizations();
  }
  async function saveConfiguration() {
    if (!selected) return;
    const { error } = await requireSupabase()
      .from("organizations")
      .update({
        collections: editCollections,
        public_access: editPublic,
        ai_enabled: editAi,
        center_lat: editMap.latitude,
        center_lng: editMap.longitude,
        map_zoom: editMap.zoom,
        boundary: editMap.boundary,
      })
      .eq("id", selected.id);
    if (error) return setMessage(error.message);
    setMessage("Map, access and collection settings saved.");
    await loadOrganizations();
  }

  async function review(item: Submission, decision: "approved" | "rejected") {
    const client = requireSupabase();
    let publicPath: string | null = null;
    setMessage(
      `${decision === "approved" ? "Approving" : "Rejecting"} submission…`,
    );
    try {
      if (decision === "approved" && item.photo_path) {
        const { data, error } = await client.storage
          .from("submission-media")
          .createSignedUrl(item.photo_path, 300);
        if (error) throw error;
        const response = await fetch(data.signedUrl);
        if (!response.ok)
          throw new Error("Could not download the submitted image.");
        const blob = await response.blob();
        publicPath = `${item.organization_id}/${item.id}.${blob.type.includes("png") ? "png" : "jpg"}`;
        const uploaded = await client.storage
          .from("public-records")
          .upload(publicPath, blob, { upsert: true, contentType: blob.type });
        if (uploaded.error) throw uploaded.error;
      }
      if (decision === "approved") {
        const { error } = await client.rpc("approve_submission", {
          submission_id: item.id,
          published_photo_path: publicPath,
        });
        if (error) throw error;
      } else {
        const { error } = await client
          .from("submissions")
          .update({
            status: "rejected",
            reviewed_at: new Date().toISOString(),
            reviewed_by: session.user.id,
          })
          .eq("id", item.id);
        if (error) throw error;
      }
      setMessage(`Submission ${decision}.`);
      if (selected) await loadWorkspace(selected.id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Review failed.");
    }
  }
  async function deleteSubmission(item: Submission) {
    if (
      item.status === "pending" ||
      !confirm(`Delete this ${item.status} submission?`)
    )
      return;
    const client = requireSupabase();
    if (item.photo_path)
      await client.storage.from("submission-media").remove([item.photo_path]);
    const { error } = await client
      .from("submissions")
      .delete()
      .eq("id", item.id);
    if (error) return setMessage(error.message);
    if (selected) await loadWorkspace(selected.id);
  }
  async function archiveRecord(item: RecordItem) {
    if (!confirm(`Archive “${item.name}”?`)) return;
    const { error } = await requireSupabase()
      .from("records")
      .update({ status: "archived" })
      .eq("id", item.id);
    if (error) return setMessage(error.message);
    if (selected) await loadWorkspace(selected.id);
  }
  async function resolveAlert(item: AlertItem) {
    await requireSupabase()
      .from("alerts")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", item.id);
    if (selected) await loadWorkspace(selected.id);
  }
  async function reopenAlert(item: AlertItem) {
    await requireSupabase()
      .from("alerts")
      .update({ status: "open", resolved_at: null })
      .eq("id", item.id);
    if (selected) await loadWorkspace(selected.id);
  }

  if (!session)
    return (
      <div className="login-page">
        <form onSubmit={login}>
          <div className="brand">LOTKEEPER</div>
          <h1>Administrator sign in</h1>
          <p>
            Civic moderation and commercial activity are managed from one
            focused console.
          </p>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" required />
          </label>
          <button>Sign in</button>
          <p className="notice">{message}</p>
          <button
            type="button"
            className="quiet"
            onClick={() => navigate("home")}
          >
            Return home
          </button>
        </form>
      </div>
    );
  const pending = submissions.filter((item) => item.status === "pending");
  const resolved = submissions.filter((item) => item.status !== "pending");
  const reviewItems = reviewView === "pending" ? pending : resolved;
  const openAlerts = alerts.filter((item) => item.status === "open");
  const resolvedAlerts = alerts.filter((item) => item.status === "resolved");
  return (
    <div className="admin-page">
      <header className="admin-header">
        <button className="brand-button" onClick={() => navigate("home")}>
          <b>LOTKEEPER</b>
          <span>Admin</span>
        </button>
        <nav>
          {(["overview", "review", "records", "configure"] as Tab[]).map(
            (item) => (
              <button
                className={tab === item ? "active" : ""}
                onClick={() => setTab(item)}
                key={item}
              >
                {item}
                {item === "review" && pending.length
                  ? ` (${pending.length})`
                  : ""}
              </button>
            ),
          )}
        </nav>
        <button onClick={() => requireSupabase().auth.signOut()}>
          Sign out
        </button>
      </header>
      <div className="admin-orgbar">
        <select
          value={selected?.id || ""}
          onChange={(event) =>
            setSelected(
              organizations.find((item) => item.id === event.target.value) ||
                null,
            )
          }
        >
          {organizations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {item.mode}
            </option>
          ))}
        </select>
        <button onClick={() => setTab("create")}>+ New organization</button>
        {selected && (
          <button onClick={() => navigate(`org/${selected.slug}`)}>
            Open site ↗
          </button>
        )}
      </div>
      <main className="admin-main">
        <p className="notice">{message}</p>
        {tab === "overview" && (
          <>
            <div className="admin-title">
              <small>ORGANIZATION OVERVIEW</small>
              <h1>{selected?.name || "No organization"}</h1>
            </div>
            <div className="metric-grid">
              <article>
                <b>{pending.length}</b>
                <span>Pending reviews</span>
              </article>
              <article>
                <b>{openAlerts.length}</b>
                <span>Open alerts</span>
              </article>
              <article>
                <b>
                  {records.filter((item) => item.status === "active").length}
                </b>
                <span>Active records</span>
              </article>
              <article>
                <b>{records.filter((item) => item.quantity === 0).length}</b>
                <span>Out of stock</span>
              </article>
            </div>
            <section className="panel">
              <h2>Needs attention</h2>
              {openAlerts.map((item) => (
                <article className="alert-row" key={item.id}>
                  <div>
                    <b>{item.title}</b>
                    <p>{item.detail}</p>
                    <small>{new Date(item.created_at).toLocaleString()}</small>
                  </div>
                  <button onClick={() => resolveAlert(item)}>Resolve</button>
                </article>
              ))}
              {!openAlerts.length && (
                <div className="empty">No open alerts.</div>
              )}
            </section>
            <section className="panel">
              <h2>Resolved history</h2>
              {resolvedAlerts.map((item) => (
                <article className="alert-row" key={item.id}>
                  <div>
                    <b>{item.title}</b>
                    <p>{item.detail}</p>
                  </div>
                  <button onClick={() => reopenAlert(item)}>Reopen</button>
                </article>
              ))}
              {!resolvedAlerts.length && (
                <div className="empty">No resolved alerts.</div>
              )}
            </section>
          </>
        )}
        {tab === "review" && (
          <>
            <div className="admin-title">
              <small>MODERATION</small>
              <h1>Submission review</h1>
            </div>
            <div className="segmented">
              <button
                className={reviewView === "pending" ? "active" : ""}
                onClick={() => setReviewView("pending")}
              >
                Needs review ({pending.length})
              </button>
              <button
                className={reviewView === "resolved" ? "active" : ""}
                onClick={() => setReviewView("resolved")}
              >
                Resolved ({resolved.length})
              </button>
            </div>
            <div className="moderation-list">
              {reviewItems.map((item) => (
                <article key={item.id}>
                  <div className="moderation-status">
                    {item.status} · {item.submission_type}
                  </div>
                  <div className="review-media">
                    {submissionPhotos[item.id] ? (
                      <img
                        src={submissionPhotos[item.id]}
                        alt="Submitted evidence"
                      />
                    ) : (
                      <div className="empty">No new photo</div>
                    )}
                    <MapView
                      latitude={item.latitude}
                      longitude={item.longitude}
                      zoom={18}
                      compact
                    />
                  </div>
                  <h2>{item.proposed.name}</h2>
                  {item.target_record_id && (
                    <small>Updates an existing approved record</small>
                  )}
                  <div className="compare-grid">
                    {item.target_record_id && (
                      <div>
                        <b>Currently published</b>
                        <p>
                          {
                            records.find(
                              (record) => record.id === item.target_record_id,
                            )?.description
                          }
                        </p>
                      </div>
                    )}
                    <div>
                      <b>Proposed</b>
                      <p>{item.proposed.description}</p>
                      <span>{item.ai_suggestions?.keywords?.join(" · ")}</span>
                    </div>
                    {item.ai_status === "complete" && (
                      <div>
                        <b>AI image suggestion</b>
                        <p>{item.ai_suggestions.description}</p>
                        <span>{item.ai_suggestions.category}</span>
                        {!!item.ai_suggestions.warnings?.length && (
                          <small>
                            Review note:{" "}
                            {item.ai_suggestions.warnings.join("; ")}
                          </small>
                        )}
                      </div>
                    )}
                  </div>
                  <dl>
                    <div>
                      <dt>Submitted</dt>
                      <dd>{new Date(item.submitted_at).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Location</dt>
                      <dd>{item.location_source.replaceAll("_", " ")}</dd>
                    </div>
                    <div>
                      <dt>AI</dt>
                      <dd>{item.ai_status}</dd>
                    </div>
                  </dl>
                  <div className="moderation-actions">
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
                        className="danger"
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
        {tab === "records" && (
          <>
            <div className="admin-title">
              <small>APPROVED DATA</small>
              <h1>Records</h1>
            </div>
            <div className="record-admin-list">
              {records.map((item) => (
                <article key={item.id}>
                  <div>
                    <small>
                      {item.category} · version {item.version}
                    </small>
                    <b>{item.name}</b>
                    <p>{item.description}</p>
                  </div>
                  <span>
                    {item.quantity !== null
                      ? `${item.quantity} ${item.unit || ""}`
                      : item.status}
                  </span>
                  <button onClick={() => archiveRecord(item)}>Archive</button>
                </article>
              ))}
            </div>
          </>
        )}
        {tab === "configure" && selected && (
          <>
            <div className="admin-title">
              <small>DATA MODEL</small>
              <h1>Collections and fields</h1>
              <p>
                Choose what is public, searchable and open to public
                contribution.
              </p>
            </div>
            <CollectionEditor
              value={editCollections}
              onChange={setEditCollections}
            />
            <label className="access-setting panel">
              <input
                type="checkbox"
                checked={editPublic}
                onChange={(event) => setEditPublic(event.target.checked)}
              />
              <span>
                <b>Public deployment</b>
                <small>
                  Anyone can open public collections. Private deployments
                  require an assigned user account.
                </small>
              </span>
            </label>
            <label className="access-setting panel">
              <input
                type="checkbox"
                checked={editAi}
                onChange={(event) => setEditAi(event.target.checked)}
              />
              <span>
                <b>AI image suggestions</b>
                <small>
                  Generate draft descriptions, categories and search terms for
                  new photos. Administrators still approve every result.
                </small>
              </span>
            </label>
            <OrganizationMapEditor value={editMap} onChange={setEditMap} />
            <button className="save-button" onClick={saveConfiguration}>
              Save configuration
            </button>
          </>
        )}
        {tab === "create" && (
          <>
            <div className="admin-title">
              <small>NEW DEPLOYMENT</small>
              <h1>Create an organization</h1>
            </div>
            <form className="create-org" onSubmit={createOrganization}>
              <label>
                Name
                <input name="name" required />
              </label>
              <label>
                URL slug
                <input name="slug" pattern="[a-z0-9-]+" required />
              </label>
              <label>
                Mode
                <select
                  name="mode"
                  value={createMode}
                  onChange={(event) => {
                    const mode = event.target.value as "civic" | "commercial";
                    setCreateMode(mode);
                    setCreatePublic(mode === "civic");
                  }}
                >
                  <option value="civic">Civic · public contributions</option>
                  <option value="commercial">
                    Commercial · authenticated inventory
                  </option>
                </select>
              </label>
              <label className="access-setting">
                <input
                  type="checkbox"
                  checked={createPublic}
                  onChange={(event) => setCreatePublic(event.target.checked)}
                />
                <span>
                  <b>Public deployment</b>
                  <small>Turn off for a staff-only site.</small>
                </span>
              </label>
              <OrganizationMapEditor
                value={createMap}
                onChange={setCreateMap}
              />
              <button>Create organization</button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
