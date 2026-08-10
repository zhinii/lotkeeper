import type { CollectionDefinition } from "../types";

export const materialDefaults: CollectionDefinition[] = [
  { id: "inventory", name: "Inventory", icon: "I", kind: "consumable", publicVisible: true, publicSubmit: false, fields: [] },
  { id: "used-material", name: "Used material & offcuts", icon: "U", kind: "consumable", publicVisible: true, publicSubmit: false, fields: [] },
  { id: "equipment", name: "Equipment & assets", icon: "E", kind: "persistent", publicVisible: true, publicSubmit: false, fields: [] },
  { id: "site-locations", name: "Site & building locations", icon: "L", kind: "place", publicVisible: true, publicSubmit: false, fields: [] },
];

// Compatibility aliases for older saved organization configurations.
export const civicDefaults = materialDefaults;
export const commercialDefaults = materialDefaults;
