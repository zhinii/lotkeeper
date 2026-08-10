import { Component, type ErrorInfo, type ReactNode } from "react";

export default class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; message: string }
> {
  state = { failed: false, message: "" };

  static getDerivedStateFromError(error: unknown) {
    return {
      failed: true,
      message: error instanceof Error ? error.message : "Unknown screen error",
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Material Pin screen error", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-error-page">
        <section>
          <small>MATERIAL PIN</small>
          <h1>This screen could not open</h1>
          <p>
            Your photo was not submitted. Reload the screen and try again. If
            the photo still cannot be opened, choose a JPEG, PNG or WebP image.
          </p>
          <code className="app-error-detail">{this.state.message}</code>
          <button onClick={() => window.location.reload()}>Reload screen</button>
          <button
            className="secondary"
            onClick={() => {
              window.location.hash = "#/home";
              window.location.reload();
            }}
          >
            Return home
          </button>
        </section>
      </main>
    );
  }
}
