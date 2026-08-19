import type { RecordItem } from "../types";

export type AvailabilityState =
  | "available"
  | "out_of_stock"
  | "sold"
  | "unavailable"
  | "untracked";

export function availabilityFor(record: RecordItem): AvailabilityState {
  if (record.quantity === null) return "untracked";
  if (record.availability_status) return record.availability_status;
  return Number(record.quantity) > 0 ? "available" : "out_of_stock";
}

export function availabilityLabel(record: RecordItem) {
  const state = availabilityFor(record);
  if (state === "out_of_stock") return "Out of stock";
  if (state === "sold") return "Sold";
  if (state === "unavailable") return "Unavailable";
  if (state === "untracked") return "Location item";
  return "Available";
}

export function availabilityClass(record: RecordItem) {
  return `availability-${availabilityFor(record)}`;
}
