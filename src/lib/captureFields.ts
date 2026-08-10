export const commercialCaptureFields = [
  {
    key: "sku",
    label: "SKU # / asset ID",
    placeholder: "Required item identifier",
    required: true,
  },
  {
    key: "location_code",
    label: "Storage location / bin",
    placeholder: "Yard A, aisle 4, bin 12",
    required: false,
  },
  {
    key: "condition",
    label: "Condition",
    placeholder: "New, used, damaged, scrap",
    required: false,
  },
  {
    key: "manufacturer",
    label: "Manufacturer / brand",
    placeholder: "Optional",
    required: false,
  },
  {
    key: "lot_serial",
    label: "Lot / serial number",
    placeholder: "Optional traceable number",
    required: false,
  },
] as const;

export type CommercialCaptureKey =
  (typeof commercialCaptureFields)[number]["key"];

export const commercialCaptureKeys = new Set<string>(
  commercialCaptureFields.map((field) => field.key),
);

export function captureFieldLabel(key: string) {
  return (
    commercialCaptureFields.find((field) => field.key === key)?.label ||
    key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

export function emptyCommercialCaptureData(): Record<
  CommercialCaptureKey,
  string
> {
  return Object.fromEntries(
    commercialCaptureFields.map((field) => [field.key, ""]),
  ) as Record<CommercialCaptureKey, string>;
}
