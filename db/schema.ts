import { integer, real, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

export const locations = sqliteTable("locations", { id: integer("id").primaryKey({ autoIncrement: true }), name: text("name").notNull(), code: text("code").notNull(), description: text("description"), mapX: integer("map_x").notNull().default(50), mapY: integer("map_y").notNull().default(50) }, (table) => [uniqueIndex("idx_locations_code").on(table.code)]);
export const inventoryItems = sqliteTable("inventory_items", { id: integer("id").primaryKey({ autoIncrement: true }), sku: text("sku").notNull(), name: text("name").notNull(), category: text("category").notNull(), description: text("description"), status: text("status").notNull().default("available"), priceLabel: text("price_label"), locationId: integer("location_id").references(() => locations.id), publicVisible: integer("public_visible", { mode: "boolean" }).notNull().default(true), createdBy: text("created_by"), createdAt: integer("created_at", { mode: "timestamp" }).notNull(), updatedAt: integer("updated_at", { mode: "timestamp" }).notNull() }, (table) => [uniqueIndex("idx_inventory_items_sku").on(table.sku), index("idx_inventory_items_public_category").on(table.publicVisible, table.category)]);
export const staffProfiles = sqliteTable("staff_profiles", { userId: text("user_id").primaryKey(), email: text("email").notNull(), displayName: text("display_name").notNull(), role: text("role").notNull().default("staff"), createdAt: integer("created_at", { mode: "timestamp" }).notNull() }, (table) => [uniqueIndex("idx_staff_profiles_email").on(table.email)]);

export const publicRecords = sqliteTable("public_records", {
  id: text("id").primaryKey(),
  recordType: text("record_type").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  photoKey: text("photo_key"),
  sourceSubmissionId: text("source_submission_id"),
  status: text("status").notNull().default("active"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => [index("idx_public_records_type_status").on(table.recordType, table.status)]);

export const contributions = sqliteTable("contributions", {
  id: text("id").primaryKey(),
  submissionType: text("submission_type").notNull(),
  recordType: text("record_type").notNull(),
  itemName: text("item_name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  quantity: real("quantity"),
  quantityUnit: text("quantity_unit"),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  gpsLatitude: real("gps_latitude").notNull(),
  gpsLongitude: real("gps_longitude").notNull(),
  gpsAccuracy: real("gps_accuracy"),
  contactName: text("contact_name").notNull(),
  contactMethod: text("contact_method").notNull(),
  contactValue: text("contact_value").notNull(),
  photoKey: text("photo_key").notNull(),
  photoContentType: text("photo_content_type").notNull(),
  status: text("status").notNull().default("pending"),
  submittedAt: integer("submitted_at", { mode: "timestamp" }).notNull(),
  moderatedAt: integer("moderated_at", { mode: "timestamp" }),
  moderatedBy: text("moderated_by"),
  moderationNote: text("moderation_note"),
}, (table) => [
  index("idx_contributions_status_submitted").on(table.status, table.submittedAt),
  index("idx_contributions_type_status").on(table.submissionType, table.status),
]);
