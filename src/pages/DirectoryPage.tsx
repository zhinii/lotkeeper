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
      const items = ((recordRows || []) as RecordItem[]).map((item) => ({
        ...item,
        data: { ...item.data, ...(privateByRecord.get(item.id) || {}) },
      }));
      setRecords(items);
      setSelectedId(items[0]?.id || null);
      setLoading(false);
    })();
  }, [slug]);

  const visibleCollections =
    organization?.collections.filter(
      (item) => item.publicVisible || isMember,
    ) || [];
  const filtered = useMemo(
    () =>
      records.filter(
        (item) =>
          (collection === "all" || item.collection_id === collection) &&
          `${item.name} ${item.description} ${item.category} ${item.keywords.join(" ")} ${JSON.stringify(item.data)}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [records, query, collection],
  );
  const selected =
    filtered.find((item) => item.id === selectedId) || filtered[0] || null;

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
        result_count: filtered.length,
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
        <button className="brand-button" onClick={() => navigate("home")}>
          <b>LOTKEEPER</b>
          <span>{organization.name}</span>
        </button>
        <div className="directory-search">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && recordSearch()}
            placeholder="Search names, images, keywords, identifiers or descriptions"
          />
          <button onClick={recordSearch}>Search</button>
        </div>
        <div className="header-buttons">
          <span className={`mode-badge ${organization.mode}`}>
            {organization.mode}
          </span>
          {(organization.mode === "civic" || isMember) && (
            <button onClick={() => navigate(`submit/${organization.slug}`)}>
              {organization.mode === "civic" ? "+ Submit" : "+ Add record"}
            </button>
          )}
          <button onClick={() => navigate("admin")}>Admin</button>
        </div>
      </header>
      <nav className="collection-strip">
        <button
          className={collection === "all" ? "active" : ""}
          onClick={() => setCollection("all")}
        >
          All <b>{records.length}</b>
        </button>
        {visibleCollections.map((item) => (
          <button
            className={collection === item.id ? "active" : ""}
            onClick={() => setCollection(item.id)}
            key={item.id}
          >
            {item.name}{" "}
            <b>
              {
                records.filter((record) => record.collection_id === item.id)
                  .length
              }
            </b>
          </button>
        ))}
      </nav>
      <main className="directory-split">
        <section className="results-column">
          <div className="results-heading">
            <div>
              <small>SEARCH RESULTS</small>
              <h1>
                {collection === "all"
                  ? "Everything"
                  : visibleCollections.find((item) => item.id === collection)
                      ?.name}
              </h1>
            </div>
            <span>{filtered.length}</span>
          </div>
          {message && <p className="notice">{message}</p>}
          {filtered.map((item) => (
            <button
              className={`record-card ${selected?.id === item.id ? "selected" : ""}`}
              key={item.id}
              onClick={() => {
                setSelectedId(item.id);
                setInventoryOpen(false);
              }}
            >
              <img src={publicPhoto(item.photo_path)} alt="" />
              <div>
                <small>
                  {item.category} ·{" "}
                  {new Date(
                    item.photo_taken_at || item.updated_at,
                  ).toLocaleDateString()}
                </small>
                <strong>{item.name}</strong>
                <p>{item.description}</p>
                <span className="keyword-line">
                  {item.keywords.slice(0, 5).map((keyword) => (
                    <i key={keyword}>{keyword}</i>
                  ))}
                </span>
              </div>
              {item.quantity !== null && (
                <output>
                  {item.quantity}
                  <small>{item.unit}</small>
                </output>
              )}
            </button>
          ))}
          {!filtered.length && (
            <div className="empty">
              <h2>No matches</h2>
              <p>Try fewer words or submit the missing location.</p>
            </div>
          )}
        </section>
        <aside className="map-column">
          <MapView
            latitude={selected?.latitude || organization.center_lat}
            longitude={selected?.longitude || organization.center_lng}
            zoom={
              selected
                ? Math.max(organization.map_zoom, 17)
                : organization.map_zoom
            }
            records={filtered}
            selectedId={selected?.id}
            onSelect={setSelectedId}
            boundary={organization.boundary}
          />
          {selected && (
            <article className="record-detail">
              {selected.photo_path && (
                <img src={publicPhoto(selected.photo_path)} alt="" />
              )}
              <small>
                {selected.category} · verified{" "}
                {new Date(selected.updated_at).toLocaleDateString()}
              </small>
              <h2>{selected.name}</h2>
              <p>{selected.description}</p>
              <div className="detail-actions">
                <button
                  onClick={() =>
                    navigate(`submit/${organization.slug}/${selected.id}`)
                  }
                >
                  Update photo or description
                </button>
                {organization.mode === "commercial" &&
                  isMember &&
                  organization.collections.find(
                    (item) => item.id === selected.collection_id,
                  )?.kind === "consumable" && (
                    <button
                      className="primary"
                      onClick={() => setInventoryOpen((value) => !value)}
                    >
                      I took or used something
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
            </article>
          )}
        </aside>
      </main>
    </div>
  );
}
