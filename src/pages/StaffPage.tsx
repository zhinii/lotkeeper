import { useEffect, useState } from "react";
import { navigate } from "../lib/route";
import { requireSupabase } from "../lib/supabase";
import type { Organization } from "../types";

export default function StaffPage() {
  const [session, setSession] = useState<any>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const client = requireSupabase();
    client.auth.getSession().then(({ data }) => setSession(data.session));
    return client.auth.onAuthStateChange((_event, next) => setSession(next))
      .data.subscription.unsubscribe;
  }, []);

  useEffect(() => {
    if (!session) return;
    requireSupabase()
      .from("organizations")
      .select("*")
      .order("name")
      .then(({ data, error }) => {
        if (error) setMessage(error.message);
        setOrganizations((data || []) as Organization[]);
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
          <small>EMPLOYEE ACCESS</small>
          <h1>Update the material map</h1>
          <p>
            Employees can add items, move pins, update photos and adjust
            inventory.
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

  return (
    <div className="staff-page">
      <header className="topbar">
        <div>
          <div className="brand">MATERIAL PIN</div>
          <small>Employee workspace</small>
        </div>
        <div className="home-actions">
          <button onClick={() => navigate("home")}>Public site</button>
          <button onClick={() => requireSupabase().auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="staff-organizations">
        <small>YOUR SITES</small>
        <h1>Choose where you are working</h1>
        <div className="organization-grid">
          {organizations.map((organization) => (
            <button
              className="organization-card"
              key={organization.id}
              onClick={() => navigate(`org/${organization.slug}`)}
            >
              <span className="organization-pin" aria-hidden="true">
                ●
              </span>
              <div>
                <strong>{organization.name}</strong>
                <small>{organization.collections.length} item groups</small>
              </div>
              <b aria-hidden="true">→</b>
            </button>
          ))}
        </div>
        {!organizations.length && (
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
