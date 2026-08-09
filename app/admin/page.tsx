import { chatGPTSignOutPath, requireChatGPTUser } from "../chatgpt-auth";
import { siteConfig } from "../site-config";
import ModerationQueue from "./ModerationQueue";

export const dynamic = "force-dynamic";

const rows = [
  ["ST-1048", "1968 Ford Mustang Fastback", "Vehicles", "Row C · Bay 12", "Available"],
  ["ST-0891", "Structural I-Beam Bundle", "Materials", "North Rack · N-04", "Available"],
  ["ST-1212", "Vintage Neon Arrow", "Attractions", "Showroom · Wall 2", "On hold"],
];

export default async function AdminPage() {
  const user = await requireChatGPTUser("/admin");
  return <main className="admin-shell">
    <header className="admin-header"><div className="brand"><span className="brand-mark">LK</span><span>{siteConfig.organizationName.toUpperCase()} / OPS</span></div><div className="admin-user"><a href="/">View public site</a><span className="avatar">{user.displayName.slice(0,1).toUpperCase()}</span><span>{user.displayName}<br/><a href={chatGPTSignOutPath("/")}>Sign out</a></span></div></header>
    <section className="admin-main">
      <div className="intro"><div><div className="eyebrow dark"><span/> STAFF WORKSPACE</div><h1>Good morning.</h1><p>Manage mapped places, assets, stock, and community reports.</p></div><div className="admin-actions"><a href="/community">Community map</a><a className="primary" href="/contribute">＋ Public capture form</a></div></div>
      <ModerationQueue/>
      <div className="metric-grid"><div className="metric"><small>TRACKED RECORDS</small><b>1,284</b></div><div className="metric"><small>AVAILABLE</small><b>1,042</b></div><div className="metric"><small>ON HOLD</small><b>38</b></div><div className="metric"><small>PUBLICLY LISTED</small><b>816</b></div></div>
      <div className="inventory-table"><div className="table-head"><span>RECORD</span><span>CATEGORY</span><span>LOCATION</span><span>STATUS</span><span/></div>{rows.map((r) => <div className="table-row" key={r[0]}><span><strong>{r[1]}</strong><br/><small>{r[0]}</small></span><span>{r[2]}</span><span>{r[3]}</span><span>{r[4]}</span><button aria-label={`Edit ${r[1]}`}>•••</button></div>)}</div>
      <p className="admin-footnote">Staff actions are attributed to a verified account. Public contributors do not need accounts, but every contribution is moderated before publication.</p>
    </section>
  </main>;
}
