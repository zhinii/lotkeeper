import { useEffect, useRef } from "react";
import type { RecordItem } from "../types";

type Props = {
  latitude: number;
  longitude: number;
  zoom: number;
  records?: RecordItem[];
  selectedId?: string | null;
  boundary?: [number, number][];
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

export default function MapView({
  latitude,
  longitude,
  zoom,
  records = [],
  selectedId,
  boundary = [],
  picker,
  boundaryEditor,
  onPick,
  onBoundaryChange,
  onViewportChange,
  onSelect,
  compact,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const pickMarker = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const callbacks = useRef({
    onPick,
    onBoundaryChange,
    onViewportChange,
    onSelect,
  });
  const currentBoundary = useRef(boundary);
  const interactionMode = useRef({
    picker: Boolean(picker),
    boundaryEditor: Boolean(boundaryEditor),
  });
  callbacks.current = { onPick, onBoundaryChange, onViewportChange, onSelect };
  currentBoundary.current = boundary;
  interactionMode.current = {
    picker: Boolean(picker),
    boundaryEditor: Boolean(boundaryEditor),
  };

  useEffect(() => {
    if (!host.current || !window.maplibregl) return;
    map.current = new window.maplibregl.Map({
      container: host.current,
      center: [longitude, latitude],
      zoom,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
    });
    map.current.addControl(
      new window.maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    if (picker || boundaryEditor) {
      pickMarker.current = new window.maplibregl.Marker({
        draggable: true,
        color: "#ffcf24",
      })
        .setLngLat([longitude, latitude])
        .addTo(map.current);
      pickMarker.current.on("dragend", () => {
        if (!interactionMode.current.picker) return;
        const p = pickMarker.current.getLngLat();
        callbacks.current.onPick?.(p.lat, p.lng);
      });
    }
    map.current.on("click", (event: any) => {
      if (interactionMode.current.boundaryEditor) {
        callbacks.current.onBoundaryChange?.([
          ...currentBoundary.current,
          [event.lngLat.lat, event.lngLat.lng],
        ]);
        return;
      }
      if (interactionMode.current.picker) {
        pickMarker.current?.setLngLat(event.lngLat);
        callbacks.current.onPick?.(event.lngLat.lat, event.lngLat.lng);
      }
    });
    map.current.on("moveend", () => {
      const center = map.current.getCenter();
      callbacks.current.onViewportChange?.(
        center.lat,
        center.lng,
        Math.round(map.current.getZoom()),
      );
    });
    return () => map.current?.remove();
  }, []);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;
    const movementControls = [
      instance.dragPan,
      instance.scrollZoom,
      instance.boxZoom,
      instance.doubleClickZoom,
      instance.touchZoomRotate,
      instance.keyboard,
    ];
    movementControls.forEach((control) =>
      boundaryEditor ? control?.disable() : control?.enable(),
    );
  }, [boundaryEditor]);

  useEffect(() => {
    if (map.current) {
      const center = map.current.getCenter();
      if (
        Math.abs(center.lat - latitude) > 0.000001 ||
        Math.abs(center.lng - longitude) > 0.000001 ||
        Math.abs(map.current.getZoom() - zoom) > 0.01
      ) {
        map.current.easeTo({
          center: [longitude, latitude],
          zoom,
          duration: 250,
        });
      }
    }
    pickMarker.current?.setLngLat([longitude, latitude]);
  }, [latitude, longitude, zoom]);

  useEffect(() => {
    if (!map.current) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = records.map((record) => {
      const node = document.createElement("button");
      node.className = `map-pin ${record.id === selectedId ? "selected" : ""}`;
      node.title = record.name;
      node.onclick = () => callbacks.current.onSelect?.(record.id);
      return new window.maplibregl.Marker({ element: node })
        .setLngLat([record.longitude, record.latitude])
        .addTo(map.current);
    });
  }, [records, selectedId]);

  useEffect(() => {
    if (!map.current) return;
    const update = () => {
      const points = boundary.map(([lat, lng]) => [lng, lat]);
      const features: any[] = boundary.map(([lat, lng], index) => ({
        type: "Feature",
        properties: { index: index + 1 },
        geometry: { type: "Point", coordinates: [lng, lat] },
      }));
      if (points.length >= 2) {
        features.unshift({
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: points },
        });
      }
      if (points.length >= 3) {
        features.unshift({
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [[...points, points[0]]],
          },
        });
      }
      const data = { type: "FeatureCollection", features };
      const source = map.current.getSource("boundary");
      if (source) source.setData(data);
      else {
        map.current.addSource("boundary", { type: "geojson", data });
        map.current.addLayer({
          id: "boundary-fill",
          type: "fill",
          source: "boundary",
          filter: ["==", ["geometry-type"], "Polygon"],
          paint: { "fill-color": "#ffcf24", "fill-opacity": 0.14 },
        });
        map.current.addLayer({
          id: "boundary-line",
          type: "line",
          source: "boundary",
          filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": "#0d2638", "line-width": 3 },
        });
        map.current.addLayer({
          id: "boundary-points",
          type: "circle",
          source: "boundary",
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 6,
            "circle-color": "#ffcf24",
            "circle-stroke-color": "#0d2638",
            "circle-stroke-width": 2,
          },
        });
      }
    };
    if (map.current.isStyleLoaded()) update();
    else map.current.once("load", update);
  }, [boundary]);

  return (
    <div
      className={`map-view ${compact ? "compact" : ""} ${boundaryEditor ? "boundary-editor" : ""} ${picker ? "location-picker" : ""}`}
      ref={host}
    />
  );
}
