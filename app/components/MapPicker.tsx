"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window { maplibregl?: any }
}

type Props = {
  latitude: number;
  longitude: number;
  onChange: (latitude: number, longitude: number) => void;
};

const MAPLIBRE_JS = "https://unpkg.com/maplibre-gl@5.7.1/dist/maplibre-gl.js";
const MAPLIBRE_CSS = "https://unpkg.com/maplibre-gl@5.7.1/dist/maplibre-gl.css";

export default function MapPicker({ latitude, longitude, onChange }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const marker = useRef<any>(null);
  const changeHandler = useRef(onChange);
  changeHandler.current = onChange;

  useEffect(() => {
    let cancelled = false;
    if (!document.querySelector(`link[href="${MAPLIBRE_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = MAPLIBRE_CSS;
      document.head.appendChild(link);
    }

    const initialize = () => {
      if (cancelled || !container.current || !window.maplibregl || map.current) return;
      map.current = new window.maplibregl.Map({
        container: container.current,
        center: [longitude, latitude],
        zoom: 18,
        style: {
          version: 8,
          sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
          layers: [{ id: "osm", type: "raster", source: "osm" }],
        },
      });
      map.current.addControl(new window.maplibregl.NavigationControl(), "top-right");
      marker.current = new window.maplibregl.Marker({ draggable: true, color: "#d8ff4f" })
        .setLngLat([longitude, latitude]).addTo(map.current);
      marker.current.on("dragend", () => {
        const point = marker.current.getLngLat();
        changeHandler.current(point.lat, point.lng);
      });
      map.current.on("click", (event: any) => {
        marker.current.setLngLat(event.lngLat);
        changeHandler.current(event.lngLat.lat, event.lngLat.lng);
      });
    };

    if (window.maplibregl) initialize();
    else {
      let script = document.querySelector<HTMLScriptElement>(`script[src="${MAPLIBRE_JS}"]`);
      if (!script) {
        script = document.createElement("script");
        script.src = MAPLIBRE_JS;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", initialize, { once: true });
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!map.current || !marker.current) return;
    marker.current.setLngLat([longitude, latitude]);
    map.current.easeTo({ center: [longitude, latitude] });
  }, [latitude, longitude]);

  useEffect(() => () => map.current?.remove(), []);

  return <div ref={container} className="gps-map" aria-label="Adjust submission pin on map" />;
}
