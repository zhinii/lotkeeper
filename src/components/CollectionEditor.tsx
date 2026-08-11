import { useState } from "react";
import {
  configuredCaptureFields,
  fieldDefinition,
  inventoryCaptureFields,
} from "../lib/captureFields";
import type {
  CollectionDefinition,
  FieldDefinition,
  FieldType,
} from "../types";

const extraPresets: Array<
  Omit<
    FieldDefinition,
    "required" | "publicVisible" | "publicSubmit" | "searchable"
  >
> = [
  { key: "dimensions", label: "Dimensions", type: "text" },
  { key: "material", label: "Material", type: "text" },
  { key: "department", label: "Department", type: "text" },
];

const presets = [
  ...inventoryCaptureFields.map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type as FieldType,
  })),
  ...extraPresets,
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

  function togglePreset(
    index: number,
    collection: CollectionDefinition,
    preset: (typeof presets)[number],
    enabled: boolean,
  ) {
    const inventoryPreset = inventoryCaptureFields.find(
      (field) => field.key === preset.key,
    );
    update(index, {
      fields: enabled
        ? [
            ...collection.fields,
            inventoryPreset
              ? fieldDefinition(inventoryPreset)
              : {
                  ...preset,
                  required: false,
                  publicVisible: true,
                  publicSubmit: false,
                  searchable: true,
                },
          ]
        : collection.fields.filter((field) => field.key !== preset.key),
    });
  }

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

  function updateField(
    index: number,
    collection: CollectionDefinition,
    key: string,
    patch: Partial<FieldDefinition>,
  ) {
    update(index, {
      fields: collection.fields.map((field) =>
        field.key === key ? { ...field, ...patch } : field,
      ),
    });
  }

  return (
    <div className="collection-editor">
      {value.map((collection, index) => {
        const selectedFields = configuredCaptureFields(collection);
        return (
          <details className="collection-builder-card" key={collection.id}>
            <summary>
              <span className="collection-summary-icon">
                {collection.icon || collection.name.charAt(0)}
              </span>
              <span>
                <b>{collection.name}</b>
                <small>
                  {kindLabels[collection.kind]} · {selectedFields.length}{" "}
                  {selectedFields.length === 1 ? "detail" : "details"}
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
                        kind: event.target
                          .value as CollectionDefinition["kind"],
                      })
                    }
                  >
                    <option value="place">Places or locations</option>
                    <option value="persistent">Reusable items</option>
                    <option value="consumable">
                      Inventory with a quantity
                    </option>
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
              </div>

              <section className="unified-item-details">
                <div>
                  <h4>Item details</h4>
                  <p className="field-help">
                    Choose the information this organization uses. Employees,
                    managers and AI will all work from this same list.
                  </p>
                </div>
                <div className="preset-fields">
                  {presets.map((preset) => (
                    <label key={preset.key}>
                      <input
                        type="checkbox"
                        checked={selectedFields.some(
                          (field) => field.key === preset.key,
                        )}
                        onChange={(event) =>
                          togglePreset(
                            index,
                            collection,
                            preset,
                            event.target.checked,
                          )
                        }
                      />
                      {preset.label}
                    </label>
                  ))}
                </div>
                <div className="custom-field-row">
                  <input
                    aria-label="New field name"
                    placeholder="Add your own detail"
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

                {!!selectedFields.length && (
                  <div className="selected-fields">
                    {selectedFields.map((field) => (
                      <div
                        className="field-rules unified-field-row"
                        key={field.key}
                      >
                        <input
                          aria-label={`${field.label} label`}
                          className="field-label-input"
                          value={field.label}
                          onChange={(event) =>
                            updateField(index, collection, field.key, {
                              label: event.target.value,
                            })
                          }
                        />
                        <label>
                          <input
                            type="checkbox"
                            checked={field.required}
                            onChange={(event) =>
                              updateField(index, collection, field.key, {
                                required: event.target.checked,
                              })
                            }
                          />
                          Required
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={field.publicVisible}
                            onChange={(event) =>
                              updateField(index, collection, field.key, {
                                publicVisible: event.target.checked,
                              })
                            }
                          />
                          Visible publicly
                        </label>
                        <button
                          type="button"
                          className="danger-link"
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
              </section>
              <button
                type="button"
                className="danger remove-list-button"
                onClick={() =>
                  onChange(value.filter((_, position) => position !== index))
                }
              >
                Remove this list
              </button>
            </div>
          </details>
        );
      })}
    </div>
  );
}
