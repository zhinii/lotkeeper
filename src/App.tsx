import { useEffect, useState } from "react";
import AdminPage from "./pages/AdminPage";
import DirectoryPage from "./pages/DirectoryPage";
import SubmitPage from "./pages/SubmitPage";
import { configured, requireSupabase } from "./lib/supabase";
import { navigate, routeFromHash } from "./lib/route";
import type { Organization } from "./types";

function SetupPage() {
  return (
    <main className="setup-page">
      <div className="brand">
        LOTKEEPER <span>V2</span>
      </div>
      <h1>Connect the dedicated database</h1>
      <p>
        This clean rebuild intentionally contains no fallback credentials. Add
        the new Lotkeeper Supabase URL and publishable key to the deployment
        environment.
      </p>
      <code>
        VITE_SUPABASE_URL
        <br />
        VITE_SUPABASE_ANON_KEY
      </code>
      <p>Page Steel remains isolated and untouched.</p>
    </main>
  );
}

function HomePage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => {
    requireSupabase()
      .from("organizations")
      .select("*")
      .eq("public_access", true)
      .order("name")
      .then(({ data }) => setOrganizations((data || []) as Organization[]));
  }, []);
  const visible = organizations.filter((item) =>
    `${item.name} ${item.mode}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="home-page">
      <header className="topbar">
        <div className="brand">LOTKEEPER</div>
        <button onClick={() => navigate("admin")}>Admin</button>
      </header>
      <section className="hero">
        <p>VISUAL LOCATION + INVENTORY FINDER</p>
        <h1>
          Find what is there.
          <br />
          Know where it is.
        </h1>
        <div className="hero-search">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search organizations"
          />
          <button>Search</button>
        </div>
        <small>
          Purpose-built for civic spaces, commercial sites, equipment, material
          and inventory.
        </small>
      </section>
      <main className="organization-list">
        <div className="section-heading">
          <h2>Organizations</h2>
          <span>{visible.length} available</span>
        </div>
        {visible.map((organization) => (
          <button
            className="organization-card"
            key={organization.id}
            onClick={() => navigate(`org/${organization.slug}`)}
          >
            <span className={`mode-badge ${organization.mode}`}>
              {organization.mode}
            </span>
            <div>
              <strong>{organization.name}</strong>
              <small>
                {organization.collections
                  .filter(
                    (item) =>
                      item.publicVisible || organization.mode === "commercial",
                  )
                  .map((item) => item.name)
                  .join(" · ")}
              </small>
            </div>
            <b>Open →</b>
          </button>
        ))}
        {!visible.length && (
          <div className="empty">
            <h2>No organizations yet</h2>
            <p>Create the first organization from the admin console.</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const [route, setRoute] = useState(routeFromHash());
  useEffect(() => {
    const change = () => setRoute(routeFromHash());
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  if (!configured) return <SetupPage />;
  const parts = route.split("/");
  if (parts[0] === "admin") return <AdminPage />;
  if (parts[0] === "org" && parts[1]) return <DirectoryPage slug={parts[1]} />;
  if (parts[0] === "submit" && parts[1])
    return <SubmitPage slug={parts[1]} recordId={parts[2] || null} />;
  return <HomePage />;
}
