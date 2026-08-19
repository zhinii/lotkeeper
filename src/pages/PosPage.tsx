import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../components/AppHeader";
import { featuresFor, money, posConfigurationFor } from "../lib/features";
import { availabilityFor, availabilityLabel } from "../lib/inventory";
import { permissionsFor, roleLabel } from "../lib/permissions";
import { navigate } from "../lib/route";
import { requireSupabase } from "../lib/supabase";
import type {
  MemberPermissions,
  Organization,
  OrganizationMembership,
  RecordItem,
  SaleRecord,
} from "../types";

type CartLine = {
  record: RecordItem;
  quantity: number;
  unitPrice: number;
};

type Receipt = {
  id: string;
  sale_number: string;
  subtotal: number;
  tax_amount: number;
  total: number;
};

function sku(record: RecordItem) {
  return String(record.data.sku || record.data.asset_id || "").trim();
}

function location(record: RecordItem) {
  return String(
    record.data.location_code ||
      record.data.location ||
      record.data.storage_location ||
      record.data.bin ||
      "",
  ).trim();
}

function configuredPrice(record: RecordItem) {
  const value = Number(
    record.data.unit_price ?? record.data.sale_price ?? record.data.price ?? 0,
  );
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export default function PosPage({
  slug,
  initialRecordId,
}: {
  slug: string;
  initialRecordId: string | null;
}) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [membership, setMembership] = useState<OrganizationMembership | null>(
    null,
  );
  const [permissions, setPermissions] = useState<MemberPermissions | null>(
    null,
  );
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [cart, setCart] = useState<Record<string, CartLine>>({});
  const [collectionId, setCollectionId] = useState("");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [taxRate, setTaxRate] = useState(0);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [posReady, setPosReady] = useState(true);
  const [message, setMessage] = useState("");
  const initialItemAdded = useRef(false);

  async function loadPos(
    org: Organization,
    access: MemberPermissions,
    userId: string,
  ) {
    const client = requireSupabase();
    const [recordRows, privateRows, salesRows] = await Promise.all([
      client
        .from("records")
        .select("*")
        .eq("organization_id", org.id)
        .eq("status", "active")
        .order("name"),
      client
        .from("record_private_data")
        .select("record_id,data")
        .eq("organization_id", org.id),
      client
        .from("sales")
        .select("*")
        .eq("organization_id", org.id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    if (recordRows.error) setMessage(recordRows.error.message);
    const privateByRecord = new Map(
      (privateRows.data || []).map((row) => [
        row.record_id,
        row.data as Record<string, unknown>,
      ]),
    );
    const availableRecords = ((recordRows.data || []) as RecordItem[])
      .filter((record) => record.quantity !== null)
      .map((record) => ({
        ...record,
        data: { ...record.data, ...(privateByRecord.get(record.id) || {}) },
      }));
    setRecords(availableRecords);
    if (initialRecordId && !initialItemAdded.current) {
      const initialRecord = availableRecords.find(
        (record) => record.id === initialRecordId,
      );
      if (initialRecord && Number(initialRecord.quantity) > 0) {
        initialItemAdded.current = true;
        setCart({
          [initialRecord.id]: {
            record: initialRecord,
            quantity: 1,
            unitPrice: configuredPrice(initialRecord),
          },
        });
      }
    }
    setPosReady(!salesRows.error);
    if (salesRows.error) {
      setMessage(
        salesRows.error.code === "42P01" || salesRows.error.code === "PGRST205"
          ? "Checkout needs the latest Material Pin database migration before it can be used."
          : salesRows.error.message,
      );
      setSales([]);
    } else {
      setSales(
        ((salesRows.data || []) as SaleRecord[]).filter(
          (sale) => access.viewSales || sale.created_by === userId,
        ),
      );
    }
  }

  useEffect(() => {
    (async () => {
      const client = requireSupabase();
      const { data: authData } = await client.auth.getUser();
      if (!authData.user) {
        setMessage("Sign in to use checkout.");
        setLoading(false);
        return;
      }
      const { data: org, error } = await client
        .from("organizations")
        .select("*")
        .eq("slug", slug)
        .single();
      if (error || !org) {
        setMessage(error?.message || "This organization is unavailable.");
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
      setTaxRate(posConfigurationFor(org as Organization).taxRate);
      if (
        !effectiveMembership ||
        !access.usePos ||
        !featuresFor(org as Organization).pos
      ) {
        setMessage(
          "Your access level does not include checkout for this site.",
        );
        setLoading(false);
        return;
      }
      await loadPos(org as Organization, access, authData.user.id);
      setLoading(false);
    })();
  }, [slug, initialRecordId]);

  const collections = useMemo(
    () =>
      (organization?.collections || []).filter((collection) =>
        records.some((record) => record.collection_id === collection.id),
      ),
    [organization, records],
  );

  useEffect(() => {
    if (!collectionId && collections.length) setCollectionId(collections[0].id);
  }, [collectionId, collections]);

  const categories = useMemo(
    () =>
      [
        ...new Set(
          records
            .filter((record) => record.collection_id === collectionId)
            .map((record) => record.category || "Uncategorized"),
        ),
      ].sort(),
    [records, collectionId],
  );

  const visibleRecords = useMemo(() => {
    const term = query.trim().toLowerCase();
    return records.filter((record) => {
      if (record.collection_id !== collectionId) return false;
      if (category !== "all" && record.category !== category) return false;
      if (term)
        return [record.name, sku(record), record.category, location(record)]
          .join(" ")
          .toLowerCase()
          .includes(term);
      return true;
    });
  }, [records, collectionId, category, query]);

  const cartLines = Object.values(cart);
  const currency = posConfigurationFor(organization).currency;
  const subtotal = cartLines.reduce(
    (sum, line) => sum + line.quantity * line.unitPrice,
    0,
  );
  const taxAmount = subtotal * (taxRate / 100);
  const total = subtotal + taxAmount;

  function addToCart(record: RecordItem) {
    if (Number(record.quantity) <= 0) return;
    setCart((current) => {
      const existing = current[record.id];
      const quantity = Math.min(
        Number(record.quantity),
        (existing?.quantity || 0) + 1,
      );
      return {
        ...current,
        [record.id]: {
          record,
          quantity,
          unitPrice: existing?.unitPrice ?? configuredPrice(record),
        },
      };
    });
    setReceipt(null);
  }

  function updateCartLine(
    recordId: string,
    update: Partial<Pick<CartLine, "quantity" | "unitPrice">>,
  ) {
    setCart((current) => {
      const line = current[recordId];
      if (!line) return current;
      const quantity = Math.max(
        0,
        Math.min(
          Number(line.record.quantity),
          update.quantity ?? line.quantity,
        ),
      );
      if (quantity === 0) {
        const next = { ...current };
        delete next[recordId];
        return next;
      }
      return {
        ...current,
        [recordId]: {
          ...line,
          ...update,
          quantity,
          unitPrice: Math.max(0, update.unitPrice ?? line.unitPrice),
        },
      };
    });
  }

  async function checkout(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization || !permissions?.usePos || !cartLines.length) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSubmitting(true);
    setMessage("");
    const { data, error } = await requireSupabase().rpc("checkout_sale", {
      target_organization: organization.id,
      cart_items: cartLines.map((line) => ({
        record_id: line.record.id,
        quantity: line.quantity,
        unit_price: line.unitPrice,
      })),
      customer_text: String(form.get("customer") || "").trim(),
      contact_text: String(form.get("contact") || "").trim(),
      reference_text: String(form.get("reference") || "").trim(),
      payment_method_text: String(form.get("payment_method") || "invoice"),
      tax_rate_value: taxRate,
      note_text: String(form.get("note") || "").trim(),
    });
    setSubmitting(false);
    if (error) return setMessage(error.message);
    setReceipt(data as Receipt);
    setCart({});
    formElement.reset();
    setTaxRate(posConfigurationFor(organization).taxRate);
    const { data: authData } = await requireSupabase().auth.getUser();
    if (authData.user)
      await loadPos(organization, permissions, authData.user.id);
  }

  if (loading) return <div className="loading-screen">Opening checkout…</div>;
  if (!organization || !membership || !permissions?.usePos)
    return (
      <main className="access-page">
        <button className="access-back" onClick={() => navigate("staff")}>
          ← My organizations
        </button>
        <section className="access-card">
          <div className="brand">MATERIAL PIN</div>
          <small>CHECKOUT ACCESS</small>
          <h1>Checkout is not available</h1>
          <p>{message}</p>
          <button onClick={() => navigate("staff")}>Return to my tools</button>
        </section>
      </main>
    );

  return (
    <div className="pos-page product-page">
      <AppHeader context={`${organization.name} · Checkout`} backTo="staff">
        {featuresFor(organization).mapping && (
          <button onClick={() => navigate(`org/${slug}`)}>Visual finder</button>
        )}
        {featuresFor(organization).inventory && permissions.viewInventory && (
          <button onClick={() => navigate(`inventory/${slug}`)}>
            Inventory
          </button>
        )}
        {membership.role === "admin" && (
          <button onClick={() => navigate(`admin/${slug}`)}>
            Admin console
          </button>
        )}
      </AppHeader>
      <main className="pos-shell">
        <section className="pos-heading">
          <div>
            <small>CHECKOUT / POS</small>
            <h1>Build the sale, then confirm it</h1>
            <p>
              Stock changes only after checkout is confirmed. Material Pin
              records billing details; payment processing remains external.
            </p>
          </div>
          <span className="role-badge">{roleLabel(membership.role)}</span>
        </section>
        {message && <p className="pos-notice">{message}</p>}
        {receipt && (
          <section className="pos-receipt" aria-live="polite">
            <div>
              <small>SALE COMPLETE</small>
              <h2>{receipt.sale_number}</h2>
              <p>Inventory and sales history were updated together.</p>
            </div>
            <strong>{money(Number(receipt.total), currency)}</strong>
            <button onClick={() => window.print()}>Print confirmation</button>
          </section>
        )}
        <div className="pos-workspace">
          <section className="pos-catalog">
            <div className="pos-search-row">
              <label>
                Find an item
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name, SKU, category, or location"
                />
              </label>
              <output>{visibleRecords.length} items</output>
            </div>
            <div className="pos-filter-row">
              <label>
                Item group
                <select
                  value={collectionId}
                  onChange={(event) => {
                    setCollectionId(event.target.value);
                    setCategory("all");
                  }}
                >
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Category
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  <option value="all">All categories</option>
                  {categories.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="pos-item-list">
              {visibleRecords.map((record) => {
                const outOfStock = Number(record.quantity) <= 0;
                return (
                  <article className={outOfStock ? "out" : ""} key={record.id}>
                    <div>
                      <small>{record.category}</small>
                      <h2>{record.name}</h2>
                      <p>
                        {sku(record) || "No SKU"} ·{" "}
                        {location(record) || "No location"}
                      </p>
                    </div>
                    <span>
                      <b>{money(configuredPrice(record), currency)}</b>
                      <small>
                        {record.quantity} {record.unit || "units"} on hand
                      </small>
                      <small
                        className={`availability-badge availability-${availabilityFor(record)}`}
                      >
                        {availabilityLabel(record)}
                      </small>
                    </span>
                    <button
                      disabled={outOfStock}
                      onClick={() => addToCart(record)}
                    >
                      {outOfStock ? availabilityLabel(record) : "Add"}
                    </button>
                  </article>
                );
              })}
              {!visibleRecords.length && (
                <div className="friendly-empty">
                  <h2>No matching stock</h2>
                  <p>Try another item group, category, or search term.</p>
                </div>
              )}
            </div>
          </section>
          <form className="pos-cart" onSubmit={checkout}>
            <div className="pos-cart-heading">
              <span>
                <small>CURRENT SALE</small>
                <h2>
                  {cartLines.length
                    ? `${cartLines.length} items`
                    : "Cart is empty"}
                </h2>
              </span>
              {!!cartLines.length && (
                <button type="button" onClick={() => setCart({})}>
                  Clear
                </button>
              )}
            </div>
            <div className="pos-cart-lines">
              {cartLines.map((line) => (
                <article key={line.record.id}>
                  <div>
                    <b>{line.record.name}</b>
                    <small>{sku(line.record) || line.record.category}</small>
                  </div>
                  <label>
                    Qty
                    <input
                      type="number"
                      min="0.01"
                      max={Number(line.record.quantity)}
                      step="any"
                      value={line.quantity}
                      onChange={(event) =>
                        updateCartLine(line.record.id, {
                          quantity: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Unit price
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitPrice}
                      onChange={(event) =>
                        updateCartLine(line.record.id, {
                          unitPrice: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <strong>
                    {money(line.quantity * line.unitPrice, currency)}
                  </strong>
                  <button
                    type="button"
                    aria-label={`Remove ${line.record.name}`}
                    onClick={() =>
                      updateCartLine(line.record.id, { quantity: 0 })
                    }
                  >
                    ×
                  </button>
                </article>
              ))}
              {!cartLines.length && (
                <p>Choose items from the catalog to begin a checkout.</p>
              )}
            </div>
            <fieldset disabled={!cartLines.length}>
              <legend>Customer and billing</legend>
              <label>
                Customer, company, or job
                <input name="customer" required />
              </label>
              <label>
                Contact
                <input name="contact" placeholder="Phone or email (optional)" />
              </label>
              <label>
                Order / invoice reference
                <input name="reference" placeholder="Optional" />
              </label>
              <label>
                Payment method
                <select name="payment_method" defaultValue="invoice">
                  <option value="invoice">Invoice / account</option>
                  <option value="cash">Cash</option>
                  <option value="external_card">Card recorded elsewhere</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label>
                Tax rate (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={taxRate}
                  onChange={(event) => setTaxRate(Number(event.target.value))}
                />
              </label>
              <label className="pos-note-field">
                Note
                <input
                  name="note"
                  placeholder="Delivery, pickup, or internal note"
                />
              </label>
            </fieldset>
            <dl className="pos-totals">
              <div>
                <dt>Subtotal</dt>
                <dd>{money(subtotal, currency)}</dd>
              </div>
              <div>
                <dt>Tax</dt>
                <dd>{money(taxAmount, currency)}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>{money(total, currency)}</dd>
              </div>
            </dl>
            <button
              className="pos-checkout-button"
              disabled={!cartLines.length || !posReady || submitting}
            >
              {submitting ? "Recording sale…" : "Confirm checkout"}
            </button>
          </form>
        </div>
        <section className="pos-history">
          <div>
            <small>
              {permissions.viewSales ? "ORGANIZATION SALES" : "YOUR SALES"}
            </small>
            <h2>Recent checkouts</h2>
          </div>
          <div>
            {sales.map((sale) => (
              <article key={sale.id}>
                <span>
                  <b>{sale.sale_number}</b>
                  <small>
                    {sale.customer_name} · {sale.actor_name}
                  </small>
                </span>
                <span>
                  <b>{money(Number(sale.total), currency)}</b>
                  <small>{new Date(sale.created_at).toLocaleString()}</small>
                </span>
              </article>
            ))}
            {!sales.length && <p>No completed checkouts yet.</p>}
          </div>
        </section>
      </main>
    </div>
  );
}
