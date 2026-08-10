import type { CollectionDefinition, FieldDefinition } from "../types";

export const inventoryCaptureFields = [
  {
    key: "sku",
    label: "SKU / asset ID",
    placeholder: "Item number or asset ID",
    type: "text",
    publicVisible: true,
  },
  {
    key: "quantity",
    label: "Quantity",
    placeholder: "Count or amount",
    type: "number",
    publicVisible: true,
  },
  {
    key: "unit",
    label: "Unit",
    placeholder: "Pieces, feet, cases",
    type: "text",
    publicVisible: true,
  },
  {
    key: "location_code",
    label: "Storage location / bin",
    placeholder: "Yard A, aisle 4, bin 12",
    type: "text",
    publicVisible: true,
  },
  {
    key: "condition",
    label: "Condition",
    placeholder: "New, used, damaged, scrap",
    type: "text",
    publicVisible: true,
  },
  {
    key: "manufacturer",
    label: "Manufacturer / brand",
    placeholder: "Brand visible on the item",
    type: "text",
    publicVisible: true,
  },
  {
    key: "lot_serial",
    label: "Lot / serial number",
    placeholder: "Traceable number when available",
    type: "text",
    publicVisible: false,
  },
] as const;

export type InventoryCaptureKey =
  (typeof inventoryCaptureFields)[number]["key"];
export type InventoryDataKey = Exclude<
  InventoryCaptureKey,
  "quantity" | "unit"
>;

export const inventoryCaptureKeys = new Set<string>(
  inventoryCaptureFields.map((field) => field.key),
);

export const inventoryDataCaptureFields = inventoryCaptureFields.filter(
  (field) => field.key !== "quantity" && field.key !== "unit",
);

const legacyDuplicateKeys = new Set(["identifier", "verified_date"]);

function fieldDefinition(
  field: (typeof inventoryCaptureFields)[number],
  existing?: FieldDefinition,
): FieldDefinition {
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    required: existing?.required ?? false,
    publicVisible: existing?.publicVisible ?? field.publicVisible,
    publicSubmit: false,
    searchable: existing?.searchable ?? true,
  };
}

export function inventoryFieldsForCollection(collection: CollectionDefinition) {
  return collection.kind === "place" ? [] : inventoryCaptureFields;
}

export function inventoryFieldRequired(
  collection: CollectionDefinition | null,
  key: InventoryCaptureKey,
) {
  return Boolean(
    collection?.fields?.find((field) => field.key === key)?.required,
  );
}

export function customCollectionFields(
  collection: CollectionDefinition | null,
) {
  return (collection?.fields || []).filter(
    (field) =>
      !inventoryCaptureKeys.has(field.key) &&
      !legacyDuplicateKeys.has(field.key),
  );
}

export function normalizeCollection(
  collection: CollectionDefinition,
): CollectionDefinition {
  const kind = collection.kind || "persistent";
  const rawFields = Array.isArray(collection.fields) ? collection.fields : [];
  const existing = new Map(
    rawFields
      .filter((field) => !legacyDuplicateKeys.has(field.key))
      .map((field) => [field.key, field]),
  );
  const inventoryFields =
    kind === "place"
      ? []
      : inventoryCaptureFields.map((field) =>
          fieldDefinition(field, existing.get(field.key)),
        );
  return {
    ...collection,
    kind,
    fields: [
      ...inventoryFields,
      ...rawFields.filter(
        (field) =>
          !inventoryCaptureKeys.has(field.key) &&
          !legacyDuplicateKeys.has(field.key),
      ),
    ].map((field) => ({ ...field })),
  };
}

export function normalizeCollections(collections: CollectionDefinition[]) {
  return collections.map(normalizeCollection);
}

export function captureFieldLabel(key: string) {
  return (
    inventoryCaptureFields.find((field) => field.key === key)?.label ||
    key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

export function emptyInventoryCaptureData(): Record<InventoryDataKey, string> {
  return Object.fromEntries(
    inventoryDataCaptureFields.map((field) => [field.key, ""]),
  ) as Record<InventoryDataKey, string>;
}

// Compatibility aliases for older imports while saved organizations are
// normalized through the manager.
export const commercialCaptureFields = inventoryDataCaptureFields;
export const commercialCaptureKeys = new Set<string>(
  inventoryDataCaptureFields.map((field) => field.key),
);
export type CommercialCaptureKey = InventoryDataKey;
export const emptyCommercialCaptureData = emptyInventoryCaptureData;
