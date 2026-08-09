import { FormEvent, useEffect, useState } from "react";
import AdminConsole from "./components/AdminConsole";
import ContributionForm from "./components/ContributionForm";
import Directory from "./components/Directory";
import { db, getSession, signIn } from "./lib/supabase";
import type { Instance } from "./types";

function routeFromHash() { return location.hash.replace(/^#\/?/, "") || "home"; }

function Home({ navigate }: { navigate: (route: string) => void }) {
  const [instances, setInstances] = useState<Instance[]>([]); const [query, setQuery] = useState("");
  useEffect(() => { db<Instance[]>("instances", "access_mode=eq.public&select=*&order=name").then(setInstances).catch(() => setInstances([])); }, []);
  const visible = instances.filter((item) => `${item.name} ${item.site_name}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="landing"><header className="landing-header"><div className="wordmark"><b>LOTKEEPER</b><span>Location-aware operations</span></div><button onClick={() => navigate("admin")}>Administrator console</button></header><main><section className="landing-search"><small>FIND AN ORGANIZATION OR SITE</small><h1>Find what is there.<br/>Know exactly where.</h1><div><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search organizations and sites"/><button>Search</button></div><p>A practical directory for mapped places, durable assets, managed stock, loose material, and staff-approved public knowledge.</p></section><section className="instance-directory"><div className="section-title"><h2>Available organizations</h2><span>{visible.length} public instances</span></div>{!visible.length && <div className="empty"><h2>No public instances yet</h2><p>Administrators can create the first deployment from the console.</p></div>}<div className="instance-grid">{visible.map((instance) => <button key={instance.id} onClick={() => navigate(`site/${instance.slug}`)}><span className="instance-initials">{instance.name.split(/\s+/).map((part) => part[0]).join("").slice(0,3)}</span><span><small>{instance.site_name}</small><strong>{instance.name}</strong><em>{instance.modules.map((m) => instance.terminology[m] || m).join(" · ")}</em></span><b>Open →</b></button>)}</div></section><section className="principles"><article><b>01</b><h2>Search first</h2><p>Codes, names, categories, descriptions, quantities, and physical locations are immediately searchable.</p></article><article><b>02</b><h2>One map</h2><p>Places, assets, stock, and loose material share a consistent site map without being treated as the same thing.</p></article><article><b>03</b><h2>Controlled contributions</h2><p>Visitors can contribute photos and GPS pins, but administrators remain responsible for published information.</p></article></section></main></div>;
}

function Access({ slug, navigate }: { slug: string; navigate: (route: string) => void }) {
  const [message, setMessage] = useState("This instance is private. Sign in with an assigned account.");
  async function login(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); try { await signIn(String(form.get("email")), String(form.get("password"))); navigate(`site/${slug}`); location.reload(); } catch (e) { setMessage(e instanceof Error ? e.message : "Sign-in failed."); } }
  return <div className="login-page"><form onSubmit={login}><b className="login-brand">PRIVATE LOTKEEPER INSTANCE</b><h1>Access required</h1><p>{message}</p><label>Email<input name="email" type="email" required/></label><label>Password<input name="password" type="password" required/></label><button>Sign in</button><button type="button" className="text-button" onClick={() => navigate("home")}>Return home</button></form></div>;
}

export default function App() {
  const [route, setRoute] = useState(routeFromHash()); const [instance, setInstance] = useState<Instance | null>(null); const [loading, setLoading] = useState(false);
  useEffect(() => { const change = () => setRoute(routeFromHash()); addEventListener("hashchange", change); return () => removeEventListener("hashchange", change); }, []);
  const navigate = (next: string) => { location.hash = `#/${next}`; setRoute(next); };
  const [kind, slug] = route.split("/");
  useEffect(() => { if (!slug || !["site", "contribute"].includes(kind)) { setInstance(null); return; } setLoading(true); db<Instance[]>("instances", `slug=eq.${encodeURIComponent(slug)}&select=*`).then((rows) => setInstance(rows[0] || null)).finally(() => setLoading(false)); }, [kind, slug, getSession()?.access_token]);
  if (route === "admin") return <AdminConsole navigate={navigate}/>;
  if (kind === "site" || kind === "contribute") { if (loading) return <div className="full-loading">Loading instance…</div>; if (!instance) return <Access slug={slug} navigate={navigate}/>; return kind === "site" ? <Directory instance={instance} navigate={navigate}/> : <ContributionForm instance={instance} navigate={navigate}/>; }
  return <Home navigate={navigate}/>;
}
