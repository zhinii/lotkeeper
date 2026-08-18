import type { MouseEvent } from "react";
import type { RecordItem } from "../types";

type Props = {
  imageUrl?: string;
  generatedGrid?: boolean;
  gridRows?: number;
  gridColumns?: number;
  label?: string;
  records?: RecordItem[];
  pinNumbers?: Record<string, number>;
  selectedId?: string | null;
  boundary?: [number, number][];
  markerLatitude?: number;
  markerLongitude?: number;
  markerLabel?: string;
  showMarker?: boolean;
  picker?: boolean;
  boundaryEditor?: boolean;
  onPick?: (latitude: number, longitude: number) => void;
  onBoundaryChange?: (boundary: [number, number][]) => void;
  onSelect?: (id: string) => void;
  compact?: boolean;
};

function percentage(value: number | undefined, fallback = 50) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(100, Math.max(0, numeric))
    : fallback;
}

export default function PlanMapView({
  imageUrl,
  generatedGrid = false,
  gridRows = 8,
  gridColumns = 10,
  label = "Site plan",
  records = [],
  pinNumbers = {},
  selectedId,
  boundary = [],
  markerLatitude,
  markerLongitude,
  markerLabel = "Item location",
  showMarker,
  picker,
  boundaryEditor,
  onPick,
  onBoundaryChange,
  onSelect,
  compact,
}: Props) {
  function choosePoint(event: MouseEvent<HTMLDivElement>) {
    if (!picker && !boundaryEditor) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const longitude = ((event.clientX - rect.left) / rect.width) * 100;
    const latitude = ((event.clientY - rect.top) / rect.height) * 100;
    if (boundaryEditor)
      onBoundaryChange?.([...boundary, [latitude, longitude]]);
    else onPick?.(latitude, longitude);
  }

  return (
    <div
      className={`plan-map-view map-view ${compact ? "compact" : ""} ${boundaryEditor ? "boundary-editor" : ""}`}
      onClick={choosePoint}
      role="img"
      aria-label={label}
    >
      {imageUrl ? (
        <img className="plan-map-image" src={imageUrl} alt="" />
      ) : generatedGrid ? (
        <div
          className="generated-site-grid"
          style={{
            gridTemplateColumns: `repeat(${Math.max(2, gridColumns)}, 1fr)`,
            gridTemplateRows: `repeat(${Math.max(2, gridRows)}, 1fr)`,
          }}
        >
          {Array.from({
            length: Math.max(2, gridRows) * Math.max(2, gridColumns),
          }).map((_, index) => (
            <i key={index} />
          ))}
        </div>
      ) : (
        <div className="plan-map-empty">
          <b>No site-plan image yet</b>
          <span>Upload a plan in Site settings.</span>
        </div>
      )}
      <span className="plan-map-label">{label}</span>
      {boundary.length >= 2 && (
        <svg
          className="plan-map-boundary"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {boundary.length >= 3 && (
            <polygon
              points={boundary
                .map(([lat, lng]) => `${percentage(lng)},${percentage(lat)}`)
                .join(" ")}
            />
          )}
          <polyline
            points={boundary
              .map(([lat, lng]) => `${percentage(lng)},${percentage(lat)}`)
              .join(" ")}
          />
        </svg>
      )}
      {boundary.map(([lat, lng], index) => (
        <span
          className="plan-boundary-point"
          key={`${lat}-${lng}-${index}`}
          style={{ left: `${percentage(lng)}%`, top: `${percentage(lat)}%` }}
        />
      ))}
      {records.map((record, index) => {
        const pinNumber = pinNumbers[record.id] ?? index + 1;
        const location = String(
          record.data.location ||
            record.data.location_code ||
            record.data.storage_location ||
            record.data.bin ||
            "",
        ).trim();
        return (
          <button
          type="button"
          className={`plan-record-pin map-pin ${record.id === selectedId ? "selected" : ""}`}
          style={{
            left: `${percentage(record.longitude)}%`,
            top: `${percentage(record.latitude)}%`,
          }}
          title={`${pinNumber}. ${record.name}`}
          aria-label={`${pinNumber}. ${record.name}`}
          key={record.id}
          onClick={(event) => {
            event.stopPropagation();
            onSelect?.(record.id);
          }}
        >
            <span className="pin-number">{pinNumber}</span>
            <span className="map-pin-preview">
              <b>{record.name}</b>
              <small>
                {[
                  record.category,
                  record.quantity === null
                    ? ""
                    : `${record.quantity}${record.unit ? ` ${record.unit}` : ""}`,
                  location,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </span>
          </button>
        );
      })}
      {(showMarker || picker || boundaryEditor) && (
        <span
          className="location-pin plan-location-pin"
          style={{
            left: `${percentage(markerLongitude)}%`,
            top: `${percentage(markerLatitude)}%`,
          }}
          aria-hidden="true"
          title={markerLabel}
        />
      )}
    </div>
  );
}
