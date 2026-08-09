import { useEffect, useMemo, useState } from "react";
import { db, publicPhoto } from "../lib/supabase";
import type { Instance, RecordItem } from "../types";
import GeoMap from "./GeoMap";

const labels: Record<string, string> = {
  places: "Places",
  assets: "Assets",
  stock: "Stock",
  loose_material: "Loose material",
};

export default function Directory({
  instance,
  navigate,
}: {
  instance: Instance;
  navigate: (route: string) => void;
}) {
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [query, setQuery] = useState("");
  const [module, setModule] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    db<RecordItem[]>(
      "records",
      `instance_id=eq.${instance.id}&public_visible=eq.true&select=*&order=updated_at.desc`,
    )
      .then((items) => {
        setRecords(items);
        setSelectedId(items[0]?.id || null);
      })
      .catch((e) => setError(e.message));
  }, [instance.id]);
  const filtered = useMemo(
    () =>
      records.filter(
        (item) =>
          (module === "all" || item.record_type === module) &&
          `${item.name} ${item.code || ""} ${item.category} ${item.description || ""} ${item.location_label || ""}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [records, query, module],
  );
  const selected =
    filtered.find((item) => item.id === selectedId) || filtered[0] || null;
  return (
    <div className="app-shell">
      <header className="catalog-header">
        <button className="wordmark" onClick={() => navigate("home")}>
          <b>LOTKEEPER</b>
          <span>{instance.name}</span>
        </button>
        <div className="header-search">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${instance.site_name}: item, category, code, or location`}
          />
          <button>Search</button>
        </div>
        <div className="header-actions">
          <span
            className={
              instance.access_mode === "public"
                ? "access public"
                : "access private"
            }
          >
            {instance.access_mode}
          </span>
          <button onClick={() => navigate(`contribute/${instance.slug}`)}>
            Submit update
          </button>
          <button onClick={() => navigate("admin")}>Admin</button>
        </div>
      </header>
      <div className="catalog-layout">
        <aside className="category-rail">
          <h2>Browse</h2>
          <button
            className={module === "all" ? "active" : ""}
            onClick={() => setModule("all")}
          >
            <span>All records</span>
            <b>{records.length}</b>
          </button>
          {instance.modules.map((key) => (
            <button
              className={module === key ? "active" : ""}
              onClick={() => setModule(key)}
              key={key}
            >
              <span>{instance.terminology[key] || labels[key]}</span>
              <b>{records.filter((r) => r.record_type === key).length}</b>
            </button>
          ))}
          <div className="rail-help">
            <b>Can’t find it?</b>
            <p>
              Add a photo and GPS pin. Staff reviews every public submission.
            </p>
            <button onClick={() => navigate(`contribute/${instance.slug}`)}>
              Add or report something
            </button>
          </div>
        </aside>
        <main className="results-panel">
          <div className="results-title">
            <div>
              <small>{instance.site_name.toUpperCase()}</small>
              <h1>
                {module === "all"
                  ? "All records"
                  : instance.terminology[module] || labels[module]}
              </h1>
            </div>
            <span>{filtered.length} results</span>
          </div>
          {error && <div className="alert error">{error}</div>}
          {!error && !filtered.length && (
            <div className="empty">
              <h2>No matching records</h2>
              <p>
                Try a broader search or submit a mapped addition for staff
                review.
              </p>
            </div>
          )}
          <div className="result-list">
            {filtered.map((item) => (
              <button
                className={`result-row ${selected?.id === item.id ? "selected" : ""}`}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="type-code">
                  {(
                    instance.terminology[item.record_type] ||
                    labels[item.record_type]
                  )
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
                <span>
                  <small>{item.code || item.category}</small>
                  <strong>{item.name}</strong>
                  <em>{item.description || "No description"}</em>
                </span>
                <span className="row-location">
                  <b>{item.location_label || "Mapped location"}</b>
                  <small>{item.status}</small>
                </span>
                {item.quantity !== null && (
                  <span className="quantity">
                    <b>{item.quantity}</b>
                    <small>{item.unit}</small>
                  </span>
                )}
              </button>
            ))}
          </div>
        </main>
        <aside className="detail-panel">
          <GeoMap
            latitude={instance.latitude}
            longitude={instance.longitude}
            zoom={instance.map_zoom}
            records={filtered}
            selectedId={selected?.id || null}
            onSelect={setSelectedId}
            boundary={instance.boundary || []}
          />
          {selected ? (
            <div className="detail-copy">
              {selected.photo_path && (
                <img src={publicPhoto(selected.photo_path)} alt="" />
              )}
              <small>
                {selected.category} · {selected.status}
              </small>
              <h2>{selected.name}</h2>
              <p>{selected.description || "No additional description."}</p>
              <dl>
                <div>
                  <dt>Location</dt>
                  <dd>
                    {selected.location_label ||
                      `${selected.latitude.toFixed(5)}, ${selected.longitude.toFixed(5)}`}
                  </dd>
                </div>
                {selected.code && (
                  <div>
                    <dt>Code</dt>
                    <dd>{selected.code}</dd>
                  </div>
                )}
                {selected.quantity !== null && (
                  <div>
                    <dt>Quantity</dt>
                    <dd>
                      {selected.quantity} {selected.unit}
                    </dd>
                  </div>
                )}
              </dl>
              <a
                target="_blank"
                rel="noreferrer"
                href={`https://www.openstreetmap.org/?mlat=${selected.latitude}&mlon=${selected.longitude}#map=19/${selected.latitude}/${selected.longitude}`}
              >
                Open exact location ↗
              </a>
            </div>
          ) : (
            <div className="detail-empty">
              <h2>{instance.site_name}</h2>
              <p>
                The site map is ready. Choose a category or submit the first
                mapped item for administrator approval.
              </p>
              <button onClick={() => navigate(`contribute/${instance.slug}`)}>
                Add the first item
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
