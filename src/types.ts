// Legacy values remain readable while existing deployments migrate to the
// single Material Pin model.
export type OrganizationMode = "material" | "civic" | "commercial";
export type LocationSource = "photo_exif" | "browser_gps" | "manual_pin";
export type FieldType = "text" | "number" | "date" | "boolean";
export type MapMode = "gps" | "image" | "grid";
export type MemberRole = "admin" | "employee" | "viewer" | "staff";

export type MemberPermissions = {
  viewPrivate: boolean;
  viewInventory: boolean;
  addItems: boolean;
  updateItems: boolean;
  adjustInventory: boolean;
  moveItems: boolean;
  usePos: boolean;
  viewSales: boolean;
};

export type OrganizationFeatures = {
  mapping: boolean;
  inventory: boolean;
  pos: boolean;
};

export type PosConfiguration = {
  currency: string;
  taxRate: number;
};

export type OrganizationMembership = {
  organization_id: string;
  user_id?: string;
  role: MemberRole;
  permissions: Partial<MemberPermissions> | null;
};

export type FieldDefinition = {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  publicVisible: boolean;
  publicSubmit: boolean;
  searchable: boolean;
};

export type CollectionDefinition = {
  id: string;
  name: string;
  icon: string;
  kind: "place" | "persistent" | "consumable";
  publicVisible: boolean;
  publicSubmit: boolean;
  fields: FieldDefinition[];
};

export type Organization = {
  id: string;
  slug: string;
  name: string;
  mode: OrganizationMode;
  public_access: boolean;
  center_lat: number;
  center_lng: number;
  map_zoom: number;
  boundary: [number, number][];
  map_mode: MapMode;
  map_image_path: string | null;
  map_config: {
    gridRows?: number;
    gridColumns?: number;
    label?: string;
  };
  features?: Partial<OrganizationFeatures>;
  pos_config?: Partial<PosConfiguration>;
  collections: CollectionDefinition[];
  ai_enabled: boolean;
  ai_catalog_context: string;
  created_by: string;
  created_at: string;
};

export type RecordItem = {
  id: string;
  organization_id: string;
  collection_id: string;
  name: string;
  description: string;
  keywords: string[];
  category: string;
  data: Record<string, unknown>;
  quantity: number | null;
  unit: string | null;
  latitude: number;
  longitude: number;
  location_source: LocationSource;
  photo_path: string;
  photo_taken_at: string | null;
  status: "active" | "archived" | "removed";
  availability_status?: "available" | "out_of_stock" | "sold" | "unavailable";
  public_visible: boolean;
  version: number;
  updated_at: string;
  updated_by: string | null;
};

export type Submission = {
  id: string;
  organization_id: string;
  submission_type: "new" | "update";
  target_record_id: string | null;
  collection_id: string;
  proposed: Partial<RecordItem> & {
    name: string;
    description: string;
    data: Record<string, unknown>;
  };
  photo_path: string | null;
  latitude: number;
  longitude: number;
  location_source: LocationSource;
  gps_accuracy: number | null;
  photo_taken_at: string | null;
  submitted_at: string;
  submitted_by: string | null;
  status: "pending" | "approved" | "rejected";
  ai_status: "not_requested" | "queued" | "processing" | "complete" | "failed";
  ai_suggestions: {
    name?: string;
    collection_id?: string;
    catalog_match?: boolean;
    quantity?: string;
    unit?: string;
    description?: string;
    category?: string;
    keywords?: string[];
    search_terms?: string[];
    fields?: { key: string; value: string }[];
    warnings?: string[];
    error?: string;
    description_applied?: boolean;
  };
};

export type AlertItem = {
  id: string;
  organization_id: string;
  alert_type: string;
  title: string;
  detail: string;
  record_id: string | null;
  status: "open" | "resolved";
  created_at: string;
};

export type SearchEvent = {
  id: string;
  organization_id: string;
  user_id: string | null;
  query: string;
  search_type: "text" | "image" | "filter";
  filters: Record<string, unknown>;
  result_count: number;
  opened_record_id: string | null;
  created_at: string;
};

export type InventoryTransaction = {
  id: string;
  organization_id: string;
  record_id: string;
  user_id: string;
  actor_name: string;
  event_type: "used" | "removed" | "added" | "counted" | "moved" | "sold";
  quantity: number;
  before_quantity: number | null;
  after_quantity: number | null;
  note: string | null;
  counterparty: string | null;
  reference_code: string | null;
  created_at: string;
};

export type SaleRecord = {
  id: string;
  organization_id: string;
  sale_number: string;
  customer_name: string;
  customer_contact: string | null;
  reference_code: string | null;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  payment_method: string;
  note: string | null;
  status: "completed" | "voided";
  created_by: string;
  actor_name: string;
  created_at: string;
};

export type SaleLineItem = {
  id: string;
  sale_id: string;
  organization_id: string;
  record_id: string | null;
  item_name: string;
  sku: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  line_total: number;
};

export type RecordMovement = {
  id: string;
  organization_id: string;
  record_id: string;
  moved_by: string;
  actor_name: string;
  from_latitude: number;
  from_longitude: number;
  to_latitude: number;
  to_longitude: number;
  from_location: string | null;
  to_location: string | null;
  note: string | null;
  moved_at: string;
};
