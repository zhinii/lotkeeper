import { useState } from "react";
import MapView from "./MapView";

export type MapConfiguration = {
  latitude: number;
  longitude: number;
  zoom: number;
  boundary: [number, number][];
};

export default function OrganizationMapEditor({
  value,
  onChange,
}: {
  value: MapConfiguration;
  onChange: (value: MapConfiguration) => void;
}) {
  const [tool, setTool] = useState<"center" | "boundary">("center");

  return (
    <section className="map-editor panel">
      <div className="map-editor-heading">
        <div>
          <h2>Map location</h2>
          <p>Move the map to your area. Drawing a boundary is optional.</p>
        </div>
        <div className="segmented">
          <button
            type="button"
            className={tool === "center" ? "active" : ""}
            onClick={() => setTool("center")}
          >
            Move center
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
      <MapView
        latitude={value.latitude}
        longitude={value.longitude}
        zoom={value.zoom}
        boundary={value.boundary}
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
              : "Tap each corner of the area on the map."}
          </>
        ) : (
          <>
            <b>Move center is active.</b> Tap the map where this organization
            should open.
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
    </section>
  );
}
