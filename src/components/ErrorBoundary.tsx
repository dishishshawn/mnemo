import { Component, type ReactNode } from "react";

/** Shows what broke instead of a blank page. Keyed by route so navigating away recovers. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="space-y-3 rounded-2xl border border-rose-300 bg-rose-50 p-5 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
        <p className="font-semibold">Something broke on this page.</p>
        <pre className="overflow-x-auto whitespace-pre-wrap text-xs">{this.state.error.message}</pre>
        <button className="font-semibold underline" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
