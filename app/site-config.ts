export const siteConfig = {
  productName: "Lotkeeper",
  organizationName:
    process.env.NEXT_PUBLIC_ORGANIZATION_NAME?.trim() || "Your Organization",
  siteName: process.env.NEXT_PUBLIC_SITE_NAME?.trim() || "Main Site",
  defaultLatitude: Number(process.env.NEXT_PUBLIC_SITE_LATITUDE || "33.4484"),
  defaultLongitude: Number(process.env.NEXT_PUBLIC_SITE_LONGITUDE || "-112.0740"),
};
