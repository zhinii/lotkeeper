import type { ModuleDefinition } from "../types";
import { fieldCatalog } from "../lib/modules";

export default function ModuleBuilder({
  value,
  onChange,
}: {
  value: ModuleDefinition[];
  onChange: (next: ModuleDefinition[]) => void;
}) {
  function update(index: number, patch: Partial<ModuleDefinition>) {
    onChange(
      value.map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    );
  }
  function add() {
    onChange([
      ...value,
      {
        id: `module-${crypto.randomUUID().slice(0, 8)}`,
        name: "",
        public_visible: true,
        public_submit: true,
        fields: [],
      },
    ]);
  }
  function addCustomField(index: number) {
    const field = {
      key: `custom-${crypto.randomUUID().slice(0, 8)}`,
      label: "Custom field",
      type: "text" as const,
      public_visible: true,
      public_submit: true,
      required: false,
    };
    update(index, { fields: [...value[index].fields, field] });
  }
  return (
    <div className="module-builder">
      {value.map((module, index) => (
        <section key={module.id} className="module-card">
          <div className="module-card-head">
            <label>
              Module name
              <input
                value={module.name}
                placeholder="Example: Inventory"
                onChange={(event) =>
                  update(index, { name: event.target.value })
                }
              />
            </label>
            <button
              type="button"
              onClick={() =>
                onChange(value.filter((_, position) => position !== index))
              }
            >
              Remove
            </button>
          </div>
          <div className="visibility-row">
            <label>
              <input
                type="checkbox"
                checked={module.public_visible}
                onChange={(event) =>
                  update(index, { public_visible: event.target.checked })
                }
              />{" "}
              Visible publicly
            </label>
            <label>
              <input
                type="checkbox"
                checked={module.public_submit}
                onChange={(event) =>
                  update(index, { public_submit: event.target.checked })
                }
              />{" "}
              Public can submit
            </label>
          </div>
          <h4>Fields used in this module</h4>
          <div className="field-catalog">
            {fieldCatalog.map((template) => {
              const field = module.fields.find(
                (item) => item.key === template.key,
              );
              return (
                <div key={template.key} className={field ? "selected" : ""}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!field}
                      onChange={(event) =>
                        update(index, {
                          fields: event.target.checked
                            ? [...module.fields, { ...template }]
                            : module.fields.filter(
                                (item) => item.key !== template.key,
                              ),
                        })
                      }
                    />
                    {template.label}
                  </label>
                  {field && (
                    <>
                      <label>
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(event) =>
                            update(index, {
                              fields: module.fields.map((item) =>
                                item.key === field.key
                                  ? { ...item, required: event.target.checked }
                                  : item,
                              ),
                            })
                          }
                        />{" "}
                        Required
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={field.public_visible}
                          onChange={(event) =>
                            update(index, {
                              fields: module.fields.map((item) =>
                                item.key === field.key
                                  ? {
                                      ...item,
                                      public_visible: event.target.checked,
                                    }
                                  : item,
                              ),
                            })
                          }
                        />{" "}
                        Public field
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={field.public_submit}
                          onChange={(event) =>
                            update(index, {
                              fields: module.fields.map((item) =>
                                item.key === field.key
                                  ? {
                                      ...item,
                                      public_submit: event.target.checked,
                                    }
                                  : item,
                              ),
                            })
                          }
                        />{" "}
                        Public entry
                      </label>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {module.fields
            .filter(
              (field) =>
                !fieldCatalog.some((template) => template.key === field.key),
            )
            .map((field) => (
              <div className="custom-field" key={field.key}>
                <input
                  value={field.label}
                  aria-label="Custom field label"
                  onChange={(event) =>
                    update(index, {
                      fields: module.fields.map((item) =>
                        item.key === field.key
                          ? { ...item, label: event.target.value }
                          : item,
                      ),
                    })
                  }
                />
                <select
                  value={field.type}
                  onChange={(event) =>
                    update(index, {
                      fields: module.fields.map((item) =>
                        item.key === field.key
                          ? {
                              ...item,
                              type: event.target.value as typeof field.type,
                            }
                          : item,
                      ),
                    })
                  }
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="date">Date</option>
                  <option value="boolean">Yes / no</option>
                </select>
                <label>
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(event) =>
                      update(index, {
                        fields: module.fields.map((item) =>
                          item.key === field.key
                            ? { ...item, required: event.target.checked }
                            : item,
                        ),
                      })
                    }
                  />{" "}
                  Required
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={field.public_visible}
                    onChange={(event) =>
                      update(index, {
                        fields: module.fields.map((item) =>
                          item.key === field.key
                            ? { ...item, public_visible: event.target.checked }
                            : item,
                        ),
                      })
                    }
                  />{" "}
                  Public
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={field.public_submit}
                    onChange={(event) =>
                      update(index, {
                        fields: module.fields.map((item) =>
                          item.key === field.key
                            ? { ...item, public_submit: event.target.checked }
                            : item,
                        ),
                      })
                    }
                  />{" "}
                  Public entry
                </label>
                <button
                  type="button"
                  onClick={() =>
                    update(index, {
                      fields: module.fields.filter(
                        (item) => item.key !== field.key,
                      ),
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          <button
            type="button"
            className="add-field"
            onClick={() => addCustomField(index)}
          >
            + Add custom field
          </button>
        </section>
      ))}
      <button type="button" className="add-module" onClick={add}>
        + Add custom module
      </button>
    </div>
  );
}
