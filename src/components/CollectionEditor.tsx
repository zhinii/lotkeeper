import { useState } from "react";
import type {
  CollectionDefinition,
  FieldDefinition,
  FieldType,
} from "../types";

const fieldPresets: Omit<
  FieldDefinition,
  "required" | "publicVisible" | "publicSubmit" | "searchable"
>[] = [
  { key: "sku", label: "SKU", type: "text" },
  { key: "identifier", label: "Identifier", type: "text" },
  { key: "condition", label: "Condition", type: "text" },
  { key: "dimensions", label: "Dimensions", type: "text" },
  { key: "material", label: "Material", type: "text" },
  { key: "department", label: "Department", type: "text" },
  { key: "verified_date", label: "Last verified", type: "date" },
];

const kindLabels: Record<CollectionDefinition["kind"], string> = {
  place: "Place or location",
  persistent: "Reusable item",
  consumable: "Counted inventory",
};

export default function CollectionEditor({
  value,
  onChange,
}: {
  value: CollectionDefinition[];
  onChange: (next: CollectionDefinition[]) => void;
}) {
  const [draftLabels, setDraftLabels] = useState<Record<string, string>>({});
  const [draftTypes, setDraftTypes] = useState<Record<string, FieldType>>({});
  const update = (index: number, patch: Partial<CollectionDefinition>) =>
    onChange(
      value.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    );
  const toggleField = (
    index: number,
    preset: (typeof fieldPresets)[number],
    enabled: boolean,
  ) =>
    update(index, {
      fields: enabled
        ? [
            ...value[index].fields,
            {
              ...preset,
              required: false,
              publicVisible: true,
              publicSubmit: true,
              searchable: true,
            },
          ]
        : value[index].fields.filter((field) => field.key !== preset.key),
    });
  function addCustomField(index: number, collection: CollectionDefinition) {
    const label = (draftLabels[collection.id] || "").trim();
    if (!label) return;
    let key = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!key) key = `field_${collection.fields.length + 1}`;
    if (collection.fields.some((field) => field.key === key))
      key = `${key}_${collection.fields.length + 1}`;
    update(index, {
      fields: [
        ...collection.fields,
        {
          key,
          label,
          type: draftTypes[collection.id] || "text",
          required: false,
          publicVisible: false,
          publicSubmit: false,
          searchable: true,
        },
      ],
    });
    setDraftLabels((current) => ({ ...current, [collection.id]: "" }));
  }
  return (
    <div className="collection-editor">
      {value.map((collection, index) => (
        <details className="collection-builder-card" key={collection.id}>
          <summary>
            <span className="collection-summary-icon">
              {collection.icon || collection.name.charAt(0)}
            </span>
            <span>
              <b>{collection.name}</b>
              <small>
                {kindLabels[collection.kind]} · {collection.fields.length}{" "}
                {collection.fields.length === 1 ? "field" : "fields"}
              </small>
            </span>
            <i>Open to edit</i>
          </summary>
          <div className="collection-builder-body">
            <div className="collection-head">
              <label>
                List name
                <input
                  aria-label="Collection name"
                  value={collection.name}
                  onChange={(event) =>
                    update(index, { name: event.target.value })
                  }
                />
              </label>
              <label>
                What does it contain?
                <select
                  value={collection.kind}
                  onChange={(event) =>
                    update(index, {
                      kind: event.target.value as CollectionDefinition["kind"],
                    })
                  }
                >
                  <option value="place">Places or locations</option>
                  <option value="persistent">Reusable items</option>
                  <option value="consumable">Inventory with a quantity</option>
                </select>
              </label>
            </div>
            <div className="rule-row">
              <label>
                <input
                  type="checkbox"
                  checked={collection.publicVisible}
                  onChange={(event) =>
                    update(index, { publicVisible: event.target.checked })
                  }
                />
                Show this list on the public site
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={collection.publicSubmit}
                  onChange={(event) =>
                    update(index, { publicSubmit: event.target.checked })
                  }
                />
                Let visitors suggest new entries
              </label>
            </div>
            <h4>What information should each entry include?</h4>
            <p className="field-help">
              Select common information, or add a field with your own name.
            </p>
            <div className="preset-fields">
              {fieldPresets.map((preset) => (
                <label key={preset.key}>
                  <input
                    type="checkbox"
                    checked={collection.fields.some(
                      (field) => field.key === preset.key,
                    )}
                    onChange={(event) =>
                      toggleField(index, preset, event.target.checked)
                    }
                  />
                  {preset.label}
                </label>
              ))}
            </div>
            <div className="custom-field-row">
              <input
                aria-label="New field name"
                placeholder="Add your own field"
                value={draftLabels[collection.id] || ""}
                onChange={(event) =>
                  setDraftLabels((current) => ({
                    ...current,
                    [collection.id]: event.target.value,
                  }))
                }
              />
              <select
                aria-label="New field type"
                value={draftTypes[collection.id] || "text"}
                onChange={(event) =>
                  setDraftTypes((current) => ({
                    ...current,
                    [collection.id]: event.target.value as FieldType,
                  }))
                }
              >
                <option value="text">Words</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="boolean">Yes or no</option>
              </select>
              <button
                type="button"
                onClick={() => addCustomField(index, collection)}
              >
                Add
              </button>
            </div>
            {!!collection.fields.length && (
              <div className="selected-fields">
                <h4>Selected information</h4>
                {collection.fields.map((field) => (
                  <div className="field-rules" key={field.key}>
                    <b>{field.label}</b>
                    <label>
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(event) =>
                          update(index, {
                            fields: collection.fields.map((item) =>
                              item.key === field.key
                                ? { ...item, required: event.target.checked }
                                : item,
                            ),
                          })
                        }
                      />
                      Must be filled in
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={field.publicVisible}
                        onChange={(event) =>
                          update(index, {
                            fields: collection.fields.map((item) =>
                              item.key === field.key
                                ? {
                                    ...item,
                                    publicVisible: event.target.checked,
                                  }
                                : item,
                            ),
                          })
                        }
                      />
                      Visitors can see it
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={field.publicSubmit}
                        onChange={(event) =>
                          update(index, {
                            fields: collection.fields.map((item) =>
                              item.key === field.key
                                ? {
                                    ...item,
                                    publicSubmit: event.target.checked,
                                  }
                                : item,
                            ),
                          })
                        }
                      />
                      Visitors can fill it in
                    </label>
                    <button
                      type="button"
                      className="field-remove"
                      onClick={() =>
                        update(index, {
                          fields: collection.fields.filter(
                            (item) => item.key !== field.key,
                          ),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="remove-collection"
              onClick={() =>
                onChange(value.filter((_, position) => position !== index))
              }
            >
              Remove this list
            </button>
          </div>
        </details>
      ))}
      <button
        type="button"
        className="add-collection"
        onClick={() =>
          onChange([
            ...value,
            {
              id: `collection-${crypto.randomUUID().slice(0, 8)}`,
              name: "New collection",
              icon: "N",
              kind: "persistent",
              publicVisible: false,
              publicSubmit: false,
              fields: [],
            },
          ])
        }
      >
        + Add another list
      </button>
    </div>
  );
}
