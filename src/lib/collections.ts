import type { CollectionDefinition, FieldDefinition } from "../types";

const labels: Record<string, string> = {
  sku: "SKU / asset ID",
  quantity: "Quantity",
  unit: "Unit",
  location_code: "Storage location / bin",
  condition: "Condition",
  manufacturer: "Manufacturer / brand",
};

const inventoryFields: FieldDefinition[] = Object.keys(labels).map((key) => ({
  key,
  label: labels[key],
  type: key === "quantity" ? "number" : "text",
  required: false,
  publicVisible: key !== "sku",
  publicSubmit: false,
  searchable: true,
}));

const assetFields = inventoryFields.filter(
  (field) => field.key !== "quantity" && field.key !== "unit",
);

function fields(source: FieldDefinition[]) {
  return source.map((field) => ({ ...field }));
}

export const materialDefaults: CollectionDefinition[] = [
  {
    id: "inventory",
    name: "Inventory",
    icon: "I",
    kind: "consumable",
    publicVisible: true,
    publicSubmit: false,
    fields: fields(inventoryFields),
  },
  {
    id: "used-material",
    name: "Used material & offcuts",
    icon: "U",
    kind: "consumable",
    publicVisible: true,
    publicSubmit: false,
    fields: fields(inventoryFields),
  },
  {
    id: "equipment",
    name: "Equipment & assets",
    icon: "E",
    kind: "persistent",
    publicVisible: true,
    publicSubmit: false,
    fields: fields(assetFields),
  },
  {
    id: "site-locations",
    name: "Site & building locations",
    icon: "L",
    kind: "place",
    publicVisible: true,
    publicSubmit: false,
    fields: [],
  },
];

// Compatibility aliases for older saved organization configurations.
export const civicDefaults = materialDefaults;
export const commercialDefaults = materialDefaults;
