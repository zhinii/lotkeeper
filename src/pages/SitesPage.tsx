import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import { navigate } from "../lib/route";
import { requireSupabase } from "../lib/supabase";
import type { Organization } from "../types";

export default function SitesPage() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    requireSupabase()
      .from("organizations")
      .select("*")
      .order("name")
      .then(({ data, error }) => {
        setOrganizations((data || []) as Organization[]);
        setMessage(error?.message || "");
        setLoading(false);
      });
  }, []);

  return (
    <div className="sites-page product-page">
      <AppHeader context="Sites" backTo="home">
        <button onClick={() => navigate("staff")}>Sign in</button>
        <button onClick={() => navigate("admin")}>Admin</button>
      </AppHeader>
      <main className="sites-main">
        <div className="product-title">
          <small>VISUAL LOCATIONS AND INVENTORY</small>
          <h1>Choose a site</h1>
          <p>
            Public sites appear here. Signed-in users also see private sites
            assigned to their account.
          </p>
        </div>
        <div className="site-choice-grid">
          {organizations.map((organization) => (
            <button
              className="site-choice-card"
              key={organization.id}
              onClick={() => navigate(`org/${organization.slug}`)}
            >
              <span className="organization-pin" aria-hidden="true" />
              <span>
                <strong>{organization.name}</strong>
                <small>
                  {organization.collections
                    .filter((item) => item.publicVisible)
                    .map((item) => item.name)
                    .join(" · ") || "Private site"}
                </small>
              </span>
              <b aria-hidden="true">→</b>
            </button>
          ))}
        </div>
        {!loading && !organizations.length && (
          <section className="friendly-empty">
            <h2>No sites are available</h2>
            <p>Sign in if you were assigned to a private site.</p>
            <button onClick={() => navigate("staff")}>Sign in</button>
          </section>
        )}
        {message && <p className="notice">{message}</p>}
      </main>
    </div>
  );
}
