import { useEffect, useState } from "react";
import CollectionEditor from "../components/CollectionEditor";
import MapView from "../components/MapView";
import OrganizationMapEditor, {
  type MapConfiguration,
} from "../components/OrganizationMapEditor";
import { captureFieldLabel } from "../lib/captureFields";
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

const adminTabs: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Home", icon: "⌂" },
  { id: "review", label: "Review", icon: "✓" },
  { id: "records", label: "Items", icon: "▦" },
  { id: "configure", label: "Settings", icon: "⚙" },
];

function cloneCollections(collections: CollectionDefinition[]) {
  return collections.map((collection) => ({
    ...collection,
    fields: collection.fields.map((field) => ({ ...field })),
  }));
}

function aiStatusLabel(status: Submission["ai_status"]) {
  if (status === "complete") return "Suggestions ready";
  if (status === "queued" || status === "processing") return "Analyzing photo";
  if (status === "failed") return "Photo analysis needs another try";
  return "Photo analysis not used";
}

export default function AdminPage() {
  const [session, setSession] = useState<any>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
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
  const [createCollections, setCreateCollections] = useState<
    CollectionDefinition[]
  >(() => cloneCollections(civicDefaults));
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
  async function sendMagicLink(formElement: HTMLFormElement) {
    const form = new FormData(formElement);
    const email = String(form.get("email") || "").trim();
    if (!email) return setMessage("Enter your administrator email first.");
    const redirectTo = `${location.origin}${location.pathname}#/admin`;
    const { error } = await requireSupabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    setMessage(
      error
        ? error.message
        : "A secure sign-in link was sent. Open it on this device to continue.",
    );
  }
  async function loadOrganizations() {
    const client = requireSupabase();
    const [{ data, error }, { data: platformRows }] = await Promise.all([
      client.from("organizations").select("*").order("name"),
      client.from("platform_admins").select("user_id").limit(1),
    ]);
    if (error) return setMessage(error.message);
    setIsPlatformAdmin(Boolean(platformRows?.length));
    const rows = (data || []) as Organization[];
    setOrganizations(rows);
    setSelected(
      (current) =>
        rows.find((item) => item.id === current?.id) || rows[0] || null,
    );
  }
  async function loadWorkspace(organizationId: string) {
    const client = requireSupabase();
    const [submissionRows, recordRows, privateRows, alertRows] =
      await Promise.all([
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
          .from("record_private_data")
          .select("record_id,data")
          .eq("organization_id", organizationId),
        client
          .from("alerts")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false }),
      ]);
    setSubmissions((submissionRows.data || []) as Submission[]);
    const privateByRecord = new Map(
      (privateRows.data || []).map((row) => [
        row.record_id,
        row.data as Record<string, unknown>,
      ]),
    );
    setRecords(
      ((recordRows.data || []) as RecordItem[]).map((record) => ({
        ...record,
        data: { ...record.data, ...(privateByRecord.get(record.id) || {}) },
      })),
    );
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
    const client = requireSupabase();
    const { data: newId, error } = await client.rpc("create_organization", {
      org_name: String(form.get("name")),
      org_slug: String(form.get("slug")),
      org_mode: mode,
      is_public: createPublic,
      latitude: createMap.latitude,
      longitude: createMap.longitude,
      zoom_level: createMap.zoom,
      collection_config: createCollections,
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
  async function retryAi(item: Submission) {
    const client = requireSupabase();
    setMessage("Trying the photo analysis again…");
    const { error: queueError } = await client
      .from("submissions")
      .update({ ai_status: "queued", ai_suggestions: {} })
      .eq("id", item.id)
      .eq("status", "pending");
    if (queueError) return setMessage(queueError.message);
    const { error } = await client.functions.invoke("enrich-submission", {
      body: { submission_id: item.id },
    });
    if (error) setMessage(`Photo analysis could not start: ${error.message}`);
    else setMessage("Photo analysis finished. Review the suggestions below.");
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
          <small>MANAGER ACCESS</small>
          <h1>Welcome back</h1>
          <p>Sign in to review submissions and manage your organization.</p>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" required />
          </label>
          <button>Sign in</button>
          <button
            type="button"
            className="quiet"
            onClick={(event) => sendMagicLink(event.currentTarget.form!)}
          >
            Email me a secure sign-in link
          </button>
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
          <span>Manager</span>
        </button>
        <nav aria-label="Manager sections">
          {adminTabs.map((item) => (
            <button
              className={tab === item.id ? "active" : ""}
              onClick={() => setTab(item.id)}
              key={item.id}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
              {item.id === "review" && pending.length
                ? ` (${pending.length})`
                : ""}
            </button>
          ))}
        </nav>
        <button
          className="admin-signout"
          onClick={() => requireSupabase().auth.signOut()}
        >
          Sign out
        </button>
      </header>
      <div className="admin-orgbar">
        <label>
          <small>MANAGING</small>
          <select
            aria-label="Organization"
            value={selected?.id || ""}
            disabled={!organizations.length}
            onChange={(event) =>
              setSelected(
                organizations.find((item) => item.id === event.target.value) ||
                  null,
              )
            }
          >
            {!organizations.length && (
              <option value="">No organizations yet</option>
            )}
            {organizations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.mode}
              </option>
            ))}
          </select>
        </label>
        {isPlatformAdmin && (
          <button className="admin-new-org" onClick={() => setTab("create")}>
            + New organization
          </button>
        )}
        {selected && (
          <button
            className="admin-open-site"
            onClick={() => navigate(`org/${selected.slug}`)}
          >
            View public site ↗
          </button>
        )}
      </div>
      <main className="admin-main">
        <p className="notice">{message}</p>
        {tab === "overview" && !selected && (
          <section className="admin-empty-state panel">
            <small>GET STARTED</small>
            <h1>Create your first organization</h1>
            <p>
              An organization is one deployed site. Choose civic or commercial,
              define its collections and fields, then set its map and boundary.
            </p>
            {isPlatformAdmin ? (
              <button onClick={() => setTab("create")}>
                Create the first organization
              </button>
            ) : (
              <div className="access-warning">
                This login has not been assigned platform-administrator access.
                Ask a platform administrator to assign the role before creating
                deployments.
              </div>
            )}
          </section>
        )}
        {tab === "overview" && selected && (
          <>
            <div className="admin-title">
              <small>MANAGER HOME</small>
              <h1>What do you need to do?</h1>
              <p>{selected.name}</p>
            </div>
            <div className="admin-task-grid">
              <button onClick={() => setTab("review")}>
                <span className="task-icon review">✓</span>
                <span>
                  <b>Review submissions</b>
                  <small>
                    {pending.length
                      ? `${pending.length} waiting for a decision`
                      : "Nothing is waiting"}
                  </small>
                </span>
                <i>→</i>
              </button>
              <button onClick={() => setTab("records")}>
                <span className="task-icon items">▦</span>
                <span>
                  <b>Manage items</b>
                  <small>{records.length} approved entries</small>
                </span>
                <i>→</i>
              </button>
              <button onClick={() => setTab("configure")}>
                <span className="task-icon settings">⚙</span>
                <span>
                  <b>Change organization settings</b>
                  <small>Lists, access, AI and map</small>
                </span>
                <i>→</i>
              </button>
              <button onClick={() => navigate(`org/${selected.slug}`)}>
                <span className="task-icon site">↗</span>
                <span>
                  <b>View the public site</b>
                  <small>See what visitors see</small>
                </span>
                <i>→</i>
              </button>
            </div>
            <h2 className="admin-section-label">At a glance</h2>
            <div className="metric-grid">
              <article>
                <b>{pending.length}</b>
                <span>Waiting for review</span>
              </article>
              <article>
                <b>{openAlerts.length}</b>
                <span>Need attention</span>
              </article>
              <article>
                <b>
                  {records.filter((item) => item.status === "active").length}
                </b>
                <span>Published items</span>
              </article>
              <article>
                <b>{records.filter((item) => item.quantity === 0).length}</b>
                <span>Out of stock</span>
              </article>
            </div>
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <small>FOLLOW UP</small>
                  <h2>Needs attention</h2>
                </div>
                <span>{openAlerts.length}</span>
              </div>
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
            <details className="panel resolved-panel">
              <summary>
                Resolved history <span>{resolvedAlerts.length}</span>
              </summary>
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
            </details>
          </>
        )}
        {tab === "review" && (
          <>
            <div className="admin-title">
              <small>CHECK BEFORE PUBLISHING</small>
              <h1>Review submissions</h1>
              <p>
                Look at the photo and details, then choose Approve or Reject.
              </p>
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
                    {item.status === "pending"
                      ? "Waiting for your decision"
                      : item.status === "approved"
                        ? "Approved"
                        : "Rejected"}
                    {item.submission_type === "update"
                      ? " · update to an item"
                      : " · new item"}
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
                      <b>Submitted description</b>
                      <p>{item.proposed.description}</p>
                      <span>{item.ai_suggestions?.keywords?.join(" · ")}</span>
                    </div>
                    {item.ai_status === "complete" && (
                      <div>
                        <b>Suggested from the photo</b>
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
                    {item.ai_status === "failed" && (
                      <div className="ai-failed">
                        <b>Photo suggestions were not created</b>
                        <p>
                          The submission is safe to review without them, or you
                          can try again.
                        </p>
                        <button onClick={() => retryAi(item)}>Try again</button>
                      </div>
                    )}
                  </div>
                  <dl>
                    <div>
                      <dt>Submitted</dt>
                      <dd>{new Date(item.submitted_at).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Map location</dt>
                      <dd>
                        {item.location_source === "photo_exif"
                          ? "From the photo"
                          : item.location_source === "browser_gps"
                            ? "From the device"
                            : "Placed on the map"}
                      </dd>
                    </div>
                    <div>
                      <dt>Photo suggestions</dt>
                      <dd>{aiStatusLabel(item.ai_status)}</dd>
                    </div>
                    <div>
                      <dt>Quantity</dt>
                      <dd>
                        {item.proposed.quantity ?? "Not provided"}{" "}
                        {item.proposed.unit || ""}
                      </dd>
                    </div>
                    <div>
                      <dt>Date of capture</dt>
                      <dd>
                        {item.photo_taken_at
                          ? new Date(item.photo_taken_at).toLocaleString()
                          : "Not provided"}
                      </dd>
                    </div>
                    {Object.entries(item.proposed.data || {})
                      .filter(([, value]) => value !== "" && value != null)
                      .map(([key, value]) => (
                        <div key={key}>
                          <dt>{captureFieldLabel(key)}</dt>
                          <dd>{String(value)}</dd>
                        </div>
                      ))}
                  </dl>
                  <div className="moderation-actions">
                    {item.status === "pending" ? (
                      <>
                        <button
                          className="reject"
                          onClick={() => review(item, "rejected")}
                        >
                          Reject submission
                        </button>
                        <button
                          className="approve"
                          onClick={() => review(item, "approved")}
                        >
                          Approve and publish
                        </button>
                      </>
                    ) : (
                      <button
                        className="danger"
                        onClick={() => deleteSubmission(item)}
                      >
                        Delete from history
                      </button>
                    )}
                  </div>
                </article>
              ))}
              {!reviewItems.length && (
                <div className="admin-list-empty">
                  <span>✓</span>
                  <h2>
                    {reviewView === "pending"
                      ? "You are all caught up"
                      : "No review history yet"}
                  </h2>
                  <p>
                    {reviewView === "pending"
                      ? "New public submissions will appear here."
                      : "Approved and rejected submissions will appear here."}
                  </p>
                </div>
              )}
            </div>
          </>
        )}
        {tab === "records" && (
          <>
            <div className="admin-title">
              <small>WHAT IS PUBLISHED</small>
              <h1>Manage items</h1>
              <p>These entries are visible in your organization directory.</p>
            </div>
            <div className="record-admin-list">
              {records.map((item) => (
                <article key={item.id}>
                  <div>
                    <small>
                      {item.category || "Uncategorized"} · last updated{" "}
                      {new Date(item.updated_at).toLocaleDateString()}
                    </small>
                    <b>{item.name}</b>
                    <p>{item.description}</p>
                    {item.data.sku != null && item.data.sku !== "" && (
                      <small>SKU # / asset ID: {String(item.data.sku)}</small>
                    )}
                  </div>
                  <span>
                    {item.quantity !== null
                      ? `${item.quantity} ${item.unit || ""}`
                      : item.status}
                  </span>
                  <button onClick={() => archiveRecord(item)}>Archive</button>
                </article>
              ))}
              {!records.length && (
                <div className="admin-list-empty">
                  <span>▦</span>
                  <h2>No approved items yet</h2>
                  <p>Approve a submission to publish the first item.</p>
                </div>
              )}
            </div>
          </>
        )}
        {tab === "configure" && !selected && (
          <section className="admin-empty-state panel">
            <small>CONFIGURATION</small>
            <h1>No organization to configure</h1>
            <p>
              Create an organization first. Its civic or commercial type,
              collections, fields, public access, AI options and map are all set
              in the guided setup.
            </p>
            {isPlatformAdmin ? (
              <button onClick={() => setTab("create")}>
                Create an organization
              </button>
            ) : (
              <div className="access-warning">
                Your account can sign in, but it does not have permission to
                create deployments.
              </div>
            )}
          </section>
        )}
        {tab === "configure" && selected && (
          <>
            <div className="admin-title">
              <small>ORGANIZATION SETTINGS</small>
              <h1>Set up {selected.name}</h1>
              <p>Change what people see, what they can add, and where it is.</p>
            </div>
            <section className="settings-section">
              <div className="settings-step">1</div>
              <div className="settings-content">
                <h2>Lists and information</h2>
                <p>
                  Create the lists people browse, such as parks, equipment or
                  inventory. Open a list to change the information it collects.
                </p>
                <CollectionEditor
                  value={editCollections}
                  onChange={setEditCollections}
                />
              </div>
            </section>
            <section className="settings-section">
              <div className="settings-step">2</div>
              <div className="settings-content">
                <h2>Access and photo help</h2>
                <p>Choose who can open the site and how photos are reviewed.</p>
                <label className="access-setting panel">
                  <input
                    type="checkbox"
                    checked={editPublic}
                    onChange={(event) => setEditPublic(event.target.checked)}
                  />
                  <span>
                    <b>Anyone can open this organization</b>
                    <small>
                      Turn this off when only assigned staff should have access.
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
                    <b>Suggest descriptions from uploaded photos</b>
                    <small>
                      Suggestions never publish automatically. A manager still
                      approves every submission.
                    </small>
                  </span>
                </label>
              </div>
            </section>
            <section className="settings-section map-settings-section">
              <div className="settings-step">3</div>
              <div className="settings-content">
                <OrganizationMapEditor value={editMap} onChange={setEditMap} />
              </div>
            </section>
            <div className="settings-save-bar">
              <span>Changes are not live until you save.</span>
              <button className="save-button" onClick={saveConfiguration}>
                Save changes
              </button>
            </div>
          </>
        )}
        {tab === "create" && (
          <>
            <div className="admin-title">
              <small>ADD AN ORGANIZATION</small>
              <h1>Set up a new site</h1>
              <p>Follow the three steps. You can change everything later.</p>
            </div>
            <form className="create-org" onSubmit={createOrganization}>
              <section className="create-step">
                <div className="step-heading">
                  <b>1</b>
                  <span>
                    <h2>Organization basics</h2>
                    <p>Name it and choose the closest starting setup.</p>
                  </span>
                </div>
                <div className="create-identity-grid">
                  <label>
                    Organization name
                    <input
                      name="name"
                      placeholder="City parks, north yard, main store…"
                      required
                    />
                  </label>
                  <label>
                    URL name
                    <input
                      name="slug"
                      placeholder="city-parks"
                      pattern="[a-z0-9-]+"
                      required
                    />
                  </label>
                </div>
                <label>
                  What will this organization manage?
                  <select
                    name="mode"
                    value={createMode}
                    onChange={(event) => {
                      const mode = event.target.value as "civic" | "commercial";
                      setCreateMode(mode);
                      setCreatePublic(mode === "civic");
                      setCreateCollections(
                        cloneCollections(
                          mode === "civic" ? civicDefaults : commercialDefaults,
                        ),
                      );
                    }}
                  >
                    <option value="civic">
                      Civic · public places and contributions
                    </option>
                    <option value="commercial">
                      Commercial · inventory, materials and equipment
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
                    <b>Anyone can open this organization</b>
                    <small>Turn this off when it is only for staff.</small>
                  </span>
                </label>
              </section>
              <section className="create-step">
                <div className="step-heading">
                  <b>2</b>
                  <span>
                    <h2>Lists and information</h2>
                    <p>
                      Rename the starting lists and choose what information
                      people enter for each item.
                    </p>
                  </span>
                </div>
                <CollectionEditor
                  value={createCollections}
                  onChange={setCreateCollections}
                />
              </section>
              <section className="create-step">
                <div className="step-heading">
                  <b>3</b>
                  <span>
                    <h2>Map area</h2>
                    <p>Show where this organization is located.</p>
                  </span>
                </div>
                <OrganizationMapEditor
                  value={createMap}
                  onChange={setCreateMap}
                />
              </section>
              <button>Create organization</button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
