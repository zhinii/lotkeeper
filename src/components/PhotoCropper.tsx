import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";

export type CropSelection = {
  zoom: number;
  x: number;
  y: number;
};

export const defaultCrop: CropSelection = { zoom: 1, x: 0, y: 0 };

const cropAspect = 4 / 3;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

async function loadDrawableImage(file: File) {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        image: bitmap as CanvasImageSource,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      };
    } catch {
      // Some mobile browsers can display a photo even when
      // createImageBitmap cannot decode that file type.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () =>
        reject(new Error("That photo could not be opened."));
      element.src = url;
    });
    return {
      image: image as CanvasImageSource,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function sourceRectangle(
  width: number,
  height: number,
  crop: CropSelection,
) {
  const imageAspect = width / height;
  const baseWidth = imageAspect > cropAspect ? height * cropAspect : width;
  const baseHeight = imageAspect > cropAspect ? height : width / cropAspect;
  const cropWidth = baseWidth / crop.zoom;
  const cropHeight = baseHeight / crop.zoom;
  const x = (Math.max(0, width - cropWidth) * (crop.x + 100)) / 200;
  const y = (Math.max(0, height - cropHeight) * (crop.y + 100)) / 200;
  return { x, y, width: cropWidth, height: cropHeight };
}

export async function cropPhoto(
  file: File,
  crop: CropSelection,
): Promise<File> {
  const drawable = await loadDrawableImage(file);
  const source = sourceRectangle(drawable.width, drawable.height, crop);
  const outputWidth = Math.max(1, Math.min(1920, Math.round(source.width)));
  const outputHeight = Math.max(1, Math.round(outputWidth / cropAspect));
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    drawable.close();
    throw new Error("This browser cannot crop the photo.");
  }
  context.drawImage(
    drawable.image,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    outputWidth,
    outputHeight,
  );
  drawable.close();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("Photo cropping failed.")),
      "image/jpeg",
      0.9,
    ),
  );
  const baseName = file.name.replace(/\.[^.]+$/, "") || "material-pin-photo";
  return new File([blob], `${baseName}-cropped.jpg`, {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}

export default function PhotoCropper({
  file,
  crop,
  onChange,
  onReadyChange,
}: {
  file: File;
  crop: CropSelection;
  onChange: (crop: CropSelection) => void;
  onReadyChange: (ready: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const imageUrl = useMemo(() => URL.createObjectURL(file), [file]);
  const cropRef = useRef(crop);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | {
        mode: "drag";
        x: number;
        y: number;
        crop: CropSelection;
      }
    | {
        mode: "pinch";
        distance: number;
        centerX: number;
        centerY: number;
        crop: CropSelection;
      }
    | null
  >(null);
  cropRef.current = crop;

  function updateCrop(next: CropSelection) {
    cropRef.current = next;
    onChange(next);
  }

  function beginGesture() {
    const points = [...pointers.current.values()];
    if (points.length === 1) {
      gesture.current = {
        mode: "drag",
        x: points[0].x,
        y: points[0].y,
        crop: cropRef.current,
      };
      return;
    }
    if (points.length >= 2) {
      const [first, second] = points;
      gesture.current = {
        mode: "pinch",
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        centerX: (first.x + second.x) / 2,
        centerY: (first.y + second.y) / 2,
        crop: cropRef.current,
      };
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    beginGesture();
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const bounds = event.currentTarget.getBoundingClientRect();
    const points = [...pointers.current.values()];
    if (points.length === 1 && gesture.current.mode === "drag") {
      updateCrop({
        ...gesture.current.crop,
        x: clamp(
          gesture.current.crop.x -
            ((points[0].x - gesture.current.x) / bounds.width) * 200,
          -100,
          100,
        ),
        y: clamp(
          gesture.current.crop.y -
            ((points[0].y - gesture.current.y) / bounds.height) * 200,
          -100,
          100,
        ),
      });
      return;
    }
    if (points.length >= 2 && gesture.current.mode === "pinch") {
      const [first, second] = points;
      const distance = Math.max(
        1,
        Math.hypot(second.x - first.x, second.y - first.y),
      );
      const centerX = (first.x + second.x) / 2;
      const centerY = (first.y + second.y) / 2;
      updateCrop({
        zoom: clamp(
          gesture.current.crop.zoom * (distance / gesture.current.distance),
          1,
          3,
        ),
        x: clamp(
          gesture.current.crop.x -
            ((centerX - gesture.current.centerX) / bounds.width) * 200,
          -100,
          100,
        ),
        y: clamp(
          gesture.current.crop.y -
            ((centerY - gesture.current.centerY) / bounds.height) * 200,
          -100,
          100,
        ),
      });
    }
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    beginGesture();
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    updateCrop({
      ...cropRef.current,
      zoom: clamp(cropRef.current.zoom - event.deltaY * 0.002, 1, 3),
    });
  }

  useEffect(() => () => URL.revokeObjectURL(imageUrl), [imageUrl]);
  useEffect(() => {
    setLoaded(false);
    setLoadError(false);
    onReadyChange(false);
  }, [imageUrl, onReadyChange]);

  useEffect(() => {
    const element = image.current;
    const target = canvas.current;
    if (!loaded || !element || !target) return;
    const source = sourceRectangle(
      element.naturalWidth,
      element.naturalHeight,
      crop,
    );
    if (target.width !== 960) target.width = 960;
    if (target.height !== 720) target.height = 720;
    const context = target.getContext("2d");
    if (!context) return;
    context.drawImage(
      element,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      target.width,
      target.height,
    );
  }, [crop, loaded]);

  return (
    <div className="photo-cropper">
      <div
        className="crop-canvas-wrap"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onWheel={handleWheel}
      >
        <img
          ref={image}
          src={imageUrl}
          alt=""
          onLoad={() => {
            setLoaded(true);
            onReadyChange(true);
          }}
          onError={() => {
            setLoadError(true);
            onReadyChange(false);
          }}
        />
        <canvas ref={canvas} aria-label="Cropped photo preview" />
        {loadError ? (
          <div className="crop-load-error" role="alert">
            <strong>This photo cannot be opened</strong>
            <small>Go back and choose a JPEG, PNG or WebP photo.</small>
          </div>
        ) : (
          <span aria-hidden="true">Keep the item inside this frame</span>
        )}
      </div>
      <div className="crop-controls">
        <div className="crop-gesture-help">
          <strong>Move the photo directly</strong>
          <span>Drag with one finger</span>
          <span>Pinch with two fingers to zoom</span>
        </div>
        <div className="crop-zoom-buttons" aria-label="Photo zoom">
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() =>
              updateCrop({ ...crop, zoom: clamp(crop.zoom - 0.2, 1, 3) })
            }
          >
            −
          </button>
          <output>{Math.round(crop.zoom * 100)}%</output>
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() =>
              updateCrop({ ...crop, zoom: clamp(crop.zoom + 0.2, 1, 3) })
            }
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
