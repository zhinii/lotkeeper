import { useEffect, useMemo, useState } from "react";
import MapView from "../components/MapView";
import { navigate } from "../lib/route";
import { publicPhoto, requireSupabase } from "../lib/supabase";
import type { Organization, RecordItem } from "../types";

export default function DirectoryPage({ slug }: { slug: string }) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [isMember, setIsMember] = useState(false);

  useEffect(() => {
    (async () => {
      const client = requireSupabase();
      const { data: org, error } = await client
        .from("organizations")
        .select("*")
        .eq("slug", slug)
        .single();
      if (error) {
        setMessage(error.message);
        setLoading(false);
        return;
      }
      setOrganization(org as Organization);
      const { data: recordRows } = await client
        .from("records")
        .select("*")
        .eq("organization_id", org.id)
        .eq("status", "active")
        .order("updated_at", { ascending: false });
      const { data: authData } = await client.auth.getUser();
      let privateByRecord = new Map<string, Record<string, unknown>>();
      if (authData.user) {
        const [{ data: memberships }, { data: privateRows }] =
          await Promise.all([
            client
              .from("organization_members")
              .select("organization_id")
              .eq("organization_id", org.id),
            client
              .from("record_private_data")
              .select("record_id,data")
              .eq("organization_id", org.id),
          ]);
        setIsMember(Boolean(memberships?.length));
        privateByRecord = new Map(
          (privateRows || []).map((row) => [
            row.record_id,
            row.data as Record<string, unknown>,
          ]),
        );
      }
      setRecords(
        ((recordRows || []) as RecordItem[]).map((item) => ({
          ...item,
          data: { ...item.data, ...(privateByRecord.get(item.id) || {}) },
        })),
      );
      setLoading(false);
    })();
  }, [slug]);

  useEffect(() => {
    if (!detailOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailOpen(false);
    };
    addEventListener("keydown", closeOnEscape);
    return () => removeEventListener("keydown", closeOnEscape);
  }, [detailOpen]);

  const visibleCollections = useMemo(
    () =>
      organization?.collections.filter(
        (item) => item.publicVisible || isMember,
      ) || [],
    [organization, isMember],
  );
  const visibleRecords = useMemo(
    () =>
      records.filter(
        (item) =>
          (collection === "all" || item.collection_id === collection) &&
          `${item.name} ${item.description} ${item.category} ${item.keywords.join(" ")} ${JSON.stringify(item.data)}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ),
    [records, query, collection],
  );
  const selected = records.find((item) => item.id === selectedId) || null;
  const selectedCollection = visibleCollections.find(
    (item) => item.id === selected?.collection_id,
  );
  const sectionName =
    collection === "all"
      ? "All entries"
      : visibleCollections.find((item) => item.id === collection)?.name ||
        "Entries";

  function selectCollection(id: string) {
    setCollection(id);
    setSelectedId(null);
    setDetailOpen(false);
    setInventoryOpen(false);
  }

  function openRecord(id: string) {
    setSelectedId(id);
    setDetailOpen(true);
    setInventoryOpen(false);
  }

  async function recordSearch() {
    if (
      !organization ||
      organization.mode !== "commercial" ||
      !isMember ||
      !query.trim()
    )
      return;
    await requireSupabase()
      .from("search_events")
      .insert({
        organization_id: organization.id,
        query: query.trim(),
        result_count: visibleRecords.length,
        opened_record_id: selected?.id || null,
      });
  }

  async function recordUse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get("amount"));
    const { error } = await requireSupabase().rpc("record_inventory_use", {
      target_record: selected.id,
      amount_used: amount,
      note_text: String(form.get("note") || ""),
    });
    if (error) return setMessage(error.message);
    setMessage("Inventory use recorded and the administrator was alerted.");
    setInventoryOpen(false);
    setRecords((items) =>
      items.map((item) =>
        item.id === selected.id && item.quantity !== null
          ? { ...item, quantity: Math.max(0, item.quantity - amount) }
          : item,
      ),
    );
  }

  if (loading) return <div className="loading">Loading location…</div>;
  if (!organization)
    return (
      <div className="empty">
        <h1>Organization unavailable</h1>
        <p>{message}</p>
        <button onClick={() => navigate("home")}>Return home</button>
      </div>
    );

  return (
    <div className="directory-page">
      <header className="directory-header">
        <button
          className="directory-back"
          onClick={() => navigate("home")}
          aria-label="Back to organizations"
        >
          ←
        </button>
        <div className="directory-identity">
          <small>LOTKEEPER</small>
          <strong>{organization.name}</strong>
        </div>
        <button className="directory-admin" onClick={() => navigate("admin")}>
          Admin
        </button>
      </header>

      <main className="directory-workspace">
        <aside className="collection-nav" aria-label="Collections">
          <div className="collection-nav-title">
            <small>BROWSE</small>
            <strong>Collections</strong>
          </div>
          <button
            className={collection === "all" ? "active" : ""}
            onClick={() => selectCollection("all")}
          >
            <span className="collection-icon">⌂</span>
            <span>All entries</span>
            <b>{records.length}</b>
          </button>
          {visibleCollections.map((item) => (
            <button
              className={collection === item.id ? "active" : ""}
              onClick={() => selectCollection(item.id)}
              key={item.id}
            >
              <span className="collection-icon" aria-hidden="true">
                {item.icon || "•"}
              </span>
              <span>{item.name}</span>
              <b>
                {
                  records.filter((record) => record.collection_id === item.id)
                    .length
                }
              </b>
            </button>
          ))}
        </aside>

        <section className="directory-content">
          <div className="directory-content-head">
            <div>
              <small>{organization.mode} directory</small>
              <h1>{sectionName}</h1>
            </div>
            <label className="directory-filter">
              <span className="sr-only">Filter this collection</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && recordSearch()}
                placeholder="Filter this collection"
              />
              {query && (
                <button onClick={() => setQuery("")} aria-label="Clear filter">
                  ×
                </button>
              )}
            </label>
          </div>

          {message && <p className="notice">{message}</p>}
          <div className="directory-map-wrap">
            <MapView
              latitude={organization.center_lat}
              longitude={organization.center_lng}
              zoom={organization.map_zoom}
              records={visibleRecords}
              selectedId={selectedId}
              onSelect={openRecord}
              boundary={organization.boundary}
            />
            <span className="map-count">
              {visibleRecords.length}{" "}
              {visibleRecords.length === 1 ? "pin" : "pins"}
            </span>
          </div>

          <div className="card-section-head">
            <h2>{sectionName}</h2>
            <span>{visibleRecords.length}</span>
          </div>
          <div className="record-grid">
            {visibleRecords.map((item) => (
              <button
                className="record-card"
                key={item.id}
                onClick={() => openRecord(item.id)}
              >
                {item.photo_path ? (
                  <img src={publicPhoto(item.photo_path)} alt="" />
                ) : (
                  <span className="record-photo-empty" aria-hidden="true">
                    No photo
                  </span>
                )}
                <div className="record-card-copy">
                  <small>
                    {item.category ||
                      visibleCollections.find(
                        (visible) => visible.id === item.collection_id,
                      )?.name ||
                      "Entry"}
                  </small>
                  <strong>{item.name}</strong>
                  <p>{item.description}</p>
                  {item.quantity !== null && (
                    <output>
                      {item.quantity} <small>{item.unit}</small>
                    </output>
                  )}
                </div>
                <span className="record-card-arrow" aria-hidden="true">
                  →
                </span>
              </button>
            ))}
          </div>
          {!visibleRecords.length && (
            <div className="empty directory-empty">
              <h2>No entries here yet</h2>
              <p>Choose another collection or add the first entry.</p>
            </div>
          )}
        </section>
      </main>

      {(organization.mode === "civic" || isMember) && (
        <button
          className="floating-add"
          onClick={() => navigate(`submit/${organization.slug}`)}
          aria-label="Add an entry"
          title="Add an entry"
        >
          +
        </button>
      )}

      {detailOpen && selected && (
        <div
          className="detail-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDetailOpen(false);
          }}
        >
          <article
            className="record-detail-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="record-title"
          >
            <button
              className="detail-close"
              onClick={() => setDetailOpen(false)}
              aria-label="Close details"
            >
              ×
            </button>
            {selected.photo_path ? (
              <img
                className="detail-photo"
                src={publicPhoto(selected.photo_path)}
                alt=""
              />
            ) : (
              <div className="detail-photo detail-photo-empty">No photo</div>
            )}
            <div className="detail-body">
              <small className="detail-eyebrow">
                {selectedCollection?.name || selected.category || "Entry"} ·
                updated {new Date(selected.updated_at).toLocaleDateString()}
              </small>
              <h2 id="record-title">{selected.name}</h2>
              <p>{selected.description || "No description has been added."}</p>
              {selected.quantity !== null && (
                <div className="quantity-panel">
                  <span>Available</span>
                  <strong>
                    {selected.quantity} {selected.unit}
                  </strong>
                </div>
              )}
              {!!selected.keywords.length && (
                <div className="keyword-line detail-keywords">
                  {selected.keywords.map((keyword) => (
                    <i key={keyword}>{keyword}</i>
                  ))}
                </div>
              )}
              <dl className="record-data">
                {selectedCollection?.fields
                  .filter(
                    (field) =>
                      (field.publicVisible || isMember) &&
                      selected.data[field.key] !== undefined &&
                      selected.data[field.key] !== "",
                  )
                  .map((field) => (
                    <div key={field.key}>
                      <dt>{field.label}</dt>
                      <dd>{String(selected.data[field.key])}</dd>
                    </div>
                  ))}
                <div>
                  <dt>Location</dt>
                  <dd>
                    {selected.latitude.toFixed(5)},{" "}
                    {selected.longitude.toFixed(5)}
                  </dd>
                </div>
              </dl>
              <div className="detail-actions">
                <button
                  onClick={() =>
                    navigate(`submit/${organization.slug}/${selected.id}`)
                  }
                >
                  Update this entry
                </button>
                {organization.mode === "commercial" &&
                  isMember &&
                  selectedCollection?.kind === "consumable" && (
                    <button
                      className="primary"
                      onClick={() => setInventoryOpen((value) => !value)}
                    >
                      Record quantity used
                    </button>
                  )}
              </div>
              {inventoryOpen && (
                <form className="inventory-use" onSubmit={recordUse}>
                  <h3>Record inventory used</h3>
                  <label>
                    Amount
                    <input
                      name="amount"
                      type="number"
                      min="0.01"
                      step="any"
                      required
                    />
                  </label>
                  <label>
                    Note
                    <input name="note" placeholder="Optional context" />
                  </label>
                  <button>Confirm and alert admin</button>
                </form>
              )}
            </div>
          </article>
        </div>
      )}
    </div>
  );
}
