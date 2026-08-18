import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../components/AppHeader";
import SiteMapView from "../components/SiteMapView";
import { permissionsFor, roleLabel } from "../lib/permissions";
import { navigate } from "../lib/route";
import { publicPhoto, requireSupabase, siteMapUrl } from "../lib/supabase";
import type {
  MemberPermissions,
  Organization,
  OrganizationMembership,
  RecordItem,
} from "../types";

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
  const [availability, setAvailability] = useState<AvailabilityFilter>("all");
  const [locationFilter, setLocationFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [imageSearching, setImageSearching] = useState(false);
  const [imageSearchLabel, setImageSearchLabel] = useState("");
  const [imageSearchMatched, setImageSearchMatched] = useState<boolean | null>(
    null,
  );
  const [searchKind, setSearchKind] = useState<"text" | "image">("text");
  const [isMember, setIsMember] = useState(false);
  const [membership, setMembership] = useState<OrganizationMembership | null>(
    null,
  );
  const [permissions, setPermissions] = useState<MemberPermissions>(
    permissionsFor(null),
  );
  const [mapImage, setMapImage] = useState("");
  const photoSearchInput = useRef<HTMLInputElement>(null);
  const finderMap = useRef<HTMLElement>(null);
  const navigatorTouchStart = useRef<number | null>(null);

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
      if (org.map_image_path)
        void siteMapUrl(org.map_image_path).then(setMapImage);
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
        const [{ data: membershipRow }, { data: platformRows }] =
          await Promise.all([
            client
              .from("organization_members")
              .select("organization_id,user_id,role,permissions")
              .eq("organization_id", org.id)
              .eq("user_id", authData.user.id)
              .maybeSingle(),
            client.from("platform_admins").select("user_id").limit(1),
          ]);
        const effectiveMembership = platformRows?.length
          ? ({
              organization_id: org.id,
              user_id: authData.user.id,
              role: "admin",
              permissions: {},
            } as OrganizationMembership)
          : (membershipRow as OrganizationMembership | null);
        const access = permissionsFor(effectiveMembership);
        setMembership(effectiveMembership);
        setPermissions(access);
        setIsMember(Boolean(effectiveMembership));
        if (access.viewPrivate) {
          const { data: privateRows } = await client
            .from("record_private_data")
            .select("record_id,data")
            .eq("organization_id", org.id);
          privateByRecord = new Map(
            (privateRows || []).map((row) => [
              row.record_id,
              row.data as Record<string, unknown>,
            ]),
          );
        }
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
        (item) => item.publicVisible || permissions.viewPrivate,
      ) || [],
    [organization, permissions.viewPrivate],
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
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return records.filter((item) => {
      if (collection !== "all" && item.collection_id !== collection)
        return false;
      if (category !== "all" && item.category !== category) return false;
      if (locationFilter !== "all" && itemLocation(item) !== locationFilter)
        return false;
      if (
        availability === "available" &&
        !(item.quantity === null || item.quantity > 0)
      )
        return false;
      if (availability === "empty" && item.quantity !== 0) return false;
      if (availability === "untracked" && item.quantity !== null) return false;
      const haystack = searchableText(item);
      return searchKind === "image"
        ? terms.some((term) => term.length > 2 && haystack.includes(term))
        : terms.every((term) => haystack.includes(term));
    });
  }, [
    records,
    query,
    collection,
    category,
    availability,
    locationFilter,
    searchKind,
  ]);

  const selected = records.find((item) => item.id === selectedId) || null;
  const activeResultIndex = visibleRecords.findIndex(
    (item) => item.id === selectedId,
  );
  const activeResult =
    activeResultIndex >= 0 ? visibleRecords[activeResultIndex] : null;
  const pinNumbers = useMemo(
    () =>
      Object.fromEntries(
        visibleRecords.map((item, index) => [item.id, index + 1]),
      ),
    [visibleRecords],
  );
  const selectedCollection = visibleCollections.find(
    (item) => item.id === selected?.collection_id,
  );
  const activeSku = activeResult
    ? String(activeResult.data.sku || activeResult.data.asset_id || "").trim()
    : "";
  const activeLocation = activeResult ? itemLocation(activeResult) : "";

  useEffect(() => {
    if (!visibleRecords.length) {
      setSelectedId(null);
      return;
    }
    if (!visibleRecords.some((item) => item.id === selectedId))
      setSelectedId(visibleRecords[0].id);
  }, [visibleRecords, selectedId]);

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

  function focusFinder() {
    window.requestAnimationFrame(() =>
      finderMap.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      }),
    );
  }

  async function runTextSearch() {
    await logSearch("text");
    focusFinder();
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
        ...(suggestions.keywords || []).slice(0, 5),
      ]
        .filter(Boolean)
        .join(" ");
      if (!searchText) throw new Error("No searchable details were found.");
      setQuery(searchText);
      setImageSearchLabel(suggestions.name || "Photo search");
      setImageSearchMatched(suggestions.catalog_match !== false);
      setSearchKind("image");
      const terms = searchText.toLowerCase().split(/\s+/).filter(Boolean);
      const count = records.filter((item) => {
        const haystack = searchableText(item);
        return terms.some((term) => haystack.includes(term));
      }).length;
      await logSearch("image", searchText, count);
      focusFinder();
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

  function selectRecord(id: string) {
    setSelectedId(id);
    setDetailOpen(false);
    setInventoryOpen(false);
  }

  function showResult(index: number) {
    if (!visibleRecords.length) return;
    const nextIndex = Math.min(visibleRecords.length - 1, Math.max(0, index));
    const next = visibleRecords[nextIndex];
    setSelectedId(next.id);
    setDetailOpen(false);
  }

  function finishNavigatorSwipe(clientX: number) {
    if (navigatorTouchStart.current === null) return;
    const distance = clientX - navigatorTouchStart.current;
    navigatorTouchStart.current = null;
    if (Math.abs(distance) < 45) return;
    showResult(activeResultIndex + (distance < 0 ? 1 : -1));
  }

  async function recordUse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const amount = Number(form.get("amount"));
    const { data, error } = await requireSupabase().rpc("adjust_inventory", {
      target_record: selected.id,
      quantity_value: amount,
      event_kind: "used",
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
    setImageSearchMatched(null);
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
      <AppHeader context={organization.name} backTo="sites">
        <button className="active">Visual finder</button>
        {permissions.viewInventory && (
          <button onClick={() => navigate(`inventory/${organization.slug}`)}>
            Inventory
          </button>
        )}
        <button onClick={() => navigate("staff")}>
          {membership ? roleLabel(membership.role) : "Sign in"}
        </button>
        {membership?.role === "admin" && (
          <button onClick={() => navigate("admin")}>Site settings</button>
        )}
      </AppHeader>

      <main className="material-workspace">
        <section className="finder-toolbar" aria-label="Find items">
          <div className="material-search-heading">
            <small>FIND MATERIALS AND ASSETS</small>
            <h1>Search this site</h1>
            <p>Every result number matches its pin on the map.</p>
          </div>
          <label className="material-text-search">
            <span>Text search</span>
            <div>
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setImageSearchLabel("");
                  setImageSearchMatched(null);
                  setSearchKind("text");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void runTextSearch();
                }}
                placeholder="Name, SKU, material, location…"
              />
              <button onClick={() => void runTextSearch()}>Search</button>
            </div>
          </label>
          <div className="image-search-control">
            <div>
              <b>Search with a photo</b>
              <small>
                Take or upload a photo and Material Pin will search visible
                details and text.
              </small>
            </div>
            <button
              disabled={imageSearching || !organization.ai_enabled}
              onClick={() => photoSearchInput.current?.click()}
            >
              {imageSearching ? "Reading photo…" : "Use a photo"}
            </button>
            <input
              ref={photoSearchInput}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(event) =>
                event.target.files?.[0] && runImageSearch(event.target.files[0])
              }
            />
            {!organization.ai_enabled && (
              <small className="ai-off-note">
                Photo search is not enabled for this site.
              </small>
            )}
            {imageSearchLabel && (
              <span
                className={
                  imageSearchMatched === false
                    ? "image-search-result no-match"
                    : "image-search-result"
                }
              >
                {imageSearchMatched === false ? (
                  <>
                    Photo looks like <b>{imageSearchLabel}</b>. No likely
                    catalog match was found.
                  </>
                ) : (
                  <>
                    Photo recognized as: <b>{imageSearchLabel}</b>
                  </>
                )}
              </span>
            )}
          </div>
          <details className="filter-drawer">
            <summary>
              Filters
              <span>Group, category, availability, and location</span>
            </summary>
            <div className="catalog-filters">
              <div className="filter-title">
                <b>Narrow results</b>
                <button onClick={clearSearch}>Clear all</button>
              </div>
              <label>
                Item group
                <select
                  value={collection}
                  onChange={(event) => {
                    setCollection(event.target.value);
                    void logSearch("filter");
                    focusFinder();
                  }}
                >
                  <option value="all">All item groups</option>
                  {visibleCollections.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select
                  value={category}
                  onChange={(event) => {
                    setCategory(event.target.value);
                    void logSearch("filter");
                    focusFinder();
                  }}
                >
                  <option value="all">All categories</option>
                  {categories.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label>
                Availability
                <select
                  value={availability}
                  onChange={(event) => {
                    setAvailability(event.target.value as AvailabilityFilter);
                    void logSearch("filter");
                    focusFinder();
                  }}
                >
                  <option value="all">Any availability</option>
                  <option value="available">Available</option>
                  <option value="empty">Out of stock</option>
                  <option value="untracked">Not quantity tracked</option>
                </select>
              </label>
              <label>
                Named location
                <select
                  value={locationFilter}
                  onChange={(event) => {
                    setLocationFilter(event.target.value);
                    void logSearch("filter");
                    focusFinder();
                  }}
                >
                  <option value="all">All locations</option>
                  {locations.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
            </div>
          </details>
        </section>

        <section className="material-map-panel" ref={finderMap}>
          <SiteMapView
            organization={organization}
            mapImageUrl={mapImage}
            records={visibleRecords}
            pinNumbers={pinNumbers}
            selectedId={selectedId}
            onSelect={selectRecord}
            boundary={organization.boundary}
          />
          {activeResult ? (
            <div
              className="map-result-navigator"
              aria-live="polite"
              onTouchStart={(event) => {
                navigatorTouchStart.current = event.touches[0]?.clientX ?? null;
              }}
              onTouchEnd={(event) =>
                finishNavigatorSwipe(event.changedTouches[0]?.clientX ?? 0)
              }
            >
              <button
                onClick={() => showResult(activeResultIndex - 1)}
                disabled={activeResultIndex <= 0}
                aria-label="Show previous result"
              >
                ← <span>Previous</span>
              </button>
              <div>
                <small>
                  RESULT {activeResultIndex + 1} OF {visibleRecords.length}
                </small>
                <b>{activeResult.name}</b>
                <span>Swipe this card or use the buttons</span>
              </div>
              <button
                onClick={() => showResult(activeResultIndex + 1)}
                disabled={activeResultIndex >= visibleRecords.length - 1}
                aria-label="Show next result"
              >
                <span>Next</span> →
              </button>
            </div>
          ) : (
            <span className="map-count" aria-live="polite">
              No matching pins
            </span>
          )}
        </section>

        <section className="active-result-section" aria-live="polite">
          {activeResult ? (
            <article className="active-result-card">
              {activeResult.photo_path ? (
                <img
                  src={publicPhoto(activeResult.photo_path)}
                  alt={activeResult.name}
                />
              ) : (
                <div className="active-result-photo-empty">
                  <span aria-hidden="true">●</span>
                  <small>No item photo</small>
                </div>
              )}
              <div className="active-result-copy">
                <small className="active-result-position">
                  RESULT {activeResultIndex + 1} OF {visibleRecords.length} ·{" "}
                  {selectedCollection?.name || activeResult.category}
                </small>
                <h2>{activeResult.name}</h2>
                <p>
                  {activeResult.description ||
                    "No description has been added for this item."}
                </p>
                <dl>
                  {activeSku && (
                    <div>
                      <dt>SKU / asset ID</dt>
                      <dd>{activeSku}</dd>
                    </div>
                  )}
                  {activeLocation && (
                    <div>
                      <dt>Location</dt>
                      <dd>{activeLocation}</dd>
                    </div>
                  )}
                  {activeResult.quantity !== null && (
                    <div>
                      <dt>On hand</dt>
                      <dd>
                        {activeResult.quantity} {activeResult.unit}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Updated</dt>
                    <dd>
                      {new Date(activeResult.updated_at).toLocaleDateString()}
                    </dd>
                  </div>
                </dl>
                {!!activeResult.keywords.length && (
                  <div className="active-result-keywords">
                    {activeResult.keywords.slice(0, 5).map((keyword) => (
                      <span key={keyword}>{keyword}</span>
                    ))}
                  </div>
                )}
                <button onClick={() => openRecord(activeResult.id)}>
                  Open full details
                </button>
              </div>
            </article>
          ) : (
            <div className="active-result-empty">
              <h2>No matching items</h2>
              <p>Try fewer words, another photo, or clear the filters.</p>
              <button onClick={clearSearch}>Clear search</button>
            </div>
          )}
        </section>
      </main>

      {detailOpen && selected && (
        <div
          className="detail-overlay"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setDetailOpen(false)
          }
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
              <div className="detail-photo detail-photo-empty">
                Mapped inventory pin
              </div>
            )}
            <div className="detail-body">
              <small className="detail-eyebrow">
                {selectedCollection?.name || selected.category} · updated{" "}
                {new Date(selected.updated_at).toLocaleDateString()}
              </small>
              <h2 id="record-title">{selected.name}</h2>
              <p>{selected.description || "No description has been added."}</p>
              <dl className="record-data standard-item-data">
                {selected.data.sku != null && (
                  <div>
                    <dt>SKU / asset ID</dt>
                    <dd>{String(selected.data.sku)}</dd>
                  </div>
                )}
                {itemLocation(selected) && (
                  <div>
                    <dt>Named location</dt>
                    <dd>{itemLocation(selected)}</dd>
                  </div>
                )}
                <div>
                  <dt>
                    {organization.map_mode === "gps" ? "GPS" : "Map position"}
                  </dt>
                  <dd>
                    {organization.map_mode === "gps"
                      ? `${selected.latitude.toFixed(5)}, ${selected.longitude.toFixed(5)}`
                      : `${selected.longitude.toFixed(1)}% across · ${selected.latitude.toFixed(1)}% down`}
                  </dd>
                </div>
                {selected.quantity !== null && (
                  <div>
                    <dt>Quantity</dt>
                    <dd>
                      {selected.quantity} {selected.unit}
                    </dd>
                  </div>
                )}
                {isMember && (
                  <div>
                    <dt>Visibility</dt>
                    <dd>
                      {selected.public_visible ? "Public" : "Employees only"}
                    </dd>
                  </div>
                )}
              </dl>
              {!!selected.keywords.length && (
                <div className="keyword-line detail-keywords">
                  {selected.keywords.map((keyword) => (
                    <i key={keyword}>{keyword}</i>
                  ))}
                </div>
              )}
              {isMember && (
                <div className="detail-actions">
                  {permissions.updateItems && (
                    <button
                      className="primary"
                      onClick={() =>
                        navigate(`submit/${organization.slug}/${selected.id}`)
                      }
                    >
                      Update item
                    </button>
                  )}
                  {selected.quantity !== null &&
                    permissions.adjustInventory && (
                      <button
                        onClick={() => setInventoryOpen((value) => !value)}
                      >
                        Record inventory use
                      </button>
                    )}
                </div>
              )}
              {inventoryOpen && (
                <form className="inventory-use" onSubmit={recordUse}>
                  <label>
                    Quantity used
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
                    <input name="note" placeholder="Job, order or reason" />
                  </label>
                  <button>Update quantity</button>
                </form>
              )}
            </div>
          </article>
        </div>
      )}
      {permissions.addItems && !detailOpen && (
        <button
          className="floating-add"
          onClick={() => navigate(`submit/${organization.slug}`)}
          aria-label="Add a new item"
        >
          <span aria-hidden="true">+</span>
          <strong>Add item</strong>
        </button>
      )}
      {message && (
        <div className="directory-toast" role="status">
          {message}
          <button onClick={() => setMessage("")}>×</button>
        </div>
      )}
    </div>
  );
}
