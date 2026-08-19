import { useEffect, useState } from "react";
import InstallAppButton from "./components/InstallAppButton";
import AdminPage from "./pages/AdminPage";
import DirectoryPage from "./pages/DirectoryPage";
import InventoryPage from "./pages/InventoryPage";
import MoveItemPage from "./pages/MoveItemPage";
import PosPage from "./pages/PosPage";
import SitesPage from "./pages/SitesPage";
import StaffPage from "./pages/StaffPage";
import SubmitPage from "./pages/SubmitPage";
import { configured } from "./lib/supabase";
import { navigate, routeFromHash } from "./lib/route";

function SetupPage() {
  return (
    <main className="setup-page">
      <div className="brand">MATERIAL PIN</div>
      <h1>Connect the dedicated database</h1>
      <p>
        This application intentionally contains no fallback credentials. Add the
        Material Pin Supabase URL and publishable key to the deployment
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
  return (
    <div className="home-page product-home">
      <header className="marketing-header">
        <button className="marketing-brand" onClick={() => navigate("home")}>
          <span className="app-brand-pin" aria-hidden="true" />
          <b>MATERIAL PIN</b>
        </button>
        <nav>
          <InstallAppButton />
          <button onClick={() => navigate("sites")}>Open a site</button>
          <button className="primary" onClick={() => navigate("staff")}>
            Sign in
          </button>
        </nav>
      </header>
      <main>
        <section className="marketing-hero">
          <div>
            <small>VISUAL LOCATION + INVENTORY</small>
            <h1>Find it fast. Know what is there.</h1>
            <p>
              Material Pin connects photos, searchable details, physical
              locations, and inventory activity across yards, stores,
              warehouses, parks, and large sites.
            </p>
            <div className="marketing-cta">
              <button onClick={() => navigate("sites")}>Open a site</button>
              <button onClick={() => navigate("staff")}>
                Employee sign in
              </button>
            </div>
          </div>
          <div
            className="hero-product-preview"
            aria-label="Material Pin overview"
          >
            <div className="preview-search">
              <span>⌕</span>
              <b>Search by name, photo, SKU, or location</b>
            </div>
            <div className="preview-layout">
              <div>
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="preview-map">
                <span>●</span>
                <span>●</span>
                <span>●</span>
              </div>
            </div>
          </div>
        </section>
        <section className="product-two-jobs product-core-modules">
          <article>
            <small>01 · VISUAL FINDER</small>
            <h2>See it, search it, locate it</h2>
            <p>
              Photo-heavy results stay beside a map or uploaded site plan.
              Search like a catalog, then open the exact pin and details.
            </p>
            <ul>
              <li>Text, filter, and AI photo search</li>
              <li>GPS maps, uploaded floor plans, or generated grids</li>
              <li>New inventory, reusable assets, leftovers, and scrap</li>
            </ul>
          </article>
          <article>
            <small>02 · INVENTORY TRACKER</small>
            <h2>Manage stock without crowding the map</h2>
            <p>
              A separate operational workspace shows SKUs, locations,
              quantities, status, and a clear change history.
            </p>
            <ul>
              <li>Receive, use, and count inventory</li>
              <li>Category-first browsing and fast search</li>
              <li>Accountable updates and administrator alerts</li>
            </ul>
          </article>
          <article>
            <small>03 · CHECKOUT / POS</small>
            <h2>Record the sale and update stock once</h2>
            <p>
              Employees build a multi-item checkout with customer, price, tax,
              and reference details. Completing it updates every quantity and
              preserves the sale history.
            </p>
            <ul>
              <li>Permission-controlled checkout workspace</li>
              <li>Multi-item cart, prices, tax, and customer reference</li>
              <li>
                Billing record without pretending to process card payments
              </li>
            </ul>
          </article>
        </section>
        <section className="role-explainer">
          <div>
            <small>RIGHT ACCESS FOR EACH PERSON</small>
            <h2>Simple roles, controlled actions</h2>
            <p>
              People see only the tools they need. Site administrators can tune
              employee permissions without changing the database.
            </p>
          </div>
          <div className="role-grid">
            <article>
              <b>Platform admin</b>
              <span>All organizations and deployments</span>
            </article>
            <article>
              <b>Site admin</b>
              <span>One site's settings, users, approvals, and inventory</span>
            </article>
            <article>
              <b>Employee</b>
              <span>Only the actions granted by a site admin</span>
            </article>
            <article>
              <b>Viewer</b>
              <span>Read-only access where the site allows it</span>
            </article>
          </div>
        </section>
        <section className="ai-explainer">
          <span>AI</span>
          <div>
            <h2>Faster entry, always reviewed</h2>
            <p>
              AI can suggest names, categories, descriptions, visible
              identifiers, and search terms from a photo. It never publishes or
              changes stock by itself; a person confirms the result.
            </p>
          </div>
        </section>
      </main>
      <footer className="marketing-footer">
        <b>MATERIAL PIN</b>
        <span>Built for physical places and the things inside them.</span>
        <button onClick={() => navigate("admin")}>Administrator sign in</button>
      </footer>
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
  if (parts[0] === "admin") return <AdminPage initialSlug={parts[1] || null} />;
  if (parts[0] === "staff") return <StaffPage />;
  if (parts[0] === "sites") return <SitesPage />;
  if (parts[0] === "org" && parts[1]) return <DirectoryPage slug={parts[1]} />;
  if (parts[0] === "inventory" && parts[1])
    return <InventoryPage slug={parts[1]} />;
  if (parts[0] === "pos" && parts[1])
    return <PosPage slug={parts[1]} initialRecordId={parts[2] || null} />;
  if (parts[0] === "move" && parts[1] && parts[2])
    return <MoveItemPage slug={parts[1]} recordId={parts[2]} />;
  if (parts[0] === "submit" && parts[1])
    return <SubmitPage slug={parts[1]} recordId={parts[2] || null} />;
  return <HomePage />;
}
