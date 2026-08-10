import { useEffect, useMemo, useRef, useState } from "react";
import MapView from "../components/MapView";
import { navigate } from "../lib/route";
import { publicPhoto, requireSupabase } from "../lib/supabase";
import type { Organization, RecordItem } from "../types";

type AvailabilityFilter = "all" | "available" | "empty" | "untracked";

function itemLocation(item: RecordItem) {
  return String(
    item.data.location ||
      item.data.location_code ||
      item.data.storage_location ||
      item.data.bin ||
      "",
  ).trim();
}

function searchableText(item: RecordItem) {
  return [
    item.name,
    item.description,
    item.category,
    item.collection_id,
    item.keywords.join(" "),
    item.data.sku,
    item.data.asset_id,
    item.data.manufacturer,
    item.data.location,
    item.data.location_code,
    item.data.storage_location,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

async function imagePreview(file: File) {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    const url = URL.createObjectURL(file);
    element.onload = () => {
      URL.revokeObjectURL(url);
      resolve(element);
    };
    element.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be opened."));
    };
    element.src = url;
  });
  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.76);
}

export default function DirectoryPage({ slug }: { slug: string }) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [query, setQuery] = useState("");
  const [collection, setCollection] = useState("all");
  const [category, setCategory] = useState("all");
  const [availability, setAvailability] =
    useState<AvailabilityFilter>("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [imageSearching, setImageSearching] = useState(false);
  const [imageSearchLabel, setImageSearchLabel] = useState("");
  const [searchKind, setSearchKind] = useState<"text" | "image">("text");
  const [isMember, setIsMember] = useState(false);
  const photoSearchInput = useRef<HTMLInputElement>(null);

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
      const [{ data: recordRows }, { data: authData }] = await Promise.all([
        client
          .from("records")
          .select("*")
          .eq("organization_id", org.id)
          .eq("status", "active")
          .order("updated_at", { ascending: false }),
        client.auth.getUser(),
      ]);
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

  const visibleCollections = useMemo(
    () =>
      organization?.collections.filter(
        (item) => item.publicVisible || isMember,
      ) || [],
    [organization, isMember],
  );
  const categories = useMemo(
    () =>
      [...new Set(records.map((item) => item.category).filter(Boolean))].sort(),
    [records],
  );
  const locations = useMemo(
    () => [...new Set(records.map(itemLocation).filter(Boolean))].sort(),
    [records],
  );
  const visibleRecords = useMemo(() => {
    const terms = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return records.filter((item) => {
      if (collection !== "all" && item.collection_id !== collection) return false;
      if (category !== "all" && item.category !== category) return false;
      if (locationFilter !== "all" && itemLocation(item) !== locationFilter)
        return false;
      if (availability === "available" && !(item.quantity === null || item.quantity > 0))
        return false;
      if (availability === "empty" && item.quantity !== 0) return false;
      if (availability === "untracked" && item.quantity !== null) return false;
      const haystack = searchableText(item);
      return searchKind === "image"
        ? terms.some((term) => term.length > 2 && haystack.includes(term))
        : terms.every((term) => haystack.includes(term));
    });
  }, [records, query, collection, category, availability, locationFilter, searchKind]);

  const selected = records.find((item) => item.id === selectedId) || null;
  const selectedCollection = visibleCollections.find(
    (item) => item.id === selected?.collection_id,
  );

  async function logSearch(
    searchType: "text" | "image" | "filter",
    searchQuery = query,
    resultCount = visibleRecords.length,
  ) {
    if (!organization) return;
    await requireSupabase().rpc("log_material_search", {
      target_organization: organization.id,
      search_query: searchQuery || "Browse filters",
      search_kind: searchType,
      search_filters: {
        collection,
        category,
        availability,
        location: locationFilter,
      },
      matching_records: resultCount,
    });
  }

  async function runImageSearch(file: File) {
    if (!organization) return;
    if (!file.type.startsWith("image/")) {
      setMessage("Choose a photo to search.");
      return;
    }
    setImageSearching(true);
    setMessage("");
    try {
      const preview = await imagePreview(file);
      const { data, error } = await requireSupabase().functions.invoke(
        "enrich-submission",
        {
          body: {
            organization_id: organization.id,
            image_data_url: preview,
            search_mode: true,
          },
        },
      );
      if (error) throw error;
      const suggestions = data?.suggestions || {};
      const searchText = [
        suggestions.name,
        suggestions.category,
        ...(suggestions.keywords || []).slice(0, 6),
        ...(suggestions.fields || []).slice(0, 2).map(
          (field: { value?: string }) => field.value,
        ),
      ]
        .filter(Boolean)
        .join(" ");
      if (!searchText) throw new Error("No searchable details were found.");
      setQuery(searchText);
      setImageSearchLabel(suggestions.name || "Photo search");
      setSearchKind("image");
      const terms = searchText.toLowerCase().split(/\s+/).filter(Boolean);
      const count = records.filter((item) => {
        const haystack = searchableText(item);
        return terms.some((term) => haystack.includes(term));
      }).length;
      await logSearch("image", searchText, count);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Photo search is temporarily unavailable.",
      );
    } finally {
      setImageSearching(false);
      if (photoSearchInput.current) photoSearchInput.current.value = "";
    }
  }

  function openRecord(id: string) {
    setSelectedId(id);
    setDetailOpen(true);
    setInventoryOpen(false);
  }

  async function recordUse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get("amount"));
    const { data, error } = await requireSupabase().rpc("record_inventory_use", {
      target_record: selected.id,
      amount_used: amount,
      note_text: String(form.get("note") || ""),
    });
    if (error) return setMessage(error.message);
    setMessage("Inventory updated. The administrator can see this change.");
    setInventoryOpen(false);
    setRecords((items) =>
      items.map((item) =>
        item.id === selected.id ? { ...item, quantity: data } : item,
      ),
    );
  }

  function clearSearch() {
    setQuery("");
    setImageSearchLabel("");
    setSearchKind("text");
    setCollection("all");
    setCategory("all");
    setAvailability("all");
    setLocationFilter("all");
  }

  if (loading) return <div className="loading">Loading material map…</div>;
  if (!organization)
    return (
      <div className="empty">
        <h1>Organization unavailable</h1>
        <p>{message}</p>
        <button onClick={() => navigate("home")}>Return home</button>
      </div>
    );

  return (
    <div className="directory-page material-directory">
      <header className="directory-header">
        <button className="directory-back" onClick={() => navigate("home")} aria-label="Back to organizations">←</button>
        <div className="directory-identity"><small>MATERIAL PIN</small><strong>{organization.name}</strong></div>
        <div className="directory-role-actions">
          {isMember ? <span className="employee-badge">Employee</span> : <button onClick={() => navigate("staff")}>Employee sign in</button>}
          <button className="directory-admin" onClick={() => navigate("admin")}>Admin</button>
        </div>
      </header>

      <main className="material-workspace">
        <section className="material-search-panel">
          <div className="material-search-heading">
            <small>FIND MATERIALS AND ASSETS</small>
            <h1>Search this site</h1>
            <p>Use words, a photo, or narrow the catalog with filters.</p>
          </div>
          <label className="material-text-search">
            <span>Text search</span>
            <div><input value={query} onChange={(event) => { setQuery(event.target.value); setImageSearchLabel(""); setSearchKind("text"); }} onKeyDown={(event) => event.key === "Enter" && logSearch("text")} placeholder="Name, SKU, material, location…" /><button onClick={() => logSearch("text")}>Search</button></div>
          </label>
          <div className="image-search-control">
            <div><b>Search with a photo</b><small>Take or upload a photo and Material Pin will search visible details and text.</small></div>
            <button disabled={imageSearching || !organization.ai_enabled} onClick={() => photoSearchInput.current?.click()}>{imageSearching ? "Reading photo…" : "Use a photo"}</button>
            <input ref={photoSearchInput} type="file" accept="image/*" capture="environment" hidden onChange={(event) => event.target.files?.[0] && runImageSearch(event.target.files[0])} />
            {!organization.ai_enabled && <small className="ai-off-note">Photo search is not enabled for this site.</small>}
            {imageSearchLabel && <span className="image-search-result">Photo recognized as: <b>{imageSearchLabel}</b></span>}
          </div>

          <div className="catalog-filters">
            <div className="filter-title"><b>Narrow results</b><button onClick={clearSearch}>Clear all</button></div>
            <label>Item group<select value={collection} onChange={(event) => { setCollection(event.target.value); void logSearch("filter"); }}><option value="all">All item groups</option>{visibleCollections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Category<select value={category} onChange={(event) => { setCategory(event.target.value); void logSearch("filter"); }}><option value="all">All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Availability<select value={availability} onChange={(event) => { setAvailability(event.target.value as AvailabilityFilter); void logSearch("filter"); }}><option value="all">Any availability</option><option value="available">Available</option><option value="empty">Out of stock</option><option value="untracked">Not quantity tracked</option></select></label>
            <label>Named location<select value={locationFilter} onChange={(event) => { setLocationFilter(event.target.value); void logSearch("filter"); }}><option value="all">All locations</option>{locations.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>

          <div className="material-results-heading"><h2>{visibleRecords.length} results</h2>{isMember && <button onClick={() => navigate(`submit/${organization.slug}`)}>+ Add item</button>}</div>
          <div className="material-result-list">
            {visibleRecords.map((item) => (
              <button className={selectedId === item.id ? "material-result-card selected" : "material-result-card"} key={item.id} onClick={() => openRecord(item.id)}>
                {item.photo_path ? <img src={publicPhoto(item.photo_path)} alt="" /> : <span className="generic-pin" aria-hidden="true">●</span>}
                <span className="result-copy"><small>{item.category}</small><strong>{item.name}</strong><span>{String(item.data.sku || "No SKU")}{itemLocation(item) ? ` · ${itemLocation(item)}` : ""}</span></span>
                {item.quantity !== null && <output>{item.quantity} <small>{item.unit}</small></output>}
              </button>
            ))}
            {!visibleRecords.length && <div className="empty material-empty"><h2>No exact matches</h2><p>Try fewer words, remove a filter, or search with another photo.</p></div>}
          </div>
        </section>

        <section className="material-map-panel">
          <MapView latitude={organization.center_lat} longitude={organization.center_lng} zoom={organization.map_zoom} records={visibleRecords} selectedId={selectedId} onSelect={openRecord} boundary={organization.boundary} />
          <span className="map-count">{visibleRecords.length} {visibleRecords.length === 1 ? "pin" : "pins"}</span>
        </section>
      </main>

      {detailOpen && selected && (
        <div className="detail-overlay" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setDetailOpen(false)}>
          <article className="record-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="record-title">
            <button className="detail-close" onClick={() => setDetailOpen(false)} aria-label="Close details">×</button>
            {selected.photo_path ? <img className="detail-photo" src={publicPhoto(selected.photo_path)} alt="" /> : <div className="detail-photo detail-photo-empty">Mapped inventory pin</div>}
            <div className="detail-body">
              <small className="detail-eyebrow">{selectedCollection?.name || selected.category} · updated {new Date(selected.updated_at).toLocaleDateString()}</small>
              <h2 id="record-title">{selected.name}</h2>
              <p>{selected.description || "No description has been added."}</p>
              <dl className="record-data standard-item-data">
                {selected.data.sku != null && <div><dt>SKU / asset ID</dt><dd>{String(selected.data.sku)}</dd></div>}
                {itemLocation(selected) && <div><dt>Named location</dt><dd>{itemLocation(selected)}</dd></div>}
                <div><dt>GPS</dt><dd>{selected.latitude.toFixed(5)}, {selected.longitude.toFixed(5)}</dd></div>
                {selected.quantity !== null && <div><dt>Quantity</dt><dd>{selected.quantity} {selected.unit}</dd></div>}
                {isMember && <div><dt>Visibility</dt><dd>{selected.public_visible ? "Public" : "Employees only"}</dd></div>}
              </dl>
              {!!selected.keywords.length && <div className="keyword-line detail-keywords">{selected.keywords.map((keyword) => <i key={keyword}>{keyword}</i>)}</div>}
              {isMember && <div className="detail-actions"><button className="primary" onClick={() => navigate(`submit/${organization.slug}/${selected.id}`)}>Update item</button>{selected.quantity !== null && <button onClick={() => setInventoryOpen((value) => !value)}>Record inventory use</button>}</div>}
              {inventoryOpen && <form className="inventory-use" onSubmit={recordUse}><label>Quantity used<input name="amount" type="number" min="0.01" step="any" required /></label><label>Note<input name="note" placeholder="Job, order or reason" /></label><button>Update quantity</button></form>}
            </div>
          </article>
        </div>
      )}
      {message && <div className="directory-toast" role="status">{message}<button onClick={() => setMessage("")}>×</button></div>}
    </div>
  );
}
