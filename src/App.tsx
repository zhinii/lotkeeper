import { useEffect, useState } from "react";
import InstallAppButton from "./components/InstallAppButton";
import AdminPage from "./pages/AdminPage";
import DirectoryPage from "./pages/DirectoryPage";
import StaffPage from "./pages/StaffPage";
import SubmitPage from "./pages/SubmitPage";
import { configured, requireSupabase } from "./lib/supabase";
import { navigate, routeFromHash } from "./lib/route";
import type { Organization } from "./types";

function SetupPage() {
  return (
    <main className="setup-page">
      <div className="brand">
        MATERIAL PIN
      </div>
      <h1>Connect the dedicated database</h1>
      <p>
        This application intentionally contains no fallback credentials. Add
        the Material Pin Supabase URL and publishable key to the deployment
        environment.
      </p>
      <code>
        VITE_SUPABASE_URL
        <br />
        VITE_SUPABASE_ANON_KEY
      </code>
      <p>Each deployment keeps its own access rules and organization data.</p>
    </main>
  );
}

function HomePage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  useEffect(() => {
    requireSupabase()
      .from("organizations")
      .select("*")
      .eq("public_access", true)
      .order("name")
      .then(({ data }) => setOrganizations((data || []) as Organization[]));
  }, []);
  return (
    <div className="home-page">
      <header className="topbar">
        <div>
          <div className="brand">MATERIAL PIN</div>
          <small>Find materials, inventory and site assets</small>
        </div>
        <div className="home-actions">
          <InstallAppButton />
          <button className="quiet-button" onClick={() => navigate("staff")}>
            Employee
          </button>
          <button className="quiet-button" onClick={() => navigate("admin")}>
            Admin
          </button>
        </div>
      </header>
      <section className="hero">
        <p>CHOOSE A SITE</p>
        <h1>Find what is there and where it is.</h1>
        <small>Select an organization to open its visual material map.</small>
      </section>
      <main className="organization-list">
        <div className="section-heading">
          <h2>Organizations</h2>
          <span>{organizations.length}</span>
        </div>
        <div className="organization-grid">
          {organizations.map((organization) => (
            <button
              className="organization-card"
              key={organization.id}
              onClick={() => navigate(`org/${organization.slug}`)}
            >
              <span className="organization-pin" aria-hidden="true">●</span>
              <div>
                <strong>{organization.name}</strong>
                <small>
                  {organization.collections
                    .filter((item) => item.publicVisible)
                    .map((item) => item.name)
                    .join(" · ")}
                </small>
              </div>
              <b aria-hidden="true">→</b>
            </button>
          ))}
        </div>
        {!organizations.length && (
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
  if (parts[0] === "staff") return <StaffPage />;
  if (parts[0] === "org" && parts[1]) return <DirectoryPage slug={parts[1]} />;
  if (parts[0] === "submit" && parts[1])
    return <SubmitPage slug={parts[1]} recordId={parts[2] || null} />;
  return <HomePage />;
}
