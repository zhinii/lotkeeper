import type {
  Organization,
  OrganizationFeatures,
  PosConfiguration,
} from "../types";

export const defaultOrganizationFeatures: OrganizationFeatures = {
  mapping: true,
  inventory: true,
  pos: true,
};

export const defaultPosConfiguration: PosConfiguration = {
  currency: "USD",
  taxRate: 0,
};

export function featuresFor(
  organization?: Pick<Organization, "features"> | null,
): OrganizationFeatures {
  return {
    ...defaultOrganizationFeatures,
    ...(organization?.features || {}),
  };
}

export function posConfigurationFor(
  organization?: Pick<Organization, "pos_config"> | null,
): PosConfiguration {
  const configured = {
    ...defaultPosConfiguration,
    ...(organization?.pos_config || {}),
  };
  const taxRate = Number(configured.taxRate);
  return {
    currency: /^[A-Z]{3}$/.test(configured.currency)
      ? configured.currency
      : "USD",
    taxRate: Number.isFinite(taxRate) ? Math.max(0, Math.min(100, taxRate)) : 0,
  };
}

export function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
