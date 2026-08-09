import { useEffect, useRef } from "react";
import type { RecordItem } from "../types";

type Props = {
  latitude: number;
  longitude: number;
  zoom?: number;
  records?: RecordItem[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  picker?: boolean;
  onPick?: (latitude: number, longitude: number) => void;
  boundary?: [number, number][];
  boundaryPicker?: boolean;
  onBoundaryChange?: (points: [number, number][]) => void;
};

export default function GeoMap({
  latitude,
  longitude,
  zoom = 17,
  records = [],
  selectedId,
  onSelect,
  picker,
  onPick,
  boundary = [],
  boundaryPicker,
  onBoundaryChange,
}: Props) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const pickMarker = useRef<any>(null);
  const callbacks = useRef({
    onSelect,
    onPick,
    onBoundaryChange,
    boundary,
    boundaryPicker,
  });
  callbacks.current = {
    onSelect,
    onPick,
    onBoundaryChange,
    boundary,
    boundaryPicker,
  };

  useEffect(() => {
    if (!element.current || !window.maplibregl) return;
    map.current = new window.maplibregl.Map({
      container: element.current,
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
      new window.maplibregl.NavigationControl(),
      "top-right",
    );
    if (picker) {
      pickMarker.current = new window.maplibregl.Marker({
        draggable: true,
        color: "#ffd11a",
      })
        .setLngLat([longitude, latitude])
        .addTo(map.current);
      pickMarker.current.on("dragend", () => {
        const p = pickMarker.current.getLngLat();
        callbacks.current.onPick?.(p.lat, p.lng);
      });
      map.current.on("click", (event: any) => {
        if (callbacks.current.boundaryPicker)
          callbacks.current.onBoundaryChange?.([
            ...callbacks.current.boundary,
            [event.lngLat.lat, event.lngLat.lng],
          ]);
        else {
          pickMarker.current.setLngLat(event.lngLat);
          callbacks.current.onPick?.(event.lngLat.lat, event.lngLat.lng);
        }
      });
    }
    return () => map.current?.remove();
  }, []);

  useEffect(() => {
    if (!map.current) return;
    const update = () => {
      const source = map.current.getSource("site-boundary");
      const coordinates =
        boundary.length > 2
          ? [
              [
                ...boundary.map(([lat, lng]) => [lng, lat]),
                [boundary[0][1], boundary[0][0]],
              ],
            ]
          : [];
      const data = {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates },
      };
      if (source) source.setData(data);
      else {
        map.current.addSource("site-boundary", { type: "geojson", data });
        map.current.addLayer({
          id: "site-boundary-fill",
          type: "fill",
          source: "site-boundary",
          paint: { "fill-color": "#ffd51f", "fill-opacity": 0.18 },
        });
        map.current.addLayer({
          id: "site-boundary-line",
          type: "line",
          source: "site-boundary",
          paint: { "line-color": "#14283d", "line-width": 3 },
        });
      }
    };
    if (map.current.isStyleLoaded()) update();
    else map.current.once("load", update);
  }, [boundary]);

  useEffect(() => {
    if (!map.current) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];
    records.forEach((record) => {
      const node = document.createElement("button");
      node.className = `map-dot ${record.id === selectedId ? "selected" : ""}`;
      node.title = record.name;
      node.onclick = () => callbacks.current.onSelect?.(record.id);
      markers.current.push(
        new window.maplibregl.Marker({ element: node })
          .setLngLat([record.longitude, record.latitude])
          .addTo(map.current),
      );
    });
  }, [records, selectedId]);

  useEffect(() => {
    if (pickMarker.current) pickMarker.current.setLngLat([longitude, latitude]);
    map.current?.easeTo({ center: [longitude, latitude], zoom });
  }, [latitude, longitude, zoom]);
  return <div className="geo-map" ref={element} />;
}
