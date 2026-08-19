import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import SiteMapView from "../components/SiteMapView";
import { featuresFor } from "../lib/features";
import { permissionsFor } from "../lib/permissions";
import { navigate } from "../lib/route";
import { requireSupabase, siteMapUrl } from "../lib/supabase";
import type {
  Organization,
  OrganizationMembership,
  RecordItem,
} from "../types";

function itemLocation(record: RecordItem) {
  return String(
    record.data.location_code ||
      record.data.location ||
      record.data.storage_location ||
      record.data.bin ||
      "",
  ).trim();
}

export default function MoveItemPage({
  slug,
  recordId,
}: {
  slug: string;
  recordId: string;
}) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [record, setRecord] = useState<RecordItem | null>(null);
  const [mapImage, setMapImage] = useState("");
  const [point, setPoint] = useState({ latitude: 0, longitude: 0 });
  const [location, setLocation] = useState("");
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    (async () => {
      const client = requireSupabase();
      const { data: authData } = await client.auth.getUser();
      if (!authData.user) {
        setMessage("Sign in to relocate items.");
        setLoading(false);
        return;
      }
      const { data: org, error: orgError } = await client
        .from("organizations")
        .select("*")
        .eq("slug", slug)
        .single();
      if (orgError || !org) {
        setMessage(orgError?.message || "Organization not found.");
        setLoading(false);
        return;
      }
      const [{ data: item }, { data: member }, { data: platformRows }] =
        await Promise.all([
          client
            .from("records")
            .select("*")
            .eq("id", recordId)
            .eq("organization_id", org.id)
            .single(),
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
      const canMove =
        Boolean(item) &&
        permissionsFor(effectiveMembership).moveItems &&
        featuresFor(org as Organization).mapping;
      setOrganization(org as Organization);
      setRecord((item as RecordItem) || null);
      setAllowed(canMove);
      if (item) {
        setPoint({ latitude: item.latitude, longitude: item.longitude });
        setLocation(itemLocation(item as RecordItem));
      }
      if (org.map_image_path) setMapImage(await siteMapUrl(org.map_image_path));
      if (!canMove)
        setMessage("Your permissions do not allow direct item relocation.");
      setLoading(false);
    })();
  }, [slug, recordId]);

  async function saveMove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization || !record || !allowed) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setMessage("");
    const { error } = await requireSupabase().rpc("move_record", {
      target_record: record.id,
      latitude_value: point.latitude,
      longitude_value: point.longitude,
      location_text: location,
      note_text: String(form.get("note") || "").trim(),
    });
    setSaving(false);
    if (error) return setMessage(error.message);
    navigate(`org/${organization.slug}`);
  }

  if (loading) return <div className="loading-screen">Opening item map…</div>;
  if (!organization || !record || !allowed)
    return (
      <main className="access-page">
        <button className="access-back" onClick={() => navigate("staff")}>
          ← My organizations
        </button>
        <section className="access-card">
          <div className="brand">MATERIAL PIN</div>
          <small>RELOCATION ACCESS</small>
          <h1>This item cannot be moved here</h1>
          <p>{message}</p>
          <button onClick={() => navigate(`org/${slug}`)}>
            Return to finder
          </button>
        </section>
      </main>
    );

  const moved =
    point.latitude !== record.latitude || point.longitude !== record.longitude;

  return (
    <div className="move-item-page product-page">
      <AppHeader
        context={`${organization.name} · Relocate item`}
        backTo={`org/${slug}`}
      >
        <button onClick={() => navigate(`org/${slug}`)}>Cancel</button>
      </AppHeader>
      <main className="move-item-shell">
        <section className="move-item-heading">
          <small>RELOCATE ITEM</small>
          <h1>{record.name}</h1>
          <p>
            Drag the pin or tap the new position. The old and new locations are
            saved in movement history.
          </p>
        </section>
        <form onSubmit={saveMove}>
          <div className="move-item-map">
            <SiteMapView
              organization={organization}
              mapImageUrl={mapImage}
              markerLatitude={point.latitude}
              markerLongitude={point.longitude}
              markerLabel={record.name}
              showMarker
              picker
              boundary={organization.boundary}
              onPick={(latitude, longitude) =>
                setPoint({ latitude, longitude })
              }
            />
          </div>
          <section className="move-item-details">
            <div className="movement-comparison">
              <article>
                <small>FROM</small>
                <b>{itemLocation(record) || "Unnamed location"}</b>
                <code>
                  {record.latitude.toFixed(6)}, {record.longitude.toFixed(6)}
                </code>
              </article>
              <article className={moved ? "changed" : ""}>
                <small>TO</small>
                <b>{location || "Choose a named location"}</b>
                <code>
                  {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}
                </code>
              </article>
            </div>
            <label>
              New named location / bin
              <input
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Aisle 4, rack B, north yard…"
              />
            </label>
            <label>
              Reason or movement note
              <textarea
                name="note"
                rows={3}
                placeholder="Moved for staging, restocking, customer pickup…"
              />
            </label>
            {message && <p className="notice">{message}</p>}
            <button className="save-button" disabled={!moved || saving}>
              {saving ? "Saving move…" : "Save new location"}
            </button>
          </section>
        </form>
      </main>
    </div>
  );
}
