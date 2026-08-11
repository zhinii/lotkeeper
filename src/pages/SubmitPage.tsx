import { useEffect, useMemo, useRef, useState } from "react";
import { gps as readGps, parse as readExif } from "exifr";
import MapView from "../components/MapView";
import PhotoCropper, {
  cropPhoto,
  defaultCrop,
  type CropSelection,
} from "../components/PhotoCropper";
import {
  commercialCaptureFields,
  commercialCaptureKeys,
  configuredCaptureFields,
  emptyCommercialCaptureData,
  inventoryCaptureFields,
  normalizeCollections,
  type CommercialCaptureKey,
} from "../lib/captureFields";
import { navigate } from "../lib/route";
import { publicPhoto, requireSupabase } from "../lib/supabase";
import type {
  LocationSource,
  Organization,
  RecordItem,
  Submission,
} from "../types";

type Point = {
  lat: number;
  lng: number;
  accuracy: number | null;
  source: LocationSource;
};

type PrecisePoint = Point & { accuracy: number };

type SubmissionStep = "photo" | "crop" | "review" | "complete";
type AnalysisState = "idle" | "analyzing" | "complete" | "unavailable";
type DetailsEntryMode = "choice" | "manual";
type MobileGpsState = "idle" | "locating" | "ready" | "blocked";

type EnrichmentResponse = {
  status?: string;
  suggestions?: Submission["ai_suggestions"];
};

type PreparedPhoto = {
  upload: File;
  analysisDataUrl: string;
  originalBytes: number;
  uploadBytes: number;
};

const MOBILE_REQUIRED_ACCURACY_METERS = 10;

function localDateTime(isoDate: string | null) {
  if (!isoDate) return "";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function validCoordinate(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? number
    : null;
}

function exifNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    const rational = trimmed.match(
      /^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/,
    );
    if (rational) {
      const denominator = Number(rational[2]);
      const number = Number(rational[1]) / denominator;
      return denominator !== 0 && Number.isFinite(number) ? number : null;
    }
    const number = Number(trimmed);
    return Number.isFinite(number) ? number : null;
  }
  if (value && typeof value === "object") {
    const rational = value as { numerator?: unknown; denominator?: unknown };
    const numerator = exifNumber(rational.numerator);
    const denominator = exifNumber(rational.denominator);
    if (numerator !== null && denominator !== null && denominator !== 0) {
      return numerator / denominator;
    }
  }
  return null;
}

function exifCoordinate(
  value: unknown,
  reference: unknown,
  minimum: number,
  maximum: number,
) {
  const values = Array.isArray(value) ? value : [value];
  const parts = values.map(exifNumber);
  if (!parts.length || parts.some((part) => part === null)) return null;
  const degrees = parts[0] as number;
  const absolute =
    Math.abs(degrees) +
    (parts.length > 1 ? (parts[1] as number) / 60 : 0) +
    (parts.length > 2 ? (parts[2] as number) / 3600 : 0);
  const direction = String(reference || "")
    .trim()
    .toUpperCase();
  const signed =
    direction === "S" || direction === "W" || degrees < 0
      ? -absolute
      : absolute;
  return validCoordinate(signed, minimum, maximum);
}

function browserLocation(): Promise<Point | null> {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const lat = validCoordinate(coords.latitude, -90, 90);
        const lng = validCoordinate(coords.longitude, -180, 180);
        if (lat === null || lng === null) return resolve(null);
        resolve({
          lat,
          lng,
          accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
          source: "browser_gps",
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

function fileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function prepareSubmissionPhoto(file: File): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(file);
  const maximum = 1920;
  const ratio = Math.min(1, maximum / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
  canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot prepare the photo.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const uploadBlob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value ? resolve(value) : reject(new Error("Photo preparation failed.")),
      "image/jpeg",
      0.8,
    ),
  );
  const analysisMaximum = 1280;
  const analysisRatio = Math.min(
    1,
    analysisMaximum / Math.max(canvas.width, canvas.height),
  );
  const analysisCanvas = document.createElement("canvas");
  analysisCanvas.width = Math.max(1, Math.round(canvas.width * analysisRatio));
  analysisCanvas.height = Math.max(
    1,
    Math.round(canvas.height * analysisRatio),
  );
  analysisCanvas
    .getContext("2d")
    ?.drawImage(canvas, 0, 0, analysisCanvas.width, analysisCanvas.height);
  const analysisBlob = await new Promise<Blob>((resolve, reject) =>
    analysisCanvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error("AI photo preparation failed.")),
      "image/jpeg",
      0.74,
    ),
  );
  const baseName = file.name.replace(/\.[^.]+$/, "") || "material-pin-photo";
  return {
    upload: new File([uploadBlob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    }),
    analysisDataUrl: await fileAsDataUrl(analysisBlob),
    originalBytes: file.size,
    uploadBytes: uploadBlob.size,
  };
}

function fileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isMobileCaptureDevice() {
  if (typeof navigator === "undefined") return false;
  const mobileUserAgent = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(
    navigator.userAgent,
  );
  const touchIPad =
    /Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
  return mobileUserAgent || touchIPad;
}

function locationSourceLabel(source: LocationSource) {
  if (source === "photo_exif") return "Photo EXIF";
  if (source === "browser_gps") return "Live phone GPS";
  return "Manual pin";
}

function usableMobileGps(point: Point | null): point is PrecisePoint {
  return Boolean(
    point &&
      point.accuracy !== null &&
      point.accuracy <= MOBILE_REQUIRED_ACCURACY_METERS,
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M15 11h6l3-4h8l3 4h4a5 5 0 0 1 5 5v22a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V16a5 5 0 0 1 5-5h6Zm9 26a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-5a5 5 0 1 1 0-10 5 5 0 0 1 0 10Z" />
    </svg>
  );
}

export default function SubmitPage({
  slug,
  recordId,
}: {
  slug: string;
  recordId: string | null;
}) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [target, setTarget] = useState<RecordItem | null>(null);
  const [step, setStep] = useState<SubmissionStep>("photo");
  const [collectionId, setCollectionId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [keywords, setKeywords] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [commercialData, setCommercialData] = useState(() =>
    emptyCommercialCaptureData(),
  );
  const [customData, setCustomData] = useState<Record<string, string>>({});
  const [sourcePhoto, setSourcePhoto] = useState<File | null>(null);
  const [crop, setCrop] = useState<CropSelection>(defaultCrop);
  const [cropReady, setCropReady] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preparedPhoto, setPreparedPhoto] = useState<PreparedPhoto | null>(
    null,
  );
  const [preview, setPreview] = useState("");
  const [photoTakenAt, setPhotoTakenAt] = useState<string | null>(null);
  const [point, setPoint] = useState<Point | null>(null);
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [isMember, setIsMember] = useState(false);
  const [publicVisible, setPublicVisible] = useState(true);
  const [preparing, setPreparing] = useState(false);
  const [analysisState, setAnalysisState] = useState<AnalysisState>("idle");
  const [detailsEntryMode, setDetailsEntryMode] =
    useState<DetailsEntryMode>("choice");
  const [aiSuggestions, setAiSuggestions] = useState<
    Submission["ai_suggestions"] | null
  >(null);
  const [mobileDevice] = useState(isMobileCaptureDevice);
  const [mobileCapturePoint, setMobileCapturePoint] = useState<Point | null>(
    null,
  );
  const [mobileGpsState, setMobileGpsState] = useState<MobileGpsState>("idle");
  const [queuedPhotos, setQueuedPhotos] = useState<File[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const metadataPromise = useRef<Promise<Point | null> | null>(null);
  const cameraVideo = useRef<HTMLVideoElement>(null);
  const detailsCard = useRef<HTMLElement>(null);
  const mobileLocationWatch = useRef<number | null>(null);
  const mobileBestPoint = useRef<Point | null>(null);

  useEffect(() => {
    (async () => {
      const client = requireSupabase();
      const { data: org, error } = await client
        .from("organizations")
        .select("*")
        .eq("slug", slug)
        .single();
      if (error) return setStatus(error.message);
      const rawOrganization = org as Organization;
      const organizationData = {
        ...rawOrganization,
        collections: normalizeCollections(rawOrganization.collections || []),
      };
      setOrganization(organizationData);
      const { data: user } = await client.auth.getUser();
      if (!user.user) {
        setStatus("Employee sign-in is required to add or update items.");
        return;
      }
      const { data: memberships } = await client
        .from("organization_members")
        .select("organization_id")
        .eq("organization_id", organizationData.id);
      if (!memberships?.length) {
        setStatus("Your account is not assigned to this organization.");
        return;
      }
      setIsMember(true);
      const first = organizationData.collections[0];
      setCollectionId(first?.id || "");

      if (!recordId) return;
      const { data } = await client
        .from("records")
        .select("*")
        .eq("id", recordId)
        .single();
      if (!data) return;
      const { data: privateRow } = await client
        .from("record_private_data")
        .select("data")
        .eq("record_id", recordId)
        .maybeSingle();
      const item = {
        ...(data as RecordItem),
        data: {
          ...(data as RecordItem).data,
          ...((privateRow?.data as Record<string, unknown>) || {}),
        },
      };
      setTarget(item);
      setCollectionId(item.collection_id);
      setName(item.name);
      setDescription(item.description);
      setCategory(item.category);
      setKeywords(item.keywords.join(", "));
      setQuantity(item.quantity === null ? "1" : String(item.quantity));
      setUnit(item.unit || "");
      setPublicVisible(item.public_visible);
      setPhotoTakenAt(item.photo_taken_at);
      setCustomData(
        Object.fromEntries(
          Object.entries(item.data).map(([key, value]) => [
            key,
            value == null ? "" : String(value),
          ]),
        ),
      );
      setCommercialData(
        Object.fromEntries(
          commercialCaptureFields.map((field) => [
            field.key,
            item.data[field.key] == null ? "" : String(item.data[field.key]),
          ]),
        ) as Record<CommercialCaptureKey, string>,
      );
      const itemLat = validCoordinate(item.latitude, -90, 90);
      const itemLng = validCoordinate(item.longitude, -180, 180);
      if (itemLat !== null && itemLng !== null)
        setPoint({
          lat: itemLat,
          lng: itemLng,
          accuracy: null,
          source: item.location_source,
        });
    })();
  }, [slug, recordId]);

  useEffect(() => {
    if (!photo) return setPreview("");
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    const video = cameraVideo.current;
    if (!video || !cameraStream) return;
    video.srcObject = cameraStream;
    void video.play().catch(() => undefined);
  }, [cameraStream]);

  useEffect(
    () => () => {
      cameraStream?.getTracks().forEach((track) => track.stop());
    },
    [cameraStream],
  );

  useEffect(
    () => () => {
      if (mobileLocationWatch.current !== null)
        navigator.geolocation?.clearWatch(mobileLocationWatch.current);
    },
    [],
  );

  const collections = useMemo(
    () => organization?.collections || [],
    [organization],
  );
  const collection =
    collections.find((item) => item.id === collectionId) || null;

  function applySuggestions(suggestions: Submission["ai_suggestions"]) {
    const safeKeywords = Array.isArray(suggestions.keywords)
      ? suggestions.keywords
      : [];
    const safeFields = Array.isArray(suggestions.fields)
      ? suggestions.fields
      : [];
    const safeWarnings = Array.isArray(suggestions.warnings)
      ? suggestions.warnings
      : [];
    const safeSuggestions: Submission["ai_suggestions"] = {
      ...suggestions,
      keywords: safeKeywords,
      fields: safeFields,
      warnings: safeWarnings,
    };
    setAiSuggestions(safeSuggestions);
    if (safeSuggestions.collection_id) {
      const suggestedCollection = collections.find(
        (item) => item.id === safeSuggestions.collection_id,
      );
      if (suggestedCollection) setCollectionId(suggestedCollection.id);
    }
    if (safeSuggestions.name) setName(safeSuggestions.name);
    if (safeSuggestions.description)
      setDescription(safeSuggestions.description);
    if (safeSuggestions.category) setCategory(safeSuggestions.category);
    if (
      safeSuggestions.quantity &&
      Number.isFinite(Number(safeSuggestions.quantity))
    )
      setQuantity(safeSuggestions.quantity);
    if (safeSuggestions.unit) setUnit(safeSuggestions.unit);
    if (safeKeywords.length) setKeywords(safeKeywords.join(", "));
    for (const field of safeFields) {
      if (commercialCaptureKeys.has(field.key as CommercialCaptureKey)) {
        setCommercialData((current) => ({
          ...current,
          [field.key]: field.value,
        }));
      } else {
        setCustomData((current) => ({
          ...current,
          [field.key]: field.value,
        }));
      }
    }
  }

  async function analyzeSelectedPhoto() {
    if (!organization?.ai_enabled || !preparedPhoto) {
      setStatus("Finish preparing the photo before generating details.");
      return;
    }
    setDetailsEntryMode("manual");
    setAnalysisState("analyzing");
    setStatus("Generating item details from the photo…");
    try {
      const { data, error } = await requireSupabase().functions.invoke(
        "enrich-submission",
        {
          body: {
            organization_id: organization.id,
            image_data_url: preparedPhoto.analysisDataUrl,
          },
        },
      );
      if (error) throw error;
      const result = data as EnrichmentResponse | null;
      if (result?.status !== "complete" || !result.suggestions)
        throw new Error("Suggestions were unavailable.");
      applySuggestions(result.suggestions);
      setAnalysisState("complete");
      setStatus("Details generated. Review and edit them before submitting.");
    } catch (error) {
      console.error("Automatic photo details failed", error);
      setAnalysisState("unavailable");
      setStatus(
        "Automatic details could not be generated. Try again or enter the details yourself.",
      );
    }
  }

  function enterDetailsManually() {
    setDetailsEntryMode("manual");
    setStatus("Enter the item details below, then submit them for review.");
    requestAnimationFrame(() => {
      detailsCard.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      detailsCard.current?.querySelector<HTMLInputElement>("input")?.focus();
    });
  }

  async function readPhotoLocation(
    file: File,
    fallbackLocation: Promise<Point | null>,
  ) {
    const [coordinates, metadata] = await Promise.all([
      readGps(file).catch(() => null),
      readExif(file, [
        "DateTimeOriginal",
        "CreateDate",
        "GPSLatitude",
        "GPSLatitudeRef",
        "GPSLongitude",
        "GPSLongitudeRef",
      ]).catch(() => null),
    ]);
    const captured = metadata?.DateTimeOriginal || metadata?.CreateDate;
    const fileDate = new Date(file.lastModified);
    setPhotoTakenAt(
      captured instanceof Date && !Number.isNaN(captured.getTime())
        ? captured.toISOString()
        : file.lastModified > 0 && !Number.isNaN(fileDate.getTime())
          ? fileDate.toISOString()
          : new Date().toISOString(),
    );
    const photoLat =
      validCoordinate(coordinates?.latitude, -90, 90) ??
      exifCoordinate(metadata?.GPSLatitude, metadata?.GPSLatitudeRef, -90, 90);
    const photoLng =
      validCoordinate(coordinates?.longitude, -180, 180) ??
      exifCoordinate(
        metadata?.GPSLongitude,
        metadata?.GPSLongitudeRef,
        -180,
        180,
      );
    if (photoLat !== null && photoLng !== null) {
      const exifPoint: Point = {
        lat: photoLat,
        lng: photoLng,
        accuracy: null,
        source: "photo_exif",
      };
      setPoint(exifPoint);
      return exifPoint;
    }
    const current = await fallbackLocation;
    if (current) setPoint(current);
    return current;
  }

  function selectPhoto(
    file: File | null,
    fallbackLocation: Promise<Point | null> = Promise.resolve(null),
  ) {
    if (!file || !organization) return;
    setSourcePhoto(file);
    setCrop(defaultCrop);
    setCropReady(false);
    setPhoto(null);
    setPreparedPhoto(null);
    setPhotoTakenAt(null);
    setPoint(null);
    setAiSuggestions(null);
    setAnalysisState("idle");
    setDetailsEntryMode("choice");
    setPreparing(false);
    setStatus("Crop the photo so the item is clear.");
    metadataPromise.current = readPhotoLocation(file, fallbackLocation);
    setStep("crop");
  }

  function stopMobileLocationTracking() {
    if (mobileLocationWatch.current === null) return;
    navigator.geolocation?.clearWatch(mobileLocationWatch.current);
    mobileLocationWatch.current = null;
  }

  function startMobileLocationTracking() {
    stopMobileLocationTracking();
    mobileBestPoint.current = null;
    setMobileCapturePoint(null);
    setMobileGpsState("locating");
    if (!navigator.geolocation) {
      setMobileGpsState("blocked");
      setStatus(
        "This browser cannot provide the GPS location required for a camera photo.",
      );
      return;
    }
    mobileLocationWatch.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const lat = validCoordinate(coords.latitude, -90, 90);
        const lng = validCoordinate(coords.longitude, -180, 180);
        const accuracy = Number.isFinite(coords.accuracy)
          ? coords.accuracy
          : null;
        if (lat === null || lng === null || accuracy === null) return;
        const candidate: Point = {
          lat,
          lng,
          accuracy,
          source: "browser_gps",
        };
        const best = mobileBestPoint.current;
        if (best && best.accuracy !== null && best.accuracy <= accuracy) return;
        mobileBestPoint.current = candidate;
        setMobileCapturePoint(candidate);
        if (usableMobileGps(candidate)) {
          setMobileGpsState("ready");
          setStatus(
            `Precise GPS ready (approximately ±${Math.round(accuracy)} m). The phone will keep improving the fix while the camera is open.`,
          );
        } else {
          setMobileGpsState("locating");
          setStatus(
            `Improving GPS accuracy: approximately ±${Math.round(accuracy)} m. Hold still or move into open sky; the shutter unlocks at ±${MOBILE_REQUIRED_ACCURACY_METERS} m or better.`,
          );
        }
      },
      () => {
        if (usableMobileGps(mobileBestPoint.current)) return;
        setMobileGpsState("blocked");
        setStatus(
          "A precise GPS fix is unavailable. Allow precise location, turn on phone location, and move where the phone can see more open sky.",
        );
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  function closeMobileCamera() {
    cameraStream?.getTracks().forEach((track) => track.stop());
    setCameraStream(null);
    stopMobileLocationTracking();
    setMobileGpsState("idle");
  }

  async function openMobileCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus(
        "This browser cannot open a live camera. Use a current mobile browser.",
      );
      return;
    }
    setStatus(
      "Opening the camera and getting the most accurate GPS fix available…",
    );
    startMobileLocationTracking();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      setCameraStream(stream);
      setStatus(
        "Camera ready. GPS is refining in the background; the shutter will unlock when the fix is precise.",
      );
    } catch {
      stopMobileLocationTracking();
      setMobileGpsState("idle");
      setStatus(
        "Camera access is blocked. Allow camera access for this site, then try again.",
      );
    }
  }

  async function captureMobilePhoto() {
    const video = cameraVideo.current;
    if (!video || video.videoWidth < 1 || video.videoHeight < 1) {
      setStatus("The camera is still starting. Wait a moment and try again.");
      return;
    }
    const captureLocation = mobileBestPoint.current;
    if (!usableMobileGps(captureLocation)) {
      setStatus(
        `Wait for GPS accuracy of ±${MOBILE_REQUIRED_ACCURACY_METERS} m or better before taking the photo.`,
      );
      return;
    }
    setStatus("Capturing the photo with the precise GPS location…");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setStatus("This browser could not capture the camera image.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (!blob) {
      setStatus("The camera image could not be saved. Try again.");
      return;
    }
    const capturedAt = Date.now();
    const file = new File([blob], `material-pin-${capturedAt}.jpg`, {
      type: "image/jpeg",
      lastModified: capturedAt,
    });
    setMobileCapturePoint(captureLocation);
    closeMobileCamera();
    selectPhoto(file, Promise.resolve(captureLocation));
  }

  function selectDesktopPhotos(files: FileList | null) {
    const selected = Array.from(files || []);
    if (!selected.length) return;
    setQueuedPhotos(selected);
    setQueueIndex(0);
    selectPhoto(selected[0], Promise.resolve(recordId && point ? point : null));
  }

  async function confirmCrop() {
    if (!sourcePhoto || !organization) return;
    setPreparing(true);
    setStatus("Cropping and preparing the photo...");
    let file: File;
    try {
      file = await cropPhoto(sourcePhoto, crop);
    } catch {
      setPreparing(false);
      setStep("crop");
      setStatus("This photo could not be cropped. Try another photo.");
      return;
    }
    setPhoto(file);
    setPreparedPhoto(null);
    setAiSuggestions(null);
    setAnalysisState("idle");
    setDetailsEntryMode("choice");
    setStatus("Preparing a smaller photo…");

    const metadataTask = metadataPromise.current || Promise.resolve(null);
    let mapped: Point | null;
    try {
      const [photoLocation, prepared] = await Promise.all([
        metadataTask,
        prepareSubmissionPhoto(file),
      ]);
      mapped = photoLocation;
      setPreparedPhoto(prepared);
    } catch {
      setPreparing(false);
      setStatus(
        "This photo could not be prepared. Try taking another photo or choose a JPEG, PNG or WebP image.",
      );
      return;
    }
    setStatus(
      mapped
        ? mapped.source === "photo_exif"
          ? "Photo location found. Review the pin before submitting."
          : "Current location captured. Review the pin before submitting."
        : mobileDevice
          ? "A live GPS location is required. Enable phone location or place the pin on the map."
          : "This file did not contain accessible GPS coordinates. Place the pin on the map before submitting.",
    );
    setPreparing(false);
    setStep("review");
  }

  async function locate() {
    setStatus("Getting your current location…");
    const current = await browserLocation();
    if (current) {
      setPoint(current);
      setStatus(
        `Current location captured (approximately ±${Math.round(current.accuracy || 0)} m).`,
      );
    } else {
      setStatus(
        "Phone location is blocked or unavailable. Allow location for this site and try again, or place the pin on the map.",
      );
    }
  }

  function reviewExisting() {
    if (!recordId || !target) return;
    setAnalysisState("idle");
    setDetailsEntryMode("manual");
    setStep("review");
  }

  function continuePhotoDump() {
    const nextIndex = queueIndex + 1;
    const nextPhoto = queuedPhotos[nextIndex];
    if (!nextPhoto) return;
    setQueueIndex(nextIndex);
    setName("");
    setDescription("");
    setCategory("");
    setKeywords("");
    setQuantity("1");
    setUnit("");
    setCommercialData(emptyCommercialCaptureData());
    setCustomData({});
    setPublicVisible(true);
    selectPhoto(nextPhoto);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organization || !collection || !point)
      return setStatus("Place the item on the map before submitting.");
    if (!recordId && !photo)
      return setStatus("Take or choose a photo before submitting.");
    if (photo && !preparedPhoto)
      return setStatus(
        "Wait for the photo to finish preparing before submitting.",
      );

    setSending(true);
    setStatus(photo ? "Uploading the optimized photo…" : "Saving the update…");
    const id = crypto.randomUUID();
    let photoPath: string | null = null;
    const client = requireSupabase();
    try {
      if (photo) {
        photoPath = `${organization.id}/${id}.jpg`;
        const { error } = await client.storage
          .from("submission-media")
          .upload(photoPath, preparedPhoto!.upload, {
            contentType: "image/jpeg",
            upsert: false,
          });
        if (error) throw error;
        setStatus("Saving the item details…");
      }

      const data = Object.fromEntries(
        configuredCaptureFields(collection)
          .filter((field) => field.key !== "quantity" && field.key !== "unit")
          .map((field) => [
            field.key,
            commercialCaptureKeys.has(field.key)
              ? commercialData[field.key as CommercialCaptureKey] || ""
              : customData[field.key] || "",
          ]),
      );
      const confirmedKeywords = keywords
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 16);
      const confirmedSuggestions = {
        ...(aiSuggestions || {}),
        name: name.trim(),
        collection_id: collection.id,
        description: description.trim(),
        category: category.trim() || collection.name,
        keywords: confirmedKeywords,
      };
      const { data: user } = await client.auth.getUser();
      const proposed = {
        name: name.trim(),
        description: description.trim(),
        category: category.trim() || collection.name,
        keywords: confirmedKeywords,
        data,
        collection_id: collection.id,
        quantity:
          collection.kind !== "place" && quantity !== ""
            ? Number(quantity)
            : null,
        unit: collection.kind !== "place" ? unit.trim() || null : null,
        public_visible: publicVisible,
        latitude: point.lat,
        longitude: point.lng,
        location_source: point.source,
        photo_taken_at: photoTakenAt,
      };
      const { error } = await client.from("submissions").insert({
        id,
        organization_id: organization.id,
        submission_type: recordId ? "update" : "new",
        target_record_id: recordId,
        collection_id: collection.id,
        proposed,
        photo_path: photoPath,
        latitude: point.lat,
        longitude: point.lng,
        location_source: point.source,
        gps_accuracy: point.accuracy,
        photo_taken_at: photoTakenAt,
        submitted_by: user.user?.id || null,
        status: "pending",
        ai_status:
          analysisState === "complete"
            ? "complete"
            : analysisState === "unavailable"
              ? "failed"
              : "not_requested",
        ai_suggestions: confirmedSuggestions,
      });
      if (error) throw error;
      setStep("complete");
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Submission failed.");
    } finally {
      setSending(false);
    }
  }

  if (!organization)
    return (
      <div className="loading">
        Loading photo capture… <small>{status}</small>
      </div>
    );

  if (!isMember)
    return (
      <main className="access-page">
        <button className="access-back" onClick={() => navigate(`org/${slug}`)}>
          ← Public site
        </button>
        <section className="access-card">
          <div className="brand">MATERIAL PIN</div>
          <small>EMPLOYEE ACCESS REQUIRED</small>
          <h1>Sign in before changing this map</h1>
          <p>{status || "Only assigned employees can add or update items."}</p>
          <button onClick={() => navigate("staff")}>Employee sign in</button>
        </section>
      </main>
    );

  const mapLat = point?.lat ?? organization.center_lat;
  const mapLng = point?.lng ?? organization.center_lng;
  const displayPhoto =
    preview || (target?.photo_path ? publicPhoto(target.photo_path) : "");
  const photoDumpRemaining = Math.max(0, queuedPhotos.length - queueIndex - 1);

  if (step === "complete")
    return (
      <div className="submission-page submission-flow-page">
        <header className="topbar submission-topbar">
          <div className="brand-button">
            <b>MATERIAL PIN</b>
            <span>{organization.name}</span>
          </div>
        </header>
        <main className="submission-complete">
          <section className="submitted-card">
            <span className="submitted-check" aria-hidden="true">
              ✓
            </span>
            <small>
              SUBMITTED
              {queuedPhotos.length > 1
                ? ` · PHOTO ${queueIndex + 1} OF ${queuedPhotos.length}`
                : ""}
            </small>
            <h1>Your photo is in review</h1>
            <p>
              An administrator will verify it before it appears publicly. You do
              not need to submit it again.
            </p>
            {displayPhoto && <img src={displayPhoto} alt="Submitted" />}
            <dl>
              <div>
                <dt>Item</dt>
                <dd>{name}</dd>
              </div>
              <div>
                <dt>Collection</dt>
                <dd>{collection?.name}</dd>
              </div>
              <div>
                <dt>GPS coordinates</dt>
                <dd>
                  {point
                    ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`
                    : "Recorded"}
                </dd>
              </div>
              <div>
                <dt>Location source</dt>
                <dd>
                  {point ? locationSourceLabel(point.source) : "Recorded"}
                </dd>
              </div>
            </dl>
          </section>
          {photoDumpRemaining > 0 && (
            <button className="continue-photo-dump" onClick={continuePhotoDump}>
              Review next photo ({photoDumpRemaining} remaining)
            </button>
          )}
          <button
            className="return-to-place"
            onClick={() => navigate(`org/${organization.slug}`)}
          >
            Return to {organization.name}
          </button>
        </main>
      </div>
    );

  if (step === "crop" && sourcePhoto)
    return (
      <div className="submission-page submission-flow-page">
        <header className="topbar submission-topbar">
          <button className="brand-button" onClick={() => setStep("photo")}>
            <b>BACK</b>
            <span>{organization.name}</span>
          </button>
          <button onClick={() => navigate(`org/${organization.slug}`)}>
            Cancel
          </button>
        </header>
        <main className="capture-first crop-step">
          <div className="submission-progress" aria-label="Step 2 of 3">
            <i>✓</i>
            <span />
            <b>2</b>
            <span />
            <i>3</i>
          </div>
          <section className="capture-intro">
            <small>
              FOCUS THE PHOTO
              {queuedPhotos.length > 1
                ? ` · ${queueIndex + 1} OF ${queuedPhotos.length}`
                : ""}
            </small>
            <h1>Crop to the item</h1>
            <p>
              Zoom and reposition the photo so the item you are adding is clear.
              Only the area inside the frame will be analyzed and saved.
            </p>
          </section>
          <section className="crop-panel" aria-busy={preparing}>
            <PhotoCropper
              file={sourcePhoto}
              crop={crop}
              onChange={setCrop}
              onReadyChange={setCropReady}
            />
            <div className="crop-step-actions">
              <button type="button" onClick={() => setCrop(defaultCrop)}>
                Reset crop
              </button>
              <button
                type="button"
                className="crop-confirm"
                disabled={preparing || !cropReady}
                onClick={() => void confirmCrop()}
              >
                {preparing ? "Preparing..." : "Use this crop"}
              </button>
            </div>
          </section>
        </main>
      </div>
    );

  if (step === "photo")
    return (
      <div className="submission-page submission-flow-page">
        <header className="topbar submission-topbar">
          <button
            className="brand-button"
            onClick={() => navigate(`org/${organization.slug}`)}
          >
            <b>MATERIAL PIN</b>
            <span>{organization.name}</span>
          </button>
          <button onClick={() => navigate(`org/${organization.slug}`)}>
            Cancel
          </button>
        </header>
        <main className="capture-first">
          <div className="submission-progress" aria-label="Step 1 of 3">
            <b>1</b>
            <span />
            <i>2</i>
            <span />
            <i>3</i>
          </div>
          <section className="capture-intro">
            <small>{recordId ? "UPDATE AN ENTRY" : "ADD TO THE MAP"}</small>
            <h1>
              {recordId
                ? "Start with a new photo"
                : mobileDevice
                  ? "Open the camera and take a photo"
                  : "Choose photos to add"}
            </h1>
            <p>
              {mobileDevice
                ? "The camera requests precise location automatically and keeps refining the GPS fix until you take the photo."
                : "Choose one or many original image files. Material Pin reads each photo's date and embedded GPS, then walks you through them one at a time."}
            </p>
          </section>

          {preparing && displayPhoto ? (
            <section className="photo-preparing" aria-live="polite">
              <img src={displayPhoto} alt="Selected for review" />
              <div>
                <span className="ai-spinner" aria-hidden="true" />
                <small>PREPARING YOUR SUBMISSION</small>
                <h2>
                  {analysisState === "analyzing"
                    ? "Reading the photo and suggesting details…"
                    : "Reading the photo date and location…"}
                </h2>
                <p>Please keep this page open for a moment.</p>
              </div>
            </section>
          ) : (
            <section className="capture-panel">
              {target?.photo_path && (
                <div className="current-record-photo">
                  <img
                    src={publicPhoto(target.photo_path)}
                    alt="Current entry"
                  />
                  <span>Current photo</span>
                </div>
              )}
              {mobileDevice ? (
                <div className="mobile-camera-flow">
                  {cameraStream ? (
                    <section className="live-camera-panel">
                      <video ref={cameraVideo} autoPlay muted playsInline />
                      <div className={`camera-gps-status ${mobileGpsState}`}>
                        <span aria-hidden="true">
                          {mobileGpsState === "ready" ? "✓" : "⌖"}
                        </span>
                        <div>
                          <strong>
                            {mobileGpsState === "ready"
                              ? `Precise GPS · ±${Math.round(mobileCapturePoint?.accuracy || 0)} m`
                              : mobileGpsState === "blocked"
                                ? "Precise GPS unavailable"
                                : "Getting precise GPS…"}
                          </strong>
                          <small>
                            {mobileGpsState === "ready"
                              ? "The phone is still refining the location."
                              : mobileCapturePoint?.accuracy
                                ? `Current fix ±${Math.round(mobileCapturePoint.accuracy)} m · needs ±${MOBILE_REQUIRED_ACCURACY_METERS} m or better`
                                : `The shutter unlocks at ±${MOBILE_REQUIRED_ACCURACY_METERS} m or better.`}
                          </small>
                        </div>
                        {mobileGpsState === "blocked" && (
                          <button
                            type="button"
                            onClick={startMobileLocationTracking}
                          >
                            Try GPS again
                          </button>
                        )}
                      </div>
                      <div className="camera-actions">
                        <button type="button" onClick={closeMobileCamera}>
                          Close camera
                        </button>
                        <button
                          type="button"
                          className="camera-shutter"
                          disabled={!usableMobileGps(mobileCapturePoint)}
                          onClick={() => void captureMobilePhoto()}
                        >
                          {usableMobileGps(mobileCapturePoint)
                            ? "Take photo"
                            : "Waiting for precise GPS"}
                        </button>
                      </div>
                    </section>
                  ) : (
                    <button
                      type="button"
                      className="capture-choice primary mobile-camera-choice"
                      onClick={() => void openMobileCamera()}
                    >
                      <CameraIcon />
                      <small>CAMERA + GPS</small>
                      <strong>Open live camera</strong>
                      <span>Camera and precise location start together</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="capture-actions desktop-photo-dump">
                  <label className="capture-choice primary">
                    <input
                      type="file"
                      accept="image/*"
                      multiple={!recordId}
                      onChange={(event) =>
                        selectDesktopPhotos(event.target.files)
                      }
                    />
                    <span className="upload-icon" aria-hidden="true">
                      ↑
                    </span>
                    <strong>
                      {recordId ? "Choose a photo" : "Choose photos"}
                    </strong>
                    <small>
                      {recordId
                        ? "Use the original image file"
                        : "Select one or many original files"}
                    </small>
                  </label>
                </div>
              )}
              {recordId && target && (
                <button
                  className="review-without-photo"
                  onClick={reviewExisting}
                >
                  Review the existing details without a new photo
                </button>
              )}
            </section>
          )}
          <p className="capture-status" aria-live="polite">
            {status}
          </p>
          <p className="capture-privacy">
            Your signed-in employee account and every inventory change are
            recorded.
          </p>
        </main>
      </div>
    );

  return (
    <div className="submission-page submission-flow-page">
      <header className="topbar submission-topbar">
        <button className="brand-button" onClick={() => setStep("photo")}>
          <b>← PHOTO</b>
          <span>{organization.name}</span>
        </button>
        <button onClick={() => navigate(`org/${organization.slug}`)}>
          Cancel
        </button>
      </header>
      <main className="submission-review">
        <div className="submission-progress" aria-label="Step 3 of 3">
          <i>✓</i>
          <span />
          <i>✓</i>
          <span />
          <b>3</b>
        </div>
        <div className="review-heading">
          <small>
            REVIEW BEFORE SENDING
            {queuedPhotos.length > 1
              ? ` · ${queueIndex + 1} OF ${queuedPhotos.length}`
              : ""}
          </small>
          <h1>Check the photo and item details</h1>
          <p>
            Correct anything that is not right, confirm the pin, then submit.
          </p>
        </div>

        <form onSubmit={submit}>
          <section className="visual-review-grid">
            <div className="review-photo-card">
              {displayPhoto ? (
                <img src={displayPhoto} alt="Photo being submitted" />
              ) : (
                <div className="review-photo-empty">
                  Using the existing photo
                </div>
              )}
              <button type="button" onClick={() => setStep("photo")}>
                {photo ? "Retake or change photo" : "Add a new photo"}
              </button>
              {photo && preparedPhoto && (
                <small className="photo-optimization-note">
                  Optimized for faster upload:{" "}
                  {fileSize(preparedPhoto.originalBytes)} →{" "}
                  {fileSize(preparedPhoto.uploadBytes)}
                </small>
              )}
            </div>
            <div className="review-map-card">
              <div className="review-map-heading">
                <div>
                  <small>LOCATION</small>
                  <strong>
                    {point
                      ? "Pin found—tap the map to adjust"
                      : "Location required"}
                  </strong>
                </div>
                {point && mobileDevice && (
                  <button type="button" onClick={locate}>
                    Update from phone
                  </button>
                )}
              </div>
              {!point && mobileDevice && (
                <div className="location-needed">
                  <div>
                    <strong>Use the phone's current location</strong>
                    <span>
                      A precise live GPS fix is required for mobile camera
                      submissions.
                    </span>
                  </div>
                  <button type="button" onClick={locate}>
                    Try phone GPS again
                  </button>
                  <small>Or tap the map to place the pin yourself.</small>
                </div>
              )}
              {!point && !mobileDevice && (
                <div className="location-needed desktop-location-needed">
                  <div>
                    <strong>No embedded GPS was found</strong>
                    <span>
                      Use the original image file when possible. Otherwise tap
                      the map to place this photo.
                    </span>
                  </div>
                </div>
              )}
              <MapView
                latitude={organization.center_lat}
                longitude={organization.center_lng}
                zoom={Math.min(16, organization.map_zoom)}
                markerLatitude={mapLat}
                markerLongitude={mapLng}
                markerLabel="Photo location"
                boundary={organization.boundary}
                picker
                compact
                onPick={(lat, lng) => {
                  setPoint({ lat, lng, accuracy: null, source: "manual_pin" });
                  setStatus("Pin adjusted manually.");
                }}
              />
              <div className="coordinate-readout">
                <span>
                  GPS coordinates
                  {point ? ` · ${locationSourceLabel(point.source)}` : ""}
                </span>
                <code>
                  {point
                    ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`
                    : "Location required"}
                </code>
              </div>
            </div>
          </section>

          {organization.ai_enabled && photo && preparedPhoto && (
            <section
              className={`ai-details-choice ${analysisState}`}
              aria-live="polite"
            >
              <div className="ai-choice-copy">
                <small>OPTIONAL PHOTO ASSISTANT</small>
                <h2>
                  {analysisState === "analyzing"
                    ? "Generating the item details…"
                    : analysisState === "complete"
                      ? "Details generated—please review them"
                      : analysisState === "unavailable"
                        ? "Automatic details need another try"
                        : "How would you like to add the details?"}
                </h2>
                <p>
                  {analysisState === "complete"
                    ? "The photo filled the fields below. Change anything that is not correct."
                    : analysisState === "unavailable"
                      ? "The photo and location are safe. Try the assistant again, or type the details yourself."
                      : "Let the photo assistant suggest the name, description, category and searchable terms, or enter them yourself."}
                </p>
              </div>
              <div className="ai-choice-actions">
                <button
                  type="button"
                  className="ai-generate-button"
                  disabled={analysisState === "analyzing"}
                  onClick={() => void analyzeSelectedPhoto()}
                >
                  {analysisState === "analyzing"
                    ? "Generating…"
                    : analysisState === "complete"
                      ? "Generate again"
                      : analysisState === "unavailable"
                        ? "Try automatic details again"
                        : "Generate details automatically"}
                </button>
                {analysisState !== "complete" && (
                  <button
                    type="button"
                    className="ai-manual-button"
                    onClick={enterDetailsManually}
                  >
                    Enter details myself
                  </button>
                )}
              </div>
            </section>
          )}

          <section
            className={`review-details-card ${analysisState === "complete" ? "ai-filled" : ""}`}
            ref={detailsCard}
          >
            <div className="review-card-title">
              <div>
                <small>PHOTO DETAILS</small>
                <h2>Review and edit</h2>
              </div>
              {analysisState === "complete" && <span>Filled from photo</span>}
              {analysisState === "unavailable" && (
                <span className="neutral">Enter details or retry above</span>
              )}
              {analysisState === "idle" && detailsEntryMode === "manual" && (
                <span className="neutral">Manual entry</span>
              )}
            </div>

            <div className="review-field-grid">
              <label>
                Collection
                <select
                  value={collectionId}
                  onChange={(event) => setCollectionId(event.target.value)}
                  required
                >
                  {collections.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Item name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={140}
                />
              </label>
              <label className="wide-field">
                Description
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                  required
                  maxLength={2000}
                />
              </label>
              <label>
                Category
                <input
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  required
                  maxLength={100}
                />
              </label>
              <label className="wide-field">
                Search keywords
                <input
                  value={keywords}
                  onChange={(event) => setKeywords(event.target.value)}
                  placeholder="tree, shade, damaged branch"
                />
                <small>Separate words or short phrases with commas.</small>
              </label>
              <label className="capture-date-field wide-field">
                Date of capture
                <input
                  type="datetime-local"
                  value={localDateTime(photoTakenAt)}
                  onChange={(event) =>
                    setPhotoTakenAt(
                      event.target.value
                        ? new Date(event.target.value).toISOString()
                        : null,
                    )
                  }
                  required={!recordId || Boolean(photo)}
                />
                <small>Filled from the photo when available.</small>
              </label>
            </div>

            {!!configuredCaptureFields(collection).length && (
              <fieldset className="inventory-capture-fields unified-capture-fields">
                <legend>Item details</legend>
                <p>
                  AI fills what it can see. Review it and complete only the
                  details marked Required.
                </p>
                {configuredCaptureFields(collection).map((field) => {
                  const preset = inventoryCaptureFields.find(
                    (item) => item.key === field.key,
                  );
                  const value = commercialCaptureKeys.has(field.key)
                    ? commercialData[field.key as CommercialCaptureKey] || ""
                    : customData[field.key] || "";
                  return (
                    <label key={field.key}>
                      <span>
                        {field.label}
                        <small>
                          {field.required ? "Required" : "Optional"}
                        </small>
                      </span>
                      {field.key === "quantity" ? (
                        <input
                          value={quantity}
                          onChange={(event) => setQuantity(event.target.value)}
                          type="number"
                          min="0"
                          step="any"
                          placeholder={preset?.placeholder}
                          required={field.required}
                        />
                      ) : field.key === "unit" ? (
                        <input
                          value={unit}
                          onChange={(event) => setUnit(event.target.value)}
                          placeholder={preset?.placeholder}
                          required={field.required}
                        />
                      ) : field.type === "boolean" ? (
                        <input
                          checked={value === "true"}
                          onChange={(event) =>
                            setCustomData((current) => ({
                              ...current,
                              [field.key]: String(event.target.checked),
                            }))
                          }
                          type="checkbox"
                          required={field.required}
                        />
                      ) : commercialCaptureKeys.has(field.key) ? (
                        <input
                          value={value}
                          onChange={(event) =>
                            setCommercialData((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))
                          }
                          type={field.type}
                          placeholder={preset?.placeholder}
                          required={field.required}
                        />
                      ) : (
                        <input
                          value={value}
                          onChange={(event) =>
                            setCustomData((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))
                          }
                          type={field.type}
                          required={field.required}
                        />
                      )}
                    </label>
                  );
                })}
              </fieldset>
            )}

            <label className="visibility-choice wide-field">
              <input
                type="checkbox"
                checked={publicVisible}
                onChange={(event) => setPublicVisible(event.target.checked)}
              />
              <span>
                <b>Show this item on the public site</b>
                <small>
                  Turn this off for employee-only inventory, equipment or site
                  information.
                </small>
              </span>
            </label>

            {!!aiSuggestions?.warnings?.length && (
              <p className="ai-review-note">
                Please double-check: {aiSuggestions.warnings.join(" ")}
              </p>
            )}
          </section>

          <section className="review-submit-card">
            <div>
              <h2>Ready to send?</h2>
              <p>An administrator will review this before it is published.</p>
              <p className="notice" aria-live="polite">
                {status}
              </p>
            </div>
            <button disabled={sending || !point || (!recordId && !photo)}>
              {sending ? "Submitting…" : "Submit for review"}
            </button>
          </section>
        </form>
      </main>
    </div>
  );
}
