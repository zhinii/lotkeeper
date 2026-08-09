"use client";

import { useEffect, useState } from "react";
import { siteConfig } from "../site-config";

type PublicRecord = { id: string; recordType: string; name: string; category: string; description?: string; latitude: number; longitude: number; photoKey?: string };

export default function CommunityPage() {
  const [records, setRecords] = useState<PublicRecord[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { fetch("/api/records").then((r) => r.json()).then((data) => setRecords(data.records || [])).finally(() => setLoading(false)); }, []);
  return <main className="community-shell"><header className="simple-header"><a className="brand" href="/"><span className="brand-mark">LK</span><span>{siteConfig.organizationName}</span></a><a className="community-add" href="/contribute">＋ Add something</a></header><section className="community-hero"><div className="eyebrow"><span/> APPROVED COMMUNITY MAP</div><h1>Shared knowledge,<br/><em>reviewed by staff.</em></h1><p>Every record below was submitted through the public browser form and approved by an administrator.</p></section><section className="community-list">{loading && <p>Loading approved contributions…</p>}{!loading && !records.length && <div className="empty-community"><h2>No approved community additions yet.</h2><p>New submissions stay private until an administrator reviews them.</p><a href="/contribute">Make the first submission</a></div>}{records.map((record) => <article className="community-card" key={record.id}>{record.photoKey && <img src={`/api/media/${encodeURIComponent(record.photoKey)}`} alt=""/>}<div><small>{record.recordType.replace("_", " ")} · {record.category}</small><h2>{record.name}</h2><p>{record.description || "No additional description."}</p><a target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${record.latitude}&mlon=${record.longitude}#map=19/${record.latitude}/${record.longitude}`}>Open mapped location ↗</a></div></article>)}</section></main>;
}
