import { useEffect, useRef } from "react";
import type { RecordItem } from "../types";

type Props = {
  latitude: number;
  longitude: number;
  zoom: number;
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
  onViewportChange,
  onSelect,
  compact,
}: Props) {
  const numericLatitude = Number(latitude);
  const numericLongitude = Number(longitude);
  const numericZoom = Number(zoom);
  const safeLatitude =
    Number.isFinite(numericLatitude) &&
    numericLatitude >= -90 &&
    numericLatitude <= 90
      ? numericLatitude
      : 0;
  const safeLongitude =
    Number.isFinite(numericLongitude) &&
    numericLongitude >= -180 &&
    numericLongitude <= 180
      ? numericLongitude
      : 0;
  const safeZoom = Number.isFinite(numericZoom)
    ? Math.min(22, Math.max(0, numericZoom))
    : 2;
  const numericMarkerLatitude = Number(markerLatitude);
  const numericMarkerLongitude = Number(markerLongitude);
  const safeMarkerLatitude =
    Number.isFinite(numericMarkerLatitude) &&
    numericMarkerLatitude >= -90 &&
    numericMarkerLatitude <= 90
      ? numericMarkerLatitude
      : safeLatitude;
  const safeMarkerLongitude =
    Number.isFinite(numericMarkerLongitude) &&
    numericMarkerLongitude >= -180 &&
    numericMarkerLongitude <= 180
      ? numericMarkerLongitude
      : safeLongitude;
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
    const mapHost = host.current;
    let resizeFrame: number | null = null;
    const resizeMap = () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        map.current?.resize();
      });
    };
    map.current = new window.maplibregl.Map({
      container: mapHost,
      center: [safeLongitude, safeLatitude],
      zoom: safeZoom,
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
    if (picker || boundaryEditor || showMarker) {
      const markerNode = document.createElement("div");
      markerNode.className = "location-pin";
      markerNode.title = markerLabel;
      markerNode.setAttribute("aria-label", markerLabel);
      pickMarker.current = new window.maplibregl.Marker({
        draggable: Boolean(picker || boundaryEditor),
        element: markerNode,
      })
        .setLngLat([safeMarkerLongitude, safeMarkerLatitude])
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
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(resizeMap);
    resizeObserver?.observe(mapHost);
    window.addEventListener("resize", resizeMap);
    map.current.once("load", resizeMap);
    resizeMap();
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resizeMap);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      map.current?.remove();
      map.current = null;
    };
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
        Math.abs(center.lat - safeLatitude) > 0.000001 ||
        Math.abs(center.lng - safeLongitude) > 0.000001 ||
        Math.abs(map.current.getZoom() - safeZoom) > 0.01
      ) {
        map.current.easeTo({
          center: [safeLongitude, safeLatitude],
          zoom: safeZoom,
          duration: 250,
        });
      }
    }
  }, [safeLatitude, safeLongitude, safeZoom]);

  useEffect(() => {
    pickMarker.current?.setLngLat([safeMarkerLongitude, safeMarkerLatitude]);
  }, [safeMarkerLatitude, safeMarkerLongitude]);

  useEffect(() => {
    if (!map.current) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = records.flatMap((record, index) => {
      const recordLatitude = Number(record.latitude);
      const recordLongitude = Number(record.longitude);
      if (
        !Number.isFinite(recordLatitude) ||
        !Number.isFinite(recordLongitude) ||
        recordLatitude < -90 ||
        recordLatitude > 90 ||
        recordLongitude < -180 ||
        recordLongitude > 180
      )
        return [];
      const node = document.createElement("button");
      node.className = `map-pin ${record.id === selectedId ? "selected" : ""}`;
      const pinNumber = pinNumbers[record.id] ?? index + 1;
      const number = document.createElement("span");
      number.className = "pin-number";
      number.textContent = String(pinNumber);
      const preview = document.createElement("span");
      preview.className = "map-pin-preview";
      const previewName = document.createElement("b");
      previewName.textContent = record.name;
      const previewDetail = document.createElement("small");
      const location = String(
        record.data.location ||
          record.data.location_code ||
          record.data.storage_location ||
          record.data.bin ||
          "",
      ).trim();
      previewDetail.textContent = [
        record.category,
        record.quantity === null
          ? ""
          : `${record.quantity}${record.unit ? ` ${record.unit}` : ""}`,
        location,
      ]
        .filter(Boolean)
        .join(" · ");
      preview.append(previewName, previewDetail);
      node.append(number, preview);
      node.title = `${pinNumber}. ${record.name}`;
      node.setAttribute("aria-label", `${pinNumber}. ${record.name}`);
      node.onclick = () => callbacks.current.onSelect?.(record.id);
      return [
        new window.maplibregl.Marker({ element: node })
          .setLngLat([recordLongitude, recordLatitude])
          .addTo(map.current),
      ];
    });
    const activeRecord = records.find((record) => record.id === selectedId);
    if (activeRecord) {
      const activeLatitude = Number(activeRecord.latitude);
      const activeLongitude = Number(activeRecord.longitude);
      if (Number.isFinite(activeLatitude) && Number.isFinite(activeLongitude))
        map.current.easeTo({
          center: [activeLongitude, activeLatitude],
          duration: 450,
        });
    }
  }, [records, selectedId, pinNumbers]);

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
