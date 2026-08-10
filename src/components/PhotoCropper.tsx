import { useEffect, useMemo, useRef, useState } from "react";

export type CropSelection = {
  zoom: number;
  x: number;
  y: number;
};

export const defaultCrop: CropSelection = { zoom: 1, x: 0, y: 0 };

const cropAspect = 4 / 3;

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
    target.width = 960;
    target.height = 720;
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
      <div className="crop-canvas-wrap">
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
        <label>
          <span>Zoom</span>
          <input
            type="range"
            min="1"
            max="3"
            step="0.05"
            value={crop.zoom}
            onChange={(event) =>
              onChange({ ...crop, zoom: Number(event.target.value) })
            }
          />
        </label>
        <label>
          <span>Move left or right</span>
          <input
            type="range"
            min="-100"
            max="100"
            value={crop.x}
            onChange={(event) =>
              onChange({ ...crop, x: Number(event.target.value) })
            }
          />
        </label>
        <label>
          <span>Move up or down</span>
          <input
            type="range"
            min="-100"
            max="100"
            value={crop.y}
            onChange={(event) =>
              onChange({ ...crop, y: Number(event.target.value) })
            }
          />
        </label>
      </div>
    </div>
  );
}
