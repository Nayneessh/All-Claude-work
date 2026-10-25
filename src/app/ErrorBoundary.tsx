import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * A screen that throws (or whose lazy chunk fails to load) must never leave a blank page.
 * Nothing the user logged lives in React state — it is already in the local database — so the message says so.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error): { error: Error } { return { error }; }
  override componentDidCatch(error: Error, info: ErrorInfo): void { console.error('Screen crashed', error, info.componentStack); }
  override componentDidUpdate(prev: { resetKey?: string }): void { if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null }); }
  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    const chunk = /Loading chunk|dynamically imported module|Importing a module script failed|Failed to fetch/i.test(this.state.error.message);
    return (
      <div className="screen" role="alert">
        <div className="center mt-5">
          <h1>{chunk ? 'This screen is not available offline yet' : 'Something went wrong on this screen'}</h1>
          <p className="dim mt-2">Everything you logged is safe on this phone. {chunk ? 'Reconnect once and it will be saved for offline use.' : 'Try again, or go back to Today.'}</p>
          <div className="col mt-4">
            <button type="button" className="btn primary block" onClick={() => this.setState({ error: null })}>Try again</button>
            <Link className="btn block" to="/" onClick={() => this.setState({ error: null })}>Go to Today</Link>
          </div>
        </div>
      </div>
    );
  }
}
