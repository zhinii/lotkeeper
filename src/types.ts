export type ModuleKey = string;
export type FieldType = "text" | "number" | "date" | "boolean";
export type ModuleField = {
  key: string;
  label: string;
  type: FieldType;
  public_visible: boolean;
  public_submit: boolean;
  required: boolean;
};
export type ModuleDefinition = {
  id: string;
  name: string;
  public_visible: boolean;
  public_submit: boolean;
  fields: ModuleField[];
};

export type Instance = {
  id: string;
  name: string;
  slug: string;
  site_name: string;
  access_mode: "public" | "private";
  modules: ModuleKey[];
  terminology: Record<string, string>;
  module_definitions: ModuleDefinition[];
  latitude: number;
  longitude: number;
  map_zoom: number;
  boundary: [number, number][];
  created_by: string;
  created_at: string;
};

export type RecordItem = {
  id: string;
  instance_id: string;
  record_type: ModuleKey;
  name: string;
  code: string | null;
  category: string;
  description: string | null;
  status: string;
  quantity: number | null;
  unit: string | null;
  location_label: string | null;
  latitude: number;
  longitude: number;
  photo_path: string | null;
  public_visible: boolean;
  data: Record<string, unknown>;
  updated_by_email: string | null;
  updated_at: string;
};

export type Submission = {
  id: string;
  instance_id: string;
  submission_type: "new_record" | "stock_change";
  record_type: ModuleKey;
  item_name: string;
  category: string;
  description: string | null;
  quantity: number | null;
  quantity_unit: string | null;
  latitude: number;
  longitude: number;
  gps_accuracy: number | null;
  contact_name: string | null;
  contact_method: string | null;
  contact_value: string | null;
  data: Record<string, unknown>;
  photo_path: string;
  status: "pending" | "approved" | "rejected";
  submitted_at: string;
  photo_taken_at: string | null;
  location_source: "photo_exif" | "browser_gps" | "manual_pin";
};

export type Session = {
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string };
};
