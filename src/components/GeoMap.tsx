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
};

export default function GeoMap({ latitude, longitude, zoom = 17, records = [], selectedId, onSelect, picker, onPick }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const pickMarker = useRef<any>(null);
  const callbacks = useRef({ onSelect, onPick }); callbacks.current = { onSelect, onPick };

  useEffect(() => {
    if (!element.current || !window.maplibregl) return;
    map.current = new window.maplibregl.Map({ container: element.current, center: [longitude, latitude], zoom, style: { version: 8, sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } }, layers: [{ id: "osm", type: "raster", source: "osm" }] } });
    map.current.addControl(new window.maplibregl.NavigationControl(), "top-right");
    if (picker) {
      pickMarker.current = new window.maplibregl.Marker({ draggable: true, color: "#ffd11a" }).setLngLat([longitude, latitude]).addTo(map.current);
      pickMarker.current.on("dragend", () => { const p = pickMarker.current.getLngLat(); callbacks.current.onPick?.(p.lat, p.lng); });
      map.current.on("click", (event: any) => { pickMarker.current.setLngLat(event.lngLat); callbacks.current.onPick?.(event.lngLat.lat, event.lngLat.lng); });
    }
    return () => map.current?.remove();
  }, []);

  useEffect(() => {
    if (!map.current) return;
    markers.current.forEach((marker) => marker.remove()); markers.current = [];
    records.forEach((record) => {
      const node = document.createElement("button"); node.className = `map-dot ${record.id === selectedId ? "selected" : ""}`; node.title = record.name; node.onclick = () => callbacks.current.onSelect?.(record.id);
      markers.current.push(new window.maplibregl.Marker({ element: node }).setLngLat([record.longitude, record.latitude]).addTo(map.current));
    });
  }, [records, selectedId]);

  useEffect(() => { if (pickMarker.current) { pickMarker.current.setLngLat([longitude, latitude]); map.current?.easeTo({ center: [longitude, latitude] }); } }, [latitude, longitude]);
  return <div className="geo-map" ref={element} />;
}
