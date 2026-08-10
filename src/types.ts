// Legacy values remain readable while existing deployments migrate to the
// single Material Pin model.
export type OrganizationMode = "material" | "civic" | "commercial";
export type LocationSource = "photo_exif" | "browser_gps" | "manual_pin";
export type FieldType = "text" | "number" | "date" | "boolean";

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
    quantity?: string;
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
