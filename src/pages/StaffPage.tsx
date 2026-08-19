import { useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import { permissionsFor, roleLabel } from "../lib/permissions";
import { navigate } from "../lib/route";
import { requireSupabase } from "../lib/supabase";
import type { Organization, OrganizationMembership } from "../types";

export default function StaffPage() {
  const [session, setSession] = useState<any>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [memberships, setMemberships] = useState<
    Record<string, OrganizationMembership>
  >({});
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [loadingOrganizations, setLoadingOrganizations] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const client = requireSupabase();
    client.auth.getSession().then(({ data }) => setSession(data.session));
    return client.auth.onAuthStateChange((_event, next) => setSession(next))
      .data.subscription.unsubscribe;
  }, []);

  useEffect(() => {
    if (!session) {
      setOrganizations([]);
      setMemberships({});
      setSelectedOrganizationId("");
      return;
    }
    const client = requireSupabase();
    setLoadingOrganizations(true);
    Promise.all([
      client.from("organizations").select("*").order("name"),
      client
        .from("organization_members")
        .select("organization_id,user_id,role,permissions")
        .eq("user_id", session.user.id),
      client.from("platform_admins").select("user_id").limit(1),
    ]).then(([orgRows, memberRows, platformRows]) => {
      if (orgRows.error) setMessage(orgRows.error.message);
      const availableOrganizations = (orgRows.data || []) as Organization[];
      const assigned = Object.fromEntries(
        ((memberRows.data || []) as OrganizationMembership[]).map((item) => [
          item.organization_id,
          item,
        ]),
      );
      if (platformRows.data?.length)
        availableOrganizations.forEach((organization) => {
          assigned[organization.id] = {
            organization_id: organization.id,
            user_id: session.user.id,
            role: "admin",
            permissions: {},
          };
        });
      const assignedOrganizations = platformRows.data?.length
        ? availableOrganizations
        : availableOrganizations.filter(
            (organization) => assigned[organization.id],
          );
      setOrganizations(assignedOrganizations);
      setMemberships(assigned);
      setSelectedOrganizationId((current) =>
        assignedOrganizations.some(
          (organization) => organization.id === current,
        )
          ? current
          : "",
      );
      setLoadingOrganizations(false);
    });
  }, [session]);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { error } = await requireSupabase().auth.signInWithPassword({
      email: String(form.get("email") || ""),
      password: String(form.get("password") || ""),
    });
    if (error) setMessage(error.message);
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const password = String(form.get("new_password") || "");
    if (password.length < 10)
      return setMessage("Use at least 10 characters for the new password.");
    const { error } = await requireSupabase().auth.updateUser({ password });
    if (error) return setMessage(error.message);
    formElement.reset();
    setMessage("Password changed.");
  }

  if (!session) {
    return (
      <main className="access-page">
        <button className="access-back" onClick={() => navigate("home")}>
          ← Public site
        </button>
        <section className="access-card">
          <div className="brand">MATERIAL PIN</div>
          <small>TEAM ACCESS</small>
          <h1>Open your Material Pin sites</h1>
          <p>
            Your site administrator controls which finder, capture, inventory,
            and management tools appear after sign-in.
          </p>
          <form onSubmit={signIn}>
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button>Sign in</button>
          </form>
          {message && <p className="notice">{message}</p>}
        </section>
      </main>
    );
  }

  const selectedOrganization = organizations.find(
    (organization) => organization.id === selectedOrganizationId,
  );
  const selectedMembership = selectedOrganization
    ? memberships[selectedOrganization.id]
    : null;
  const selectedPermissions = permissionsFor(selectedMembership);

  return (
    <div className="staff-page">
      <AppHeader context="My sites" backTo="home">
        <button onClick={() => navigate("sites")}>Browse sites</button>
        <button onClick={() => requireSupabase().auth.signOut()}>
          Sign out
        </button>
      </AppHeader>
      <main className="staff-organizations">
        {!selectedOrganization ? (
          <>
            <small>YOUR ORGANIZATIONS</small>
            <h1>Choose where you are working</h1>
            <p className="staff-choice-intro">
              Select an organization before opening its finder, inventory, or
              management tools.
            </p>
            {loadingOrganizations ? (
              <div className="friendly-empty">Loading your organizations…</div>
            ) : (
              <div className="staff-site-grid">
                {organizations.map((organization) => {
                  const membership = memberships[organization.id];
                  return (
                    <button
                      className="staff-site-choice"
                      key={organization.id}
                      onClick={() => setSelectedOrganizationId(organization.id)}
                    >
                      <span className="organization-pin" aria-hidden="true" />
                      <span>
                        <strong>{organization.name}</strong>
                        <small>
                          {roleLabel(membership?.role)} ·{" "}
                          {organization.collections.length} item groups
                        </small>
                      </span>
                      <b aria-hidden="true">→</b>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <button
              className="staff-change-site"
              onClick={() => setSelectedOrganizationId("")}
            >
              ← Choose another organization
            </button>
            <section className="staff-workspace-heading">
              <span className="organization-pin" aria-hidden="true" />
              <div>
                <small>{roleLabel(selectedMembership?.role)}</small>
                <h1>{selectedOrganization.name}</h1>
                <p>Choose what you need to do.</p>
              </div>
            </section>
            <div className="staff-workspace-actions">
              <button
                onClick={() => navigate(`org/${selectedOrganization.slug}`)}
              >
                <span>⌖</span>
                <b>Visual finder</b>
                <small>Search photos, details, and mapped locations.</small>
              </button>
              {selectedPermissions.viewInventory && (
                <button
                  onClick={() =>
                    navigate(`inventory/${selectedOrganization.slug}`)
                  }
                >
                  <span>▦</span>
                  <b>
                    {selectedPermissions.adjustInventory
                      ? "Inventory & checkout"
                      : "View inventory"}
                  </b>
                  <small>
                    {selectedPermissions.adjustInventory
                      ? "Check stock, update quantities, and record sales."
                      : "Check stock levels, SKUs, and locations."}
                  </small>
                </button>
              )}
              {selectedPermissions.addItems && (
                <button
                  onClick={() =>
                    navigate(`submit/${selectedOrganization.slug}`)
                  }
                >
                  <span>＋</span>
                  <b>Add an item</b>
                  <small>Capture a photo and send the item for review.</small>
                </button>
              )}
              {selectedMembership?.role === "admin" && (
                <button
                  onClick={() => navigate(`admin/${selectedOrganization.slug}`)}
                >
                  <span>⚙</span>
                  <b>Admin console</b>
                  <small>
                    Review, manage people, and change site settings.
                  </small>
                </button>
              )}
            </div>
          </>
        )}
        {!loadingOrganizations && !organizations.length && (
          <div className="empty">
            <h2>No assigned sites</h2>
            <p>Ask an administrator to add this account to an organization.</p>
          </div>
        )}
        <details className="employee-account-settings">
          <summary>Change my password</summary>
          <form onSubmit={changePassword}>
            <label>
              New password
              <input
                name="new_password"
                type="password"
                minLength={10}
                autoComplete="new-password"
                required
              />
            </label>
            <button>Save new password</button>
          </form>
        </details>
        {message && <p className="notice">{message}</p>}
      </main>
    </div>
  );
}
