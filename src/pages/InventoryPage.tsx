import { useEffect, useMemo, useState } from "react";
import AppHeader from "../components/AppHeader";
import { featuresFor } from "../lib/features";
import { availabilityFor, availabilityLabel } from "../lib/inventory";
import { navigate } from "../lib/route";
import { permissionsFor, roleLabel } from "../lib/permissions";
import { requireSupabase } from "../lib/supabase";
import type {
  InventoryTransaction,
  MemberPermissions,
  Organization,
  OrganizationMembership,
  RecordItem,
} from "../types";

function itemLocation(item: RecordItem) {
  return String(
    item.data.location ||
      item.data.location_code ||
      item.data.storage_location ||
      item.data.bin ||
      "",
  ).trim();
}

function sku(item: RecordItem) {
  return String(item.data.sku || item.data.asset_id || "—");
}

type InventoryEventKind = "used" | "added" | "counted";

export default function InventoryPage({ slug }: { slug: string }) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [membership, setMembership] = useState<OrganizationMembership | null>(
    null,
  );
  const [permissions, setPermissions] = useState<MemberPermissions | null>(
    null,
  );
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [collectionId, setCollectionId] = useState("");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [adjusting, setAdjusting] = useState<RecordItem | null>(null);
  const [adjustEventKind, setAdjustEventKind] =
    useState<InventoryEventKind>("used");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadInventory(org: Organization, access: MemberPermissions) {
    const client = requireSupabase();
    const [recordRows, privateRows, transactionRows] = await Promise.all([
      client
        .from("records")
        .select("*")
        .eq("organization_id", org.id)
        .eq("status", "active")
        .order("name"),
      access.viewPrivate
        ? client
            .from("record_private_data")
            .select("record_id,data")
            .eq("organization_id", org.id)
        : Promise.resolve({ data: [], error: null }),
      access.viewInventory
        ? client
            .from("inventory_transactions")
            .select("*")
            .eq("organization_id", org.id)
            .order("created_at", { ascending: false })
            .limit(40)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (recordRows.error) setMessage(recordRows.error.message);
    if (privateRows.error) setMessage(privateRows.error.message);
    if (transactionRows.error) setMessage(transactionRows.error.message);
    const privateByRecord = new Map(
      (privateRows.data || []).map((row) => [
        row.record_id,
        row.data as Record<string, unknown>,
      ]),
    );
    setRecords(
      ((recordRows.data || []) as RecordItem[])
        .filter((item) => item.quantity !== null)
        .map((item) => ({
          ...item,
          data: { ...item.data, ...(privateByRecord.get(item.id) || {}) },
        })),
    );
    setTransactions((transactionRows.data || []) as InventoryTransaction[]);
  }

  useEffect(() => {
    (async () => {
      const client = requireSupabase();
      const { data: authData } = await client.auth.getUser();
      if (!authData.user) {
        setMessage("Sign in to open this site's inventory tracker.");
        setLoading(false);
        return;
      }
      const { data: org, error } = await client
        .from("organizations")
        .select("*")
        .eq("slug", slug)
        .single();
      if (error || !org) {
        setMessage(error?.message || "This site is unavailable.");
        setLoading(false);
        return;
      }
      const [{ data: member }, { data: platformRows }] = await Promise.all([
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
        : (member as OrganizationMembership | null);
      const access = permissionsFor(effectiveMembership);
      setOrganization(org as Organization);
      setMembership(effectiveMembership);
      setPermissions(access);
      if (
        !effectiveMembership ||
        !access.viewInventory ||
        !featuresFor(org as Organization).inventory
      ) {
        setMessage("Your access level does not include the inventory tracker.");
        setLoading(false);
        return;
      }
      await loadInventory(org as Organization, access);
      setLoading(false);
    })();
  }, [slug]);

  const inventoryCollections = useMemo(
    () =>
      (organization?.collections || []).filter((collection) =>
        records.some((item) => item.collection_id === collection.id),
      ),
    [organization, records],
  );
  useEffect(() => {
    if (!collectionId && inventoryCollections.length)
      setCollectionId(inventoryCollections[0].id);
  }, [collectionId, inventoryCollections]);

  const categories = useMemo(
    () =>
      [
        ...new Set(
          records
            .filter((item) => item.collection_id === collectionId)
            .map((item) => item.category || "Uncategorized"),
        ),
      ].sort(),
    [records, collectionId],
  );
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return records.filter((item) => {
      if (item.collection_id !== collectionId) return false;
      if (category !== "all" && item.category !== category) return false;
      if (!term) return true;
      return [item.name, sku(item), item.category, itemLocation(item)]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [records, collectionId, category, query]);

  async function adjustInventory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adjusting || !organization || !permissions?.adjustInventory) return;
    const form = new FormData(event.currentTarget);
    const request: Record<string, unknown> = {
      target_record: adjusting.id,
      quantity_value: Number(form.get("quantity")),
      event_kind: String(form.get("event_kind")),
      note_text: String(form.get("note") || ""),
    };
    const { error } = await requireSupabase().rpc("adjust_inventory", request);
    if (error) return setMessage(error.message);
    setAdjusting(null);
    setMessage("Inventory updated and added to the activity history.");
    await loadInventory(organization, permissions);
  }

  function openAdjustment(item: RecordItem, kind: InventoryEventKind) {
    setAdjustEventKind(kind);
    setAdjusting(item);
    setMessage("");
  }

  if (loading) return <div className="loading-screen">Loading inventory…</div>;
  if (
    !organization ||
    !membership ||
    !permissions?.viewInventory ||
    !featuresFor(organization).inventory
  )
    return (
      <main className="access-page">
        <button className="access-back" onClick={() => navigate("home")}>
          ← Material Pin
        </button>
        <section className="access-card">
          <div className="brand">MATERIAL PIN</div>
          <small>INVENTORY ACCESS</small>
          <h1>Inventory is restricted</h1>
          <p>{message}</p>
          <button onClick={() => navigate("staff")}>Open sign in</button>
        </section>
      </main>
    );

  const totalUnits = records.reduce(
    (total, item) => total + Number(item.quantity || 0),
    0,
  );
  const lowStock = records.filter(
    (item) => Number(item.quantity) > 0 && Number(item.quantity) <= 5,
  ).length;
  const outOfStock = records.filter(
    (item) => Number(item.quantity) === 0,
  ).length;

  return (
    <div className="inventory-page product-page">
      <AppHeader
        context={`${organization.name} · Inventory`}
        backTo={`org/${slug}`}
      >
        {featuresFor(organization).mapping && (
          <button onClick={() => navigate(`org/${slug}`)}>Visual finder</button>
        )}
        {featuresFor(organization).pos && permissions.usePos && (
          <button onClick={() => navigate(`pos/${slug}`)}>
            Checkout / POS
          </button>
        )}
        {membership.role === "admin" && (
          <button onClick={() => navigate(`admin/${slug}`)}>
            Admin console
          </button>
        )}
      </AppHeader>
      <main className="inventory-shell">
        <section className="inventory-hero">
          <div>
            <small>INVENTORY TRACKER</small>
            <h1>Know what is on hand</h1>
            <p>
              {permissions.adjustInventory
                ? "Search stock, check locations, receive materials, and update quantities from one workspace."
                : "Search stock and check locations without crowding the visual map."}
            </p>
          </div>
          <span className="role-badge">{roleLabel(membership.role)}</span>
        </section>
        <section className="inventory-metrics">
          <article>
            <small>Tracked items</small>
            <b>{records.length}</b>
          </article>
          <article>
            <small>Total units</small>
            <b>{totalUnits}</b>
          </article>
          <article>
            <small>Low stock</small>
            <b>{lowStock}</b>
          </article>
          <article>
            <small>Out of stock</small>
            <b>{outOfStock}</b>
          </article>
        </section>
        <div className="inventory-catalog-layout">
          <aside className="inventory-facets">
            <h2>Item groups</h2>
            {inventoryCollections.map((collection) => (
              <button
                className={collectionId === collection.id ? "active" : ""}
                key={collection.id}
                onClick={() => {
                  setCollectionId(collection.id);
                  setCategory("all");
                }}
              >
                <span>{collection.icon || collection.name.charAt(0)}</span>
                <b>{collection.name}</b>
                <i>
                  {
                    records.filter(
                      (item) => item.collection_id === collection.id,
                    ).length
                  }
                </i>
              </button>
            ))}
            {!!categories.length && (
              <>
                <h2>Categories</h2>
                <button
                  className={category === "all" ? "active" : ""}
                  onClick={() => setCategory("all")}
                >
                  <b>All categories</b>
                </button>
                {categories.map((item) => (
                  <button
                    className={category === item ? "active" : ""}
                    key={item}
                    onClick={() => setCategory(item)}
                  >
                    <b>{item}</b>
                  </button>
                ))}
              </>
            )}
          </aside>
          <section className="inventory-catalog">
            <div className="inventory-searchbar">
              <label>
                <span>Find inventory</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name, SKU, category, or location"
                />
              </label>
              <output>{visible.length} items</output>
            </div>
            <div className="inventory-table" role="table">
              <div className="inventory-table-head" role="row">
                <span>Item</span>
                <span>SKU</span>
                <span>Location</span>
                <span>On hand</span>
                <span />
              </div>
              {visible.map((item) => (
                <article key={item.id} role="row">
                  <span className="inventory-item-name">
                    <small>{item.category}</small>
                    <b>{item.name}</b>
                    <span
                      className={`availability-badge availability-${availabilityFor(item)}`}
                    >
                      {availabilityLabel(item)}
                    </span>
                    <small>
                      Updated {new Date(item.updated_at).toLocaleDateString()}
                    </small>
                  </span>
                  <span data-label="SKU">{sku(item)}</span>
                  <span data-label="Location">{itemLocation(item) || "—"}</span>
                  <output
                    className={
                      Number(item.quantity) === 0
                        ? "empty"
                        : Number(item.quantity) <= 5
                          ? "low"
                          : ""
                    }
                  >
                    {item.quantity} <small>{item.unit}</small>
                  </output>
                  <span className="inventory-row-actions">
                    {permissions.adjustInventory ? (
                      <button onClick={() => openAdjustment(item, "used")}>
                        Update stock
                      </button>
                    ) : (
                      <button onClick={() => navigate(`org/${slug}`)}>
                        View
                      </button>
                    )}
                  </span>
                </article>
              ))}
              {!visible.length && (
                <div className="friendly-empty">
                  <h2>No matching inventory</h2>
                  <p>Choose another group, category, or search term.</p>
                </div>
              )}
            </div>
          </section>
        </div>
        <section className="inventory-activity">
          <div>
            <small>AUDIT TRAIL</small>
            <h2>Recent inventory activity</h2>
          </div>
          <div>
            {transactions.slice(0, 12).map((item) => {
              const record = records.find(
                (recordItem) => recordItem.id === item.record_id,
              );
              return (
                <article key={item.id}>
                  <span>
                    <b>{record?.name || "Inventory item"}</b>
                    <small>
                      {item.event_type === "sold" ? "Sold" : item.event_type} ·{" "}
                      {item.quantity}
                      {record?.unit ? ` ${record.unit}` : ""} ·{" "}
                      {item.actor_name || "Team member"}
                    </small>
                    {item.event_type === "sold" && item.counterparty && (
                      <small>
                        To {item.counterparty}
                        {item.reference_code ? ` · ${item.reference_code}` : ""}
                      </small>
                    )}
                  </span>
                  <span>
                    <b>{item.after_quantity ?? "—"}</b>
                    <small>{new Date(item.created_at).toLocaleString()}</small>
                  </span>
                </article>
              );
            })}
            {!transactions.length && (
              <p>No inventory changes have been recorded yet.</p>
            )}
          </div>
        </section>
      </main>
      {adjusting && (
        <div className="inventory-adjust-overlay" role="presentation">
          <form className="inventory-adjust-card" onSubmit={adjustInventory}>
            <button
              type="button"
              className="detail-close"
              onClick={() => setAdjusting(null)}
            >
              ×
            </button>
            <small>UPDATE INVENTORY</small>
            <h2>{adjusting.name}</h2>
            <p>
              Currently {adjusting.quantity} {adjusting.unit}
            </p>
            <label>
              What changed?
              <select
                name="event_kind"
                value={adjustEventKind}
                onChange={(event) =>
                  setAdjustEventKind(event.target.value as InventoryEventKind)
                }
              >
                <option value="used">Stock was used or removed</option>
                <option value="added">Stock was received or returned</option>
                <option value="counted">Set the exact counted quantity</option>
              </select>
            </label>
            <label>
              Quantity
              <input
                name="quantity"
                type="number"
                min="0"
                step="any"
                required
              />
            </label>
            <label>
              Note
              <input
                name="note"
                placeholder="Job, order, delivery, or reason"
              />
            </label>
            <button className="save-button">Save inventory change</button>
          </form>
        </div>
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
