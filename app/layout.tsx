import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
export async function generateMetadata(): Promise<Metadata> { const h = await headers(); const host = h.get("host") ?? "localhost"; const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https"); const image = `${proto}://${host}/og.png`; return { title: "Lotkeeper — Find what’s here", description: "Secure, location-aware inventory and public discovery for yards, lots, parks, and venues.", icons: { icon: "/favicon.svg" }, openGraph: { title: "Lotkeeper", description: "Find what’s here. Know exactly where.", images: [{ url: image, width: 1792, height: 921 }] }, twitter: { card: "summary_large_image", title: "Lotkeeper", description: "Find what’s here. Know exactly where.", images: [image] } }; }
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
