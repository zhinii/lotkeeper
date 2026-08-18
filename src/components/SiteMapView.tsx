import type { Organization, RecordItem } from "../types";
import MapView from "./MapView";
import PlanMapView from "./PlanMapView";

type Props = {
  organization: Pick<
    Organization,
    | "center_lat"
    | "center_lng"
    | "map_zoom"
    | "boundary"
    | "map_mode"
    | "map_config"
  >;
  mapImageUrl?: string;
  records?: RecordItem[];
  boundary?: [number, number][];
  selectedId?: string | null;
  markerLatitude?: number;
  markerLongitude?: number;
  markerLabel?: string;
  showMarker?: boolean;
  picker?: boolean;
  boundaryEditor?: boolean;
  onPick?: (latitude: number, longitude: number) => void;
  onBoundaryChange?: (boundary: [number, number][]) => void;
  onViewportChange?: (
    latitude: number,
    longitude: number,
    zoom: number,
  ) => void;
  onSelect?: (id: string) => void;
  compact?: boolean;
};

export default function SiteMapView({
  organization,
  mapImageUrl,
  ...props
}: Props) {
  if (organization.map_mode === "image" || organization.map_mode === "grid") {
    return (
      <PlanMapView
        {...props}
        imageUrl={organization.map_mode === "image" ? mapImageUrl : ""}
        generatedGrid={organization.map_mode === "grid"}
        gridRows={organization.map_config?.gridRows || 8}
        gridColumns={organization.map_config?.gridColumns || 10}
        label={organization.map_config?.label || "Site map"}
        boundary={organization.boundary || []}
      />
    );
  }
  return (
    <MapView
      {...props}
      latitude={organization.center_lat}
      longitude={organization.center_lng}
      zoom={organization.map_zoom}
      boundary={organization.boundary || []}
    />
  );
}
