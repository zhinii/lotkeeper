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
  callbacks.current = { onPick, onBoundaryChange, onViewportChange, onSelect };
  currentBoundary.current = boundary;

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
    if (picker) {
      pickMarker.current = new window.maplibregl.Marker({
        draggable: true,
        color: "#ffcf24",
      })
        .setLngLat([longitude, latitude])
        .addTo(map.current);
      pickMarker.current.on("dragend", () => {
        const p = pickMarker.current.getLngLat();
        callbacks.current.onPick?.(p.lat, p.lng);
      });
      map.current.on("click", (event: any) => {
        pickMarker.current.setLngLat(event.lngLat);
        callbacks.current.onPick?.(event.lngLat.lat, event.lngLat.lng);
      });
    }
    if (boundaryEditor) {
      map.current.on("click", (event: any) =>
        callbacks.current.onBoundaryChange?.([
          ...currentBoundary.current,
          [event.lngLat.lat, event.lngLat.lng],
        ]),
      );
    }
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
      const coordinates =
        boundary.length >= 3
          ? [
              [
                ...boundary.map(([lat, lng]) => [lng, lat]),
                [boundary[0][1], boundary[0][0]],
              ],
            ]
          : [];
      const data =
        boundary.length >= 3
          ? {
              type: "Feature",
              properties: {},
              geometry: { type: "Polygon", coordinates },
            }
          : { type: "FeatureCollection", features: [] };
      const source = map.current.getSource("boundary");
      if (source) source.setData(data);
      else if (boundary.length >= 3) {
        map.current.addSource("boundary", { type: "geojson", data });
        map.current.addLayer({
          id: "boundary-fill",
          type: "fill",
          source: "boundary",
          paint: { "fill-color": "#ffcf24", "fill-opacity": 0.14 },
        });
        map.current.addLayer({
          id: "boundary-line",
          type: "line",
          source: "boundary",
          paint: { "line-color": "#0d2638", "line-width": 3 },
        });
      }
    };
    if (map.current.isStyleLoaded()) update();
    else map.current.once("load", update);
  }, [boundary]);

  return <div className={`map-view ${compact ? "compact" : ""}`} ref={host} />;
}
