import type { ReactNode } from "react";
import { navigate } from "../lib/route";

export default function AppHeader({
  context,
  backTo,
  children,
}: {
  context?: string;
  backTo?: string;
  children?: ReactNode;
}) {
  return (
    <header className="app-header">
      <div className="app-header-identity">
        {backTo && (
          <button
            type="button"
            className="app-header-back"
            onClick={() => navigate(backTo)}
            aria-label="Go back"
          >
            ←
          </button>
        )}
        <button
          type="button"
          className="app-brand-button"
          onClick={() => navigate("home")}
        >
          <span className="app-brand-pin" aria-hidden="true" />
          <span>
            <b>MATERIAL PIN</b>
            {context && <small>{context}</small>}
          </span>
        </button>
      </div>
      {children && <nav className="app-header-actions">{children}</nav>}
    </header>
  );
}
