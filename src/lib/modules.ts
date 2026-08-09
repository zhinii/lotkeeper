import type { Instance, ModuleDefinition, ModuleField } from "../types";

export const fieldCatalog: ModuleField[] = [
  {
    key: "updated_by",
    label: "Who updated it",
    type: "text",
    public_visible: false,
    public_submit: false,
    required: false,
  },
  {
    key: "sku",
    label: "SKU",
    type: "text",
    public_visible: true,
    public_submit: true,
    required: false,
  },
  {
    key: "identifier",
    label: "Identifier",
    type: "text",
    public_visible: true,
    public_submit: true,
    required: false,
  },
  {
    key: "quantity",
    label: "Count / quantity",
    type: "number",
    public_visible: true,
    public_submit: true,
    required: false,
  },
  {
    key: "unit",
    label: "Unit",
    type: "text",
    public_visible: true,
    public_submit: true,
    required: false,
  },
  {
    key: "condition",
    label: "Condition",
    type: "text",
    public_visible: true,
    public_submit: true,
    required: false,
  },
  {
    key: "date",
    label: "Date",
    type: "date",
    public_visible: true,
    public_submit: true,
    required: false,
  },
  {
    key: "notes",
    label: "Notes",
    type: "text",
    public_visible: true,
    public_submit: true,
    required: false,
  },
];

const legacyNames: Record<string, string> = {
  places: "Places",
  assets: "Assets",
  stock: "Stock",
  loose_material: "Loose material",
};

export function definitions(instance: Instance): ModuleDefinition[] {
  if (instance.module_definitions?.length) return instance.module_definitions;
  return (instance.modules || []).map((id) => ({
    id,
    name: instance.terminology?.[id] || legacyNames[id] || id,
    public_visible: true,
    public_submit: true,
    fields: [],
  }));
}

export function moduleName(instance: Instance, id: string) {
  return definitions(instance).find((module) => module.id === id)?.name || id;
}
