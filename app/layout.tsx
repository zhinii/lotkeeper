import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./community.css";
import { siteConfig } from "./site-config";

export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const host = h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${proto}://${host}/og.png`;
  const title = `${siteConfig.organizationName} — Find what is here`;
  const description = "Location-aware places, assets, stock, and staff-approved community contributions.";
  return { title, description, icons: { icon: "/favicon.svg" }, openGraph: { title, description, images: [{ url: image, width: 1792, height: 921 }] }, twitter: { card: "summary_large_image", title, description, images: [image] } };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
