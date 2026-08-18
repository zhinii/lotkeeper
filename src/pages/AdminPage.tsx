import { useEffect, useState } from "react";
import CollectionEditor from "../components/CollectionEditor";
import SiteMapView from "../components/SiteMapView";
import OrganizationMapEditor, {
  type MapConfiguration,
} from "../components/OrganizationMapEditor";
import {
  configuredCaptureFields,
  normalizeCollections,
} from "../lib/captureFields";
import { materialDefaults } from "../lib/collections";
import {
  employeeDefaults,
  employeePermissionOptions,
  permissionsFor,
  roleLabel,
} from "../lib/permissions";
import { navigate } from "../lib/route";
import { requireSupabase, siteMapUrl } from "../lib/supabase";
import type {
  AlertItem,
  CollectionDefinition,
  Organization,
  RecordItem,
  SearchEvent,
  Submission,
  MemberPermissions,
  MemberRole,
} from "../types";

type Tab =
  | "overview"
  | "review"
  | "records"
  | "activity"
  | "configure"
  | "create";

const adminTabs: { id: Tab; label: string; icon: string }[] = [
  { id: "overview", label: "Home", icon: "⌂" },
  { id: "review", label: "Review", icon: "✓" },
  { id: "records", label: "Items", icon: "▦" },
  { id: "activity", label: "Searches", icon: "⌕" },
  { id: "configure", label: "Settings", icon: "⚙" },
];

type OrganizationMember = {
  user_id: string;
  email: string;
  role: MemberRole;
  permissions: Partial<MemberPermissions> | null;
  created_at: string;
  is_owner: boolean;
};

function cloneCollections(collections: CollectionDefinition[]) {
  return normalizeCollections(collections);
}

function aiStatusLabel(status: Submission["ai_status"]) {
  if (status === "complete") return "Suggestions ready";
  if (status === "queued" || status === "processing") return "Analyzing photo";
  if (status === "failed") return "Photo analysis needs another try";
  return "Photo analysis not used";
}

async function functionErrorMessage(data: any, error: any, fallback: string) {
  if (data?.error) return String(data.error);
  try {
    const context = error?.context;
    if (context && typeof context.json === "function") {
      const body = await context.json();
      if (body?.error) return String(body.error);
    }
  } catch {
    // Use the SDK message below when the response body is unavailable.
  }
  return error?.message || fallback;
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) =>
    header
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "_"),
  );
  return rows
    .slice(1)
    .map((cells) =>
      Object.fromEntries(
        headers.map((header, index) => [header, cells[index] || ""]),
      ),
    );
}

export default function AdminPage() {
  const [session, setSession] = useState<any>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selected, setSelected] = useState<Organization | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [searches, setSearches] = useState<SearchEvent[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [newMemberRole, setNewMemberRole] =
    useState<Exclude<MemberRole, "staff">>("employee");
  const [memberRoleDrafts, setMemberRoleDrafts] = useState<
    Record<string, Exclude<MemberRole, "staff">>
  >({});
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
    mode: "gps",
    imagePath: null,
    imageUrl: "",
    gridRows: 8,
    gridColumns: 10,
    label: "Site map",
  });
  const [editMapFile, setEditMapFile] = useState<File | null>(null);
  const [editPublic, setEditPublic] = useState(false);
  const [editAi, setEditAi] = useState(false);
  const [editAiContext, setEditAiContext] = useState("");
  const [createPublic, setCreatePublic] = useState(true);
  const [createCollections, setCreateCollections] = useState<
    CollectionDefinition[]
  >(() => cloneCollections(materialDefaults));
  const [createMap, setCreateMap] = useState<MapConfiguration>({
    latitude: 36.9148,
    longitude: -111.4573,
    zoom: 14,
    boundary: [],
    mode: "gps",
    imagePath: null,
    imageUrl: "",
    gridRows: 8,
    gridColumns: 10,
    label: "Site map",
  });
  const [importPoint, setImportPoint] = useState({
    latitude: 36.9148,
    longitude: -111.4573,
  });
  const [recordQuery, setRecordQuery] = useState("");
  const [recordCollection, setRecordCollection] = useState("");
  const [recordCategory, setRecordCategory] = useState("");

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
      setEditCollections(cloneCollections(selected.collections));
      setEditMap({
        latitude: selected.center_lat,
        longitude: selected.center_lng,
        zoom: selected.map_zoom,
        boundary: selected.boundary || [],
        mode: selected.map_mode || "gps",
        imagePath: selected.map_image_path || null,
        imageUrl: "",
        gridRows: selected.map_config?.gridRows || 8,
        gridColumns: selected.map_config?.gridColumns || 10,
        label: selected.map_config?.label || "Site map",
      });
      setEditMapFile(null);
      if (selected.map_image_path)
        void siteMapUrl(selected.map_image_path).then((imageUrl) =>
          setEditMap((current) =>
            current.imagePath === selected.map_image_path
              ? { ...current, imageUrl }
              : current,
          ),
        );
      setEditPublic(selected.public_access);
      setEditAi(selected.ai_enabled);
      setEditAiContext(selected.ai_catalog_context || "");
      setImportPoint({
        latitude: selected.map_mode === "gps" ? selected.center_lat : 50,
        longitude: selected.map_mode === "gps" ? selected.center_lng : 50,
      });
      setRecordCollection("");
      setRecordCategory("");
      setRecordQuery("");
      setSubmissionPhotos({});
      loadWorkspace(selected.id);
      loadMembers(selected.id);
    }
  }, [selected?.id]);
  useEffect(() => {
    if (tab !== "review") return;
    const reviewSubmissions = submissions.filter((item) =>
      reviewView === "pending"
        ? item.status === "pending"
        : item.status !== "pending",
    );
    void loadSubmissionPhotos(reviewSubmissions);
  }, [tab, reviewView, submissions]);
  useEffect(() => {
    if (tab !== "records") return;
    setRecordCollection("");
    setRecordCategory("");
    setRecordQuery("");
  }, [tab]);

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
    const [submissionRows, recordRows, privateRows, alertRows, searchRows] =
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
        client
          .from("search_events")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(250),
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
    setSearches((searchRows.data || []) as SearchEvent[]);
  }

  async function loadSubmissionPhotos(items: Submission[]) {
    const missing = items.filter(
      (item) => item.photo_path && !submissionPhotos[item.id],
    );
    if (!missing.length) return;
    const client = requireSupabase();
    const photoEntries = await Promise.all(
      missing.map(async (item) => {
        const { data } = await client.storage
          .from("submission-media")
          .createSignedUrl(item.photo_path!, 1800);
        return [item.id, data?.signedUrl || ""] as const;
      }),
    );
    setSubmissionPhotos((current) => ({
      ...current,
      ...Object.fromEntries(photoEntries),
    }));
  }

  async function createOrganization(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const client = requireSupabase();
    const { data: newId, error } = await client.rpc("create_organization", {
      org_name: String(form.get("name")),
      org_slug: String(form.get("slug")),
      org_mode: "material",
      is_public: createPublic,
      latitude: createMap.latitude,
      longitude: createMap.longitude,
      zoom_level: createMap.zoom,
      collection_config: normalizeCollections(createCollections),
    });
    if (error) return setMessage(error.message);
    if (newId) {
      const { error: setupError } = await client
        .from("organizations")
        .update({
          boundary: createMap.boundary,
          ai_enabled: form.get("ai_enabled") === "on",
          ai_catalog_context: String(
            form.get("ai_catalog_context") || "",
          ).trim(),
          map_mode: createMap.mode,
          map_config: {
            gridRows: createMap.gridRows,
            gridColumns: createMap.gridColumns,
            label: createMap.label,
          },
        })
        .eq("id", newId);
      if (setupError) return setMessage(setupError.message);
    }
    setMessage("Organization created.");
    setTab("overview");
    await loadOrganizations();
  }
  async function saveConfiguration() {
    if (!selected) return;
    let imagePath = editMap.imagePath;
    if (editMapFile) {
      const extension =
        editMapFile.type === "image/png"
          ? "png"
          : editMapFile.type === "image/webp"
            ? "webp"
            : "jpg";
      imagePath = `${selected.id}/site-map.${extension}`;
      const upload = await requireSupabase()
        .storage.from("site-maps")
        .upload(imagePath, editMapFile, {
          upsert: true,
          contentType: editMapFile.type,
        });
      if (upload.error) return setMessage(upload.error.message);
    }
    const { error } = await requireSupabase()
      .from("organizations")
      .update({
        collections: normalizeCollections(editCollections),
        public_access: editPublic,
        ai_enabled: editAi,
        ai_catalog_context: editAiContext.trim(),
        center_lat: editMap.latitude,
        center_lng: editMap.longitude,
        map_zoom: editMap.zoom,
        boundary: editMap.boundary,
        map_mode: editMap.mode,
        map_image_path: imagePath,
        map_config: {
          gridRows: editMap.gridRows,
          gridColumns: editMap.gridColumns,
          label: editMap.label.trim() || "Site map",
        },
      })
      .eq("id", selected.id);
    if (error) return setMessage(error.message);
    setEditMapFile(null);
    setMessage("People, map, access, AI, and item settings saved.");
    await loadOrganizations();
  }

  async function loadMembers(organizationId: string) {
    setMembersLoading(true);
    const { data, error } = await requireSupabase().functions.invoke(
      "manage-organization",
      { body: { action: "list_members", organization_id: organizationId } },
    );
    setMembersLoading(false);
    if (error || data?.error) {
      setMembers([]);
      return setMessage(
        await functionErrorMessage(
          data,
          error,
          "Employee accounts could not be loaded.",
        ),
      );
    }
    const loadedMembers = (data?.members || []) as OrganizationMember[];
    setMembers(loadedMembers);
    setMemberRoleDrafts(
      Object.fromEntries(
        loadedMembers.map((member) => [
          member.user_id,
          member.role === "staff" ? "employee" : member.role,
        ]),
      ),
    );
  }

  async function createEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage("Saving person access…");
    const { data, error } = await requireSupabase().functions.invoke(
      "manage-organization",
      {
        body: {
          action: "create_member",
          organization_id: selected.id,
          email: String(form.get("employee_email") || "").trim(),
          password: String(form.get("temporary_password") || ""),
          role: String(form.get("employee_role") || "employee"),
          permissions: Object.fromEntries(
            employeePermissionOptions.map((permission) => [
              permission.key,
              form.get(`permission_${permission.key}`) === "on",
            ]),
          ),
        },
      },
    );
    if (error || data?.error)
      return setMessage(
        await functionErrorMessage(
          data,
          error,
          "Employee access could not be created.",
        ),
      );
    formElement.reset();
    setNewMemberRole("employee");
    setMessage(data.message || "Person access saved.");
    await loadMembers(selected.id);
  }

  async function updateMemberAccess(
    event: React.FormEvent<HTMLFormElement>,
    member: OrganizationMember,
  ) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const { data, error } = await requireSupabase().functions.invoke(
      "manage-organization",
      {
        body: {
          action: "update_member",
          organization_id: selected.id,
          user_id: member.user_id,
          role: String(form.get("member_role") || "viewer"),
          permissions: Object.fromEntries(
            employeePermissionOptions.map((permission) => [
              permission.key,
              form.get(`member_permission_${permission.key}`) === "on",
            ]),
          ),
        },
      },
    );
    if (error || data?.error)
      return setMessage(
        await functionErrorMessage(data, error, "Access could not be updated."),
      );
    setMessage(data.message || "Access permissions saved.");
    await loadMembers(selected.id);
  }

  async function removeMember(member: OrganizationMember) {
    if (!selected || !confirm(`Remove ${member.email} from ${selected.name}?`))
      return;
    const { data, error } = await requireSupabase().functions.invoke(
      "manage-organization",
      {
        body: {
          action: "remove_member",
          organization_id: selected.id,
          user_id: member.user_id,
        },
      },
    );
    if (error || data?.error)
      return setMessage(
        await functionErrorMessage(
          data,
          error,
          "Employee access could not be removed.",
        ),
      );
    setMessage(data.message || "Employee access removed.");
    await loadMembers(selected.id);
  }

  async function deleteOrganization() {
    if (!selected) return;
    const confirmation = prompt(
      `This permanently deletes ${selected.name}, its items, submissions, photos and history.\n\nType the exact organization name to continue:`,
    );
    if (confirmation === null) return;
    if (confirmation !== selected.name)
      return setMessage(
        "Nothing was deleted. The organization name did not match.",
      );
    setMessage(`Deleting ${selected.name}…`);
    const { data, error } = await requireSupabase().functions.invoke(
      "manage-organization",
      {
        body: {
          action: "delete_organization",
          organization_id: selected.id,
          confirmation,
        },
      },
    );
    if (error || data?.error)
      return setMessage(
        await functionErrorMessage(
          data,
          error,
          "The organization could not be deleted.",
        ),
      );
    setSelected(null);
    setMembers([]);
    setTab("overview");
    setMessage(data.message || "Organization deleted.");
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
        const { data: approvedRecordId, error } = await client.rpc(
          "approve_submission",
          {
            submission_id: item.id,
            published_photo_path: publicPath,
          },
        );
        if (error) throw error;
        const requestedVisibility = item.proposed.public_visible;
        if (typeof requestedVisibility === "boolean" && approvedRecordId) {
          const { error: visibilityError } = await client
            .from("records")
            .update({ public_visible: requestedVisibility })
            .eq("id", approvedRecordId);
          if (visibilityError) throw visibilityError;
        }
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
  async function saveRecord(
    event: React.FormEvent<HTMLFormElement>,
    item: RecordItem,
  ) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const quantityText = String(form.get("quantity") || "").trim();
    const quantity = quantityText === "" ? null : Number(quantityText);
    const client = requireSupabase();
    const { data: user } = await client.auth.getUser();
    const nextCollectionId = String(
      form.get("collection_id") || item.collection_id,
    );
    const configuredCollection = selected?.collections.find(
      (collection) => collection.id === nextCollectionId,
    );
    const nextData: Record<string, unknown> = { ...item.data };
    for (const field of configuredCaptureFields(configuredCollection || null)) {
      if (field.key === "quantity" || field.key === "unit") continue;
      nextData[field.key] =
        field.type === "boolean"
          ? form.get(field.key) === "on"
          : String(form.get(field.key) || "").trim();
    }
    const { error } = await client
      .from("records")
      .update({
        collection_id: nextCollectionId,
        name: String(form.get("name") || "").trim(),
        description: String(form.get("description") || "").trim(),
        category: String(form.get("category") || "").trim() || "Uncategorized",
        quantity,
        unit: String(form.get("unit") || "").trim() || null,
        latitude: Number(form.get("latitude")),
        longitude: Number(form.get("longitude")),
        public_visible: form.get("public_visible") === "on",
        data: nextData,
        version: item.version + 1,
        updated_at: new Date().toISOString(),
        updated_by: user.user?.id || null,
      })
      .eq("id", item.id);
    if (error) return setMessage(error.message);
    if (quantity !== item.quantity && quantity !== null && user.user) {
      await client.from("inventory_transactions").insert({
        organization_id: item.organization_id,
        record_id: item.id,
        user_id: user.user.id,
        event_type: "counted",
        quantity,
        before_quantity: item.quantity,
        after_quantity: quantity,
        note: "Administrator inventory edit",
      });
    }
    setMessage(`Saved ${String(form.get("name") || item.name)}.`);
    if (selected) await loadWorkspace(selected.id);
  }

  async function importCsv(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget);
    const file = form.get("csv") as File;
    if (!file?.size) return setMessage("Choose a CSV file first.");
    const rows = parseCsv(await file.text());
    if (!rows.length)
      return setMessage(
        "The CSV needs a header row and at least one item row.",
      );
    const collectionId = String(form.get("collection_id") || "");
    const collection = selected.collections.find(
      (item) => item.id === collectionId,
    );
    if (!collection) return setMessage("Choose an item group for the import.");
    const defaultLocation = String(form.get("default_location") || "").trim();
    const defaultPublic = form.get("public_visible") === "on";
    const { data: user } = await requireSupabase().auth.getUser();
    const payload = rows
      .map((row) => {
        const name = row.name || row.item_name || row.item || row.description;
        if (!name) return null;
        const latitude = Number(
          row.latitude || row.lat || importPoint.latitude,
        );
        const longitude = Number(
          row.longitude || row.lng || row.lon || importPoint.longitude,
        );
        const quantityText = row.quantity || row.qty || row.count;
        const publicText = (
          row.public ||
          row.public_visible ||
          ""
        ).toLowerCase();
        return {
          organization_id: selected.id,
          collection_id: row.collection_id || collectionId,
          name,
          description: row.description || "",
          keywords: String(row.keywords || row.tags || "")
            .split(/[|;,]/)
            .map((item) => item.trim())
            .filter(Boolean),
          category: row.category || collection.name,
          data: {
            sku: row.sku || row.sku_number || row.asset_id || "",
            location_code:
              row.location || row.location_code || row.bin || defaultLocation,
            manufacturer: row.manufacturer || row.brand || "",
            condition: row.condition || "",
            lot_serial: row.lot_serial || row.serial || row.serial_number || "",
          },
          quantity:
            quantityText === "" || quantityText == null
              ? null
              : Number(quantityText),
          unit: row.unit || null,
          latitude: Number.isFinite(latitude) ? latitude : importPoint.latitude,
          longitude: Number.isFinite(longitude)
            ? longitude
            : importPoint.longitude,
          location_source: "manual_pin",
          photo_path: null,
          public_visible: publicText
            ? !["false", "no", "0", "private"].includes(publicText)
            : defaultPublic,
          updated_by: user.user?.id || null,
        };
      })
      .filter(Boolean) as Array<Record<string, unknown>>;
    if (!payload.length) return setMessage("No rows contained an item name.");
    const { error } = await requireSupabase().from("records").insert(payload);
    if (error) return setMessage(error.message);
    setMessage(`Imported ${payload.length} items as mapped inventory pins.`);
    event.currentTarget.reset();
    await loadWorkspace(selected.id);
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
          <div className="brand">MATERIAL PIN</div>
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
  const recordCollectionOptions = (selected?.collections || []).map(
    (collection) => ({
      ...collection,
      count: records.filter((item) => item.collection_id === collection.id)
        .length,
    }),
  );
  const recordCategoryOptions = Object.entries(
    records
      .filter((item) => item.collection_id === recordCollection)
      .reduce<Record<string, RecordItem[]>>((groups, item) => {
        const category = item.category?.trim() || "Uncategorized";
        (groups[category] ||= []).push(item);
        return groups;
      }, {}),
  ).sort(([left], [right]) => left.localeCompare(right));
  const visibleRecords = records.filter((item) => {
    if (!recordCollection || !recordCategory) return false;
    if (item.collection_id !== recordCollection) return false;
    if ((item.category?.trim() || "Uncategorized") !== recordCategory)
      return false;
    const query = recordQuery.trim().toLowerCase();
    if (!query) return true;
    return [
      item.name,
      item.category,
      item.description,
      item.data.sku,
      item.data.location_code,
      item.data.manufacturer,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const recordGroups = (selected?.collections || [])
    .map((collection) => ({
      collection,
      categories: Object.entries(
        visibleRecords
          .filter((item) => item.collection_id === collection.id)
          .reduce<Record<string, RecordItem[]>>((groups, item) => {
            const category = item.category?.trim() || "Uncategorized";
            (groups[category] ||= []).push(item);
            return groups;
          }, {}),
      ).sort(([left], [right]) => left.localeCompare(right)),
    }))
    .filter((group) => group.categories.length);
  const knownCollectionIds = new Set(
    (selected?.collections || []).map((collection) => collection.id),
  );
  const unassignedRecords = visibleRecords.filter(
    (item) => !knownCollectionIds.has(item.collection_id),
  );
  if (unassignedRecords.length) {
    recordGroups.push({
      collection: {
        id: "unassigned",
        name: "Other items",
        icon: "?",
        kind: "persistent",
        publicVisible: false,
        publicSubmit: false,
        fields: [],
      },
      categories: Object.entries(
        unassignedRecords.reduce<Record<string, RecordItem[]>>(
          (groups, item) => {
            const category = item.category?.trim() || "Uncategorized";
            (groups[category] ||= []).push(item);
            return groups;
          },
          {},
        ),
      ),
    });
  }
  return (
    <div className="admin-page">
      <header className="admin-header">
        <button className="brand-button" onClick={() => navigate("home")}>
          <b>MATERIAL PIN</b>
          <span>{isPlatformAdmin ? "Platform admin" : "Site admin"}</span>
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
                {item.name}
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
              An organization is one deployed site. Define its item groups and
              fields, then set its map and boundary.
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
              <button onClick={() => navigate(`inventory/${selected.slug}`)}>
                <span className="task-icon items">#</span>
                <span>
                  <b>Open inventory tracker</b>
                  <small>Stock levels, adjustments, and history</small>
                </span>
                <i>→</i>
              </button>
              <button onClick={() => setTab("configure")}>
                <span className="task-icon settings">⚙</span>
                <span>
                  <b>Change organization settings</b>
                  <small>Employees, lists, access, AI and map</small>
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
              {reviewItems.map((item) => {
                const reviewCollection = selected?.collections.find(
                  (collection) => collection.id === item.collection_id,
                );
                const detailFields = configuredCaptureFields(
                  reviewCollection || null,
                );
                return (
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
                      {selected && (
                        <SiteMapView
                          organization={selected}
                          mapImageUrl={editMap.imageUrl}
                          markerLatitude={item.latitude}
                          markerLongitude={item.longitude}
                          markerLabel={item.proposed.name || "Submitted item"}
                          boundary={selected?.boundary}
                          showMarker
                          compact
                        />
                      )}
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
                        <span>
                          {item.ai_suggestions?.keywords?.join(" · ")}
                        </span>
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
                            The submission is safe to review without them, or
                            you can try again.
                          </p>
                          <button onClick={() => retryAi(item)}>
                            Try again
                          </button>
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
                      {detailFields.map((field) => {
                        const value =
                          field.key === "quantity"
                            ? item.proposed.quantity
                            : field.key === "unit"
                              ? item.proposed.unit
                              : item.proposed.data?.[field.key];
                        return (
                          <div key={field.key}>
                            <dt>
                              {field.label}
                              {field.required ? " · required" : ""}
                            </dt>
                            <dd>
                              {value === "" || value == null
                                ? "Not provided"
                                : String(value)}
                            </dd>
                          </div>
                        );
                      })}
                      <div>
                        <dt>Date of capture</dt>
                        <dd>
                          {item.photo_taken_at
                            ? new Date(item.photo_taken_at).toLocaleString()
                            : "Not provided"}
                        </dd>
                      </div>
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
                );
              })}
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
              <small>INVENTORY AND MAP PINS</small>
              <h1>Choose what to manage</h1>
              <p>
                Pick an item group and category. Only those inventory records
                will open below.
              </p>
            </div>
            <section className="inventory-picker panel">
              <div className="inventory-picker-step">
                <span>1</span>
                <div>
                  <h2>Choose an item group</h2>
                  <p>Start with the broad type of inventory.</p>
                </div>
              </div>
              <div className="inventory-picker-options">
                {recordCollectionOptions.map((collection) => (
                  <button
                    type="button"
                    className={
                      recordCollection === collection.id ? "active" : ""
                    }
                    aria-pressed={recordCollection === collection.id}
                    key={collection.id}
                    onClick={() => {
                      setRecordCollection(collection.id);
                      setRecordCategory("");
                      setRecordQuery("");
                    }}
                  >
                    <span>{collection.icon || collection.name.charAt(0)}</span>
                    <b>{collection.name}</b>
                    <small>{collection.count} items</small>
                  </button>
                ))}
              </div>
              {!!recordCollection && (
                <>
                  <div className="inventory-picker-step second">
                    <span>2</span>
                    <div>
                      <h2>Choose a category</h2>
                      <p>Open only the records you need to work with.</p>
                    </div>
                  </div>
                  <div className="inventory-category-options">
                    {recordCategoryOptions.map(([category, items]) => (
                      <button
                        type="button"
                        className={recordCategory === category ? "active" : ""}
                        aria-pressed={recordCategory === category}
                        key={category}
                        onClick={() => {
                          setRecordCategory(category);
                          setRecordQuery("");
                        }}
                      >
                        <b>{category}</b>
                        <span>{items.length}</span>
                      </button>
                    ))}
                    {!recordCategoryOptions.length && (
                      <p className="inventory-picker-empty">
                        This item group has no approved inventory yet.
                      </p>
                    )}
                  </div>
                </>
              )}
            </section>
            {selected && (
              <details className="csv-import panel">
                <summary>
                  <span>
                    <b>Import inventory from CSV</b>
                    <small>
                      Create inventory records with generic map pins. Photos can
                      be added later.
                    </small>
                  </span>
                  <i>Open</i>
                </summary>
                <form onSubmit={importCsv}>
                  <div className="csv-import-grid">
                    <label>
                      CSV file
                      <input
                        name="csv"
                        type="file"
                        accept=".csv,text/csv"
                        required
                      />
                    </label>
                    <label>
                      Item group
                      <select name="collection_id" required>
                        {selected.collections.map((collection) => (
                          <option key={collection.id} value={collection.id}>
                            {collection.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Default named location
                      <input
                        name="default_location"
                        placeholder="Row A, north yard, aisle 12"
                      />
                    </label>
                    <label className="csv-public-choice">
                      <input
                        name="public_visible"
                        type="checkbox"
                        defaultChecked
                      />
                      <span>Show imported items publicly</span>
                    </label>
                  </div>
                  <div className="csv-map-picker">
                    <div>
                      <b>Pick the default pin location</b>
                      <small>
                        {selected.map_mode === "gps"
                          ? "Rows with latitude and longitude use their own coordinates. All other rows use this pin."
                          : "Rows without a map position use this pin on the site plan."}
                      </small>
                    </div>
                    <SiteMapView
                      organization={selected}
                      mapImageUrl={editMap.imageUrl}
                      markerLatitude={importPoint.latitude}
                      markerLongitude={importPoint.longitude}
                      picker
                      compact
                      onPick={(latitude, longitude) =>
                        setImportPoint({ latitude, longitude })
                      }
                    />
                    <output>
                      {importPoint.latitude.toFixed(6)},{" "}
                      {importPoint.longitude.toFixed(6)}
                    </output>
                  </div>
                  <p className="csv-columns">
                    Recognized columns: name, description, SKU, quantity, unit,
                    category, location, latitude, longitude, public, keywords,
                    manufacturer, condition and serial.
                  </p>
                  <button className="save-button">Import inventory</button>
                </form>
              </details>
            )}
            {!!recordCollection && !!recordCategory && (
              <div className="inventory-toolbar">
                <label>
                  <span>Find an item</span>
                  <input
                    type="search"
                    value={recordQuery}
                    onChange={(event) => setRecordQuery(event.target.value)}
                    placeholder="Name, SKU, category or location"
                  />
                </label>
                <output>{visibleRecords.length} active items</output>
              </div>
            )}
            <div
              className="inventory-management"
              hidden={!recordCollection || !recordCategory}
            >
              {recordGroups.map(({ collection, categories }) => (
                <section className="inventory-group" key={collection.id}>
                  <header>
                    <span>{collection.icon || collection.name.charAt(0)}</span>
                    <div>
                      <small>ITEM GROUP</small>
                      <h2>{collection.name}</h2>
                    </div>
                    <output>
                      {categories.reduce(
                        (total, [, items]) => total + items.length,
                        0,
                      )}
                    </output>
                  </header>
                  {categories.map(([category, items]) => (
                    <details className="inventory-category" key={category} open>
                      <summary>
                        <b>{category}</b>
                        <span>{items.length} items</span>
                      </summary>
                      <div className="record-admin-list">
                        {items.map((item) => (
                          <details className="record-edit-card" key={item.id}>
                            <summary>
                              <span>
                                <small>
                                  {item.category || "Uncategorized"} ·{" "}
                                  {item.public_visible
                                    ? "Public"
                                    : "Employees only"}
                                </small>
                                <b>{item.name}</b>
                                <small>
                                  {String(item.data.sku || "No SKU")} ·{" "}
                                  {String(
                                    item.data.location_code ||
                                      item.data.location ||
                                      "No named location",
                                  )}
                                </small>
                              </span>
                              <output>
                                {item.quantity !== null
                                  ? `${item.quantity} ${item.unit || ""}`
                                  : "Not counted"}
                              </output>
                              <i>Edit</i>
                            </summary>
                            <form
                              className="record-edit-form"
                              onSubmit={(event) => saveRecord(event, item)}
                            >
                              <label>
                                Item name
                                <input
                                  name="name"
                                  defaultValue={item.name}
                                  required
                                />
                              </label>
                              <label>
                                Item group
                                <select
                                  name="collection_id"
                                  defaultValue={item.collection_id}
                                >
                                  {selected?.collections.map((collection) => (
                                    <option
                                      key={collection.id}
                                      value={collection.id}
                                    >
                                      {collection.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label>
                                Category
                                <input
                                  name="category"
                                  defaultValue={item.category}
                                />
                              </label>
                              {configuredCaptureFields(collection).map(
                                (field) => (
                                  <label key={field.key}>
                                    {field.label}
                                    {field.key === "quantity" ? (
                                      <input
                                        name="quantity"
                                        type="number"
                                        step="any"
                                        min="0"
                                        defaultValue={item.quantity ?? ""}
                                        required={field.required}
                                      />
                                    ) : field.key === "unit" ? (
                                      <input
                                        name="unit"
                                        defaultValue={item.unit || ""}
                                        required={field.required}
                                      />
                                    ) : field.type === "boolean" ? (
                                      <input
                                        name={field.key}
                                        type="checkbox"
                                        defaultChecked={Boolean(
                                          item.data[field.key],
                                        )}
                                        required={field.required}
                                      />
                                    ) : (
                                      <input
                                        name={field.key}
                                        type={field.type}
                                        defaultValue={String(
                                          item.data[field.key] || "",
                                        )}
                                        required={field.required}
                                      />
                                    )}
                                  </label>
                                ),
                              )}
                              <label>
                                Latitude
                                <input
                                  name="latitude"
                                  type="number"
                                  step="any"
                                  defaultValue={item.latitude}
                                  required
                                />
                              </label>
                              <label>
                                Longitude
                                <input
                                  name="longitude"
                                  type="number"
                                  step="any"
                                  defaultValue={item.longitude}
                                  required
                                />
                              </label>
                              <label className="wide-field">
                                Description
                                <textarea
                                  name="description"
                                  rows={4}
                                  defaultValue={item.description}
                                />
                              </label>
                              <label className="visibility-choice wide-field">
                                <input
                                  name="public_visible"
                                  type="checkbox"
                                  defaultChecked={item.public_visible}
                                />
                                <span>
                                  <b>Show on the public site</b>
                                  <small>
                                    Private items remain visible to assigned
                                    employees and administrators.
                                  </small>
                                </span>
                              </label>
                              <div className="record-edit-actions wide-field">
                                <button className="save-button">
                                  Save item
                                </button>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() => archiveRecord(item)}
                                >
                                  Archive item
                                </button>
                              </div>
                            </form>
                          </details>
                        ))}
                      </div>
                    </details>
                  ))}
                </section>
              ))}
              {!visibleRecords.length && (
                <div className="admin-list-empty">
                  <span>▦</span>
                  <h2>
                    {records.length
                      ? "No matching items"
                      : "No approved items yet"}
                  </h2>
                  <p>
                    {records.length
                      ? "Try a different name, SKU, category or location."
                      : "Approve a submission to publish the first item."}
                  </p>
                </div>
              )}
            </div>
          </>
        )}
        {tab === "activity" && (
          <>
            <div className="admin-title">
              <small>WHAT PEOPLE NEED</small>
              <h1>Search activity</h1>
              <p>See the words, photos and filters people use to find items.</p>
            </div>
            <div className="search-activity-summary">
              <article>
                <small>Total searches</small>
                <b>{searches.length}</b>
              </article>
              <article>
                <small>Photo searches</small>
                <b>
                  {
                    searches.filter((item) => item.search_type === "image")
                      .length
                  }
                </b>
              </article>
              <article>
                <small>No-result searches</small>
                <b>
                  {searches.filter((item) => item.result_count === 0).length}
                </b>
              </article>
            </div>
            <div className="search-activity-list">
              {searches.map((item) => (
                <article key={item.id}>
                  <span className={`search-kind ${item.search_type}`}>
                    {item.search_type}
                  </span>
                  <div>
                    <b>{item.query}</b>
                    <small>
                      {new Date(item.created_at).toLocaleString()} ·{" "}
                      {item.result_count} results
                    </small>
                  </div>
                  {item.result_count === 0 && <strong>Needs attention</strong>}
                </article>
              ))}
              {!searches.length && (
                <div className="admin-list-empty">
                  <span>⌕</span>
                  <h2>No searches yet</h2>
                  <p>Public and employee searches will appear here.</p>
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
              Create an organization first. Its item groups, fields, public
              access, AI options and map are all set in the guided setup.
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
                <div className="schema-note">
                  <b>No database work is required.</b>
                  <span>
                    Material Pin stores these field definitions and their values
                    flexibly. New forms use the saved fields; existing items
                    stay valid until someone fills in the new information.
                  </span>
                </div>
              </div>
            </section>
            <section className="settings-section">
              <div className="settings-step">2</div>
              <div className="settings-content">
                <h2>People and permissions</h2>
                <p>
                  Site administrators manage this site. Employees receive only
                  the actions you select. Viewers are read-only.
                </p>
                <form
                  className="employee-create-form"
                  onSubmit={createEmployee}
                >
                  <label>
                    Email address
                    <input
                      name="employee_email"
                      type="email"
                      autoComplete="off"
                      placeholder="employee@company.com"
                      required
                    />
                  </label>
                  <label>
                    Temporary password
                    <input
                      name="temporary_password"
                      type="password"
                      minLength={10}
                      autoComplete="new-password"
                      placeholder="At least 10 characters"
                    />
                    <small>
                      Required only when this is a brand-new account.
                    </small>
                  </label>
                  <label>
                    Access level
                    <select
                      name="employee_role"
                      value={newMemberRole}
                      onChange={(event) =>
                        setNewMemberRole(
                          event.target.value as Exclude<MemberRole, "staff">,
                        )
                      }
                    >
                      <option value="viewer">Viewer — read only</option>
                      <option value="employee">
                        Employee — selected work tools
                      </option>
                      <option value="admin">
                        Site administrator — settings and users
                      </option>
                    </select>
                  </label>
                  <fieldset
                    className="access-permission-checks"
                    key={newMemberRole}
                  >
                    <legend>
                      {newMemberRole === "employee"
                        ? "Employee permissions"
                        : newMemberRole === "viewer"
                          ? "Viewer visibility"
                          : "Site administrator access"}
                    </legend>
                    {newMemberRole === "admin" ? (
                      <p className="role-access-summary">
                        Site administrators have full access to this site,
                        including settings, people, approvals, items, and
                        inventory.
                      </p>
                    ) : (
                      employeePermissionOptions
                        .filter(
                          (permission) =>
                            newMemberRole === "employee" ||
                            permission.key === "viewPrivate" ||
                            permission.key === "viewInventory",
                        )
                        .map((permission) => (
                          <label key={permission.key}>
                            <input
                              type="checkbox"
                              name={`permission_${permission.key}`}
                              defaultChecked={
                                newMemberRole === "employee" &&
                                employeeDefaults[permission.key]
                              }
                            />
                            <span>
                              <b>{permission.label}</b>
                              <small>{permission.help}</small>
                            </span>
                          </label>
                        ))
                    )}
                    <small>
                      {newMemberRole === "viewer"
                        ? "Viewers can be allowed to see information, but they can never add, update, approve, or adjust it."
                        : newMemberRole === "employee"
                          ? "Only the selected tools will appear for this employee."
                          : "Full access applies only to this site."}
                    </small>
                  </fieldset>
                  <button className="save-button">
                    Create or assign person
                  </button>
                </form>
                <div className="employee-list">
                  {members.map((member) => {
                    const memberPermissions = permissionsFor(member);
                    const draftRole =
                      memberRoleDrafts[member.user_id] ||
                      (member.role === "staff" ? "employee" : member.role);
                    return (
                      <details
                        className="member-access-card"
                        key={member.user_id}
                      >
                        <summary>
                          <span>
                            <b>{member.email}</b>
                            <small>
                              {member.is_owner
                                ? "Organization owner"
                                : roleLabel(member.role)}
                              {member.user_id === session?.user?.id
                                ? " · You"
                                : ""}
                            </small>
                          </span>
                          <i>
                            {member.is_owner ? "Full access" : "Edit access"}
                          </i>
                        </summary>
                        {!member.is_owner && (
                          <form
                            onSubmit={(event) =>
                              updateMemberAccess(event, member)
                            }
                          >
                            <label>
                              Access level
                              <select
                                name="member_role"
                                value={draftRole}
                                onChange={(event) =>
                                  setMemberRoleDrafts((current) => ({
                                    ...current,
                                    [member.user_id]: event.target
                                      .value as Exclude<MemberRole, "staff">,
                                  }))
                                }
                              >
                                <option value="viewer">
                                  Viewer — read only
                                </option>
                                <option value="employee">
                                  Employee — selected work tools
                                </option>
                                <option value="admin">
                                  Site administrator — settings and users
                                </option>
                              </select>
                            </label>
                            <fieldset
                              className="access-permission-checks compact"
                              key={`${member.user_id}-${draftRole}`}
                            >
                              <legend>
                                {draftRole === "employee"
                                  ? "Allowed actions"
                                  : draftRole === "viewer"
                                    ? "Allowed information"
                                    : "Full site access"}
                              </legend>
                              {draftRole === "admin" ? (
                                <p className="role-access-summary">
                                  This person can manage this site’s settings,
                                  people, approvals, items, and inventory.
                                </p>
                              ) : (
                                employeePermissionOptions
                                  .filter(
                                    (permission) =>
                                      draftRole === "employee" ||
                                      permission.key === "viewPrivate" ||
                                      permission.key === "viewInventory",
                                  )
                                  .map((permission) => (
                                    <label key={permission.key}>
                                      <input
                                        type="checkbox"
                                        name={`member_permission_${permission.key}`}
                                        defaultChecked={
                                          memberPermissions[permission.key]
                                        }
                                      />
                                      <span>
                                        <b>{permission.label}</b>
                                        <small>{permission.help}</small>
                                      </span>
                                    </label>
                                  ))
                              )}
                            </fieldset>
                            <div className="member-access-actions">
                              <button className="save-button">
                                Save access
                              </button>
                              {member.user_id !== session?.user?.id && (
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() => removeMember(member)}
                                >
                                  Remove from site
                                </button>
                              )}
                            </div>
                          </form>
                        )}
                      </details>
                    );
                  })}
                  {membersLoading && <p>Loading employee accounts…</p>}
                  {!membersLoading && !members.length && (
                    <p>No people are assigned yet.</p>
                  )}
                </div>
                <p className="employee-password-note">
                  Give a new person their temporary password privately. They can
                  change it after signing in.
                </p>
              </div>
            </section>
            <section className="settings-section">
              <div className="settings-step">3</div>
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
                <label className="catalog-guide-field panel">
                  <span>
                    <b>AI instructions for this organization</b>
                    <small>
                      Tell photo analysis which terms, labels and visible
                      details matter. These instructions refine results but do
                      not override what is actually in the photo.
                    </small>
                  </span>
                  <textarea
                    value={editAiContext}
                    onChange={(event) => setEditAiContext(event.target.value)}
                    rows={7}
                    maxLength={4000}
                    placeholder="Example: Steel service center. Use plate, sheet, angle, channel, beam, tube, offcut, alloy, thickness and heat number. Never guess a grade or measurement that is not visible."
                  />
                  <div className="ai-instruction-shortcuts">
                    {[
                      "Use our preferred item names when they match the visible object.",
                      "Read visible labels, part numbers and asset tags carefully.",
                      "Describe visible material and condition, but do not guess.",
                      "Leave IDs, dimensions and specifications blank unless clearly visible.",
                    ].map((instruction) => (
                      <button
                        type="button"
                        key={instruction}
                        onClick={() =>
                          setEditAiContext((current) =>
                            [current.trim(), instruction]
                              .filter(Boolean)
                              .join("\n"),
                          )
                        }
                      >
                        + {instruction}
                      </button>
                    ))}
                  </div>
                  <small>{editAiContext.length}/4000 characters</small>
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
              <div className="settings-step">4</div>
              <div className="settings-content">
                <OrganizationMapEditor
                  value={editMap}
                  onChange={setEditMap}
                  onImageSelected={(file) => {
                    setEditMapFile(file);
                    setEditMap((current) => ({
                      ...current,
                      mode: "image",
                      imageUrl: URL.createObjectURL(file),
                    }));
                  }}
                />
              </div>
            </section>
            {(isPlatformAdmin || selected.created_by === session?.user?.id) && (
              <section className="organization-danger-zone">
                <div>
                  <small>PERMANENT ACTION</small>
                  <h2>Delete this organization</h2>
                  <p>
                    Deletes its items, submissions, employee assignments, photos
                    and history. Other organizations and login accounts are not
                    deleted.
                  </p>
                </div>
                <button type="button" onClick={deleteOrganization}>
                  Delete {selected.name}
                </button>
              </section>
            )}
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
                <div className="access-warning">
                  Material Pin manages inventory, reusable materials, equipment
                  and mapped site locations. You can rename every item group.
                </div>
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
                <label className="access-setting panel">
                  <input name="ai_enabled" type="checkbox" defaultChecked />
                  <span>
                    <b>Enable photo descriptions and photo search</b>
                    <small>
                      The OpenAI API is called only when someone uses a photo
                      feature.
                    </small>
                  </span>
                </label>
                <label className="catalog-guide-field panel">
                  <span>
                    <b>AI catalog guide</b>
                    <small>
                      Give the AI the real vocabulary used by this organization.
                    </small>
                  </span>
                  <textarea
                    name="ai_catalog_context"
                    rows={7}
                    maxLength={4000}
                    placeholder="Example: Vehicle salvage yard. Identify vehicle type, make/model clues, body panels, engines, wheels, major components and visible condition. Use stock numbers when readable. Do not guess VIN digits."
                  />
                </label>
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
                  canUploadImage={false}
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
