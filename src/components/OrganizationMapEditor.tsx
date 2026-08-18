import { useState } from "react";
import SiteMapView from "./SiteMapView";
import type { MapMode } from "../types";

export type MapConfiguration = {
  latitude: number;
  longitude: number;
  zoom: number;
  boundary: [number, number][];
  mode: MapMode;
  imagePath: string | null;
  imageUrl: string;
  gridRows: number;
  gridColumns: number;
  label: string;
};

export default function OrganizationMapEditor({
  value,
  onChange,
  onImageSelected,
  canUploadImage = true,
}: {
  value: MapConfiguration;
  onChange: (value: MapConfiguration) => void;
  onImageSelected?: (file: File) => void;
  canUploadImage?: boolean;
}) {
  const [tool, setTool] = useState<"center" | "boundary">("center");

  return (
    <section className="map-editor panel">
      <div className="map-editor-heading">
        <div>
          <h2>Map location</h2>
          <p>
            {value.mode === "gps"
              ? "Move the map to your area. Drawing a boundary is optional."
              : "Place the default pin on the plan. Drawing a site area is optional."}
          </p>
        </div>
        <div className="segmented">
          <button
            type="button"
            className={tool === "center" ? "active" : ""}
            onClick={() => setTool("center")}
          >
            {value.mode === "gps" ? "Move center" : "Place default pin"}
          </button>
          <button
            type="button"
            className={tool === "boundary" ? "active" : ""}
            onClick={() => setTool("boundary")}
          >
            Draw area
          </button>
        </div>
      </div>
      <div className="map-mode-options" role="group" aria-label="Map type">
        <button
          type="button"
          className={value.mode === "gps" ? "active" : ""}
          onClick={() => onChange({ ...value, mode: "gps" })}
        >
          <b>Street map</b>
          <span>GPS and outdoor sites</span>
        </button>
        <button
          type="button"
          className={value.mode === "image" ? "active" : ""}
          onClick={() =>
            onChange({
              ...value,
              mode: "image",
              latitude: 50,
              longitude: 50,
              boundary: [],
            })
          }
        >
          <b>Uploaded site plan</b>
          <span>Floor plans and store maps</span>
        </button>
        <button
          type="button"
          className={value.mode === "grid" ? "active" : ""}
          onClick={() =>
            onChange({
              ...value,
              mode: "grid",
              latitude: 50,
              longitude: 50,
              boundary: [],
            })
          }
        >
          <b>Generated grid</b>
          <span>Aisles, rows, and zones</span>
        </button>
      </div>
      {value.mode === "image" && (
        <label className="site-map-upload">
          <b>Site-plan image</b>
          <span>
            Upload a clear PNG, JPG, or WebP. Pins use positions on this image
            instead of GPS.
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={!canUploadImage}
            onChange={(event) =>
              event.target.files?.[0] &&
              onImageSelected?.(event.target.files[0])
            }
          />
          {!canUploadImage && (
            <small>
              Create the site first, then upload its plan from Settings.
            </small>
          )}
        </label>
      )}
      {(value.mode === "image" || value.mode === "grid") && (
        <div className="plan-map-settings">
          <label>
            Map label
            <input
              value={value.label}
              onChange={(event) =>
                onChange({ ...value, label: event.target.value })
              }
              placeholder="Main store, north warehouse…"
            />
          </label>
          {value.mode === "grid" && (
            <>
              <label>
                Rows
                <input
                  type="number"
                  min="2"
                  max="30"
                  value={value.gridRows}
                  onChange={(event) =>
                    onChange({ ...value, gridRows: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Columns
                <input
                  type="number"
                  min="2"
                  max="30"
                  value={value.gridColumns}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      gridColumns: Number(event.target.value),
                    })
                  }
                />
              </label>
            </>
          )}
        </div>
      )}
      <SiteMapView
        organization={{
          center_lat: value.latitude,
          center_lng: value.longitude,
          map_zoom: value.zoom,
          boundary: value.boundary,
          map_mode: value.mode,
          map_config: {
            gridRows: value.gridRows,
            gridColumns: value.gridColumns,
            label: value.label,
          },
        }}
        mapImageUrl={value.imageUrl}
        markerLatitude={value.latitude}
        markerLongitude={value.longitude}
        picker={tool === "center"}
        boundaryEditor={tool === "boundary"}
        onPick={(latitude, longitude) =>
          onChange({ ...value, latitude, longitude })
        }
        onBoundaryChange={(boundary) => onChange({ ...value, boundary })}
        onViewportChange={(latitude, longitude, zoom) =>
          onChange({ ...value, latitude, longitude, zoom })
        }
      />
      <div className={`map-tool-status ${tool}`} aria-live="polite">
        {tool === "boundary" ? (
          <>
            <b>Boundary drawing is active.</b>{" "}
            {value.boundary.length
              ? `${value.boundary.length} point${value.boundary.length === 1 ? "" : "s"} placed. Add at least 3 points to form an area.`
              : "Tap each corner of the area on the map."}{" "}
            {value.mode === "gps"
              ? " The map is locked while drawing. Choose Move center to reposition it."
              : " Choose Place default pin when you are finished drawing."}
          </>
        ) : (
          <>
            <b>
              {value.mode === "gps" ? "Move center" : "Default pin placement"}{" "}
              is active.
            </b>{" "}
            Tap the map where this organization should open.
          </>
        )}
      </div>
      <div className="map-simple-actions">
        <button
          type="button"
          disabled={!value.boundary.length}
          onClick={() =>
            onChange({ ...value, boundary: value.boundary.slice(0, -1) })
          }
        >
          Undo last corner
        </button>
        <button
          type="button"
          disabled={!value.boundary.length}
          onClick={() => onChange({ ...value, boundary: [] })}
        >
          Remove boundary
        </button>
      </div>
      <small>
        {value.boundary.length
          ? `${value.boundary.length} boundary corners placed`
          : "No boundary drawn"}
      </small>
      {value.mode === "gps" && (
        <details className="advanced-map-values">
          <summary>Exact map values</summary>
          <p>Most people do not need to change these numbers.</p>
          <div className="map-editor-controls">
            <label>
              Latitude
              <input
                type="number"
                step="any"
                value={value.latitude}
                onChange={(event) =>
                  onChange({ ...value, latitude: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Longitude
              <input
                type="number"
                step="any"
                value={value.longitude}
                onChange={(event) =>
                  onChange({ ...value, longitude: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Opening zoom
              <input
                type="number"
                min="3"
                max="22"
                value={value.zoom}
                onChange={(event) =>
                  onChange({ ...value, zoom: Number(event.target.value) })
                }
              />
            </label>
          </div>
        </details>
      )}
    </section>
  );
}
