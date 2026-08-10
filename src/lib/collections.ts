import type { CollectionDefinition } from "../types";

export const civicDefaults: CollectionDefinition[] = [
  { id: "places", name: "Places & facilities", icon: "P", kind: "place", publicVisible: true, publicSubmit: true, fields: [] },
  { id: "infrastructure", name: "Infrastructure", icon: "I", kind: "persistent", publicVisible: true, publicSubmit: true, fields: [] },
  { id: "issues", name: "Issues & observations", icon: "!", kind: "persistent", publicVisible: true, publicSubmit: true, fields: [] },
];
export const commercialDefaults: CollectionDefinition[] = [
  { id: "new-inventory", name: "New inventory", icon: "N", kind: "consumable", publicVisible: false, publicSubmit: false, fields: [] },
  { id: "used-scrap", name: "Used & scrap", icon: "S", kind: "consumable", publicVisible: false, publicSubmit: false, fields: [] },
  { id: "equipment", name: "Equipment", icon: "E", kind: "persistent", publicVisible: false, publicSubmit: false, fields: [] },
  { id: "site-locations", name: "Site & building locations", icon: "L", kind: "place", publicVisible: false, publicSubmit: false, fields: [] },
];
