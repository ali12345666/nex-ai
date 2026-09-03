/**
 * NEX AI — Error Boundary (Phase 35)
 *
 * Catches render-time errors in any child component, preventing
 * white-screen failures. Displays a clean NEX-themed fallback
 * with a Reload action. Works across all 16 themes.
 *
 * Security: error details are logged with secret redaction; stack
 * traces are NEVER displayed to the user.
 */

import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorId: string | null;
}

export default class NexErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorId: null };
  }

  static getDerivedStateFromError(_error: Error): ErrorBoundaryState {
    return { hasError: true, errorId: `err-${Date.now()}` };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Safe logging: redact potential secrets, no stack trace to console in production
    const safeMessage = String(error?.message || 'Unknown error').slice(0, 200);
    // Check for common secret patterns and redact
    const redacted = safeMessage
      .replace(/sk-[a-zA-Z0-9]{20,}/g, '***REDACTED***')
      .replace(/ghp_[a-zA-Z0-9]{36,}/g, '***REDACTED***')
      .replace(/github_pat_[a-zA-Z0-9_]{22,}/g, '***REDACTED***')
      .replace(/Bearer\s+[a-zA-Z0-9\-\.]{20,}/g, 'Bearer ***REDACTED***');

    console.warn(`[NEX AI ErrorBoundary] ${this.state.errorId}: ${redacted}`);
    // In dev, log component stack for debugging
    if (process.env.NODE_ENV === 'development') {
      console.warn('[NEX AI ErrorBoundary] Component stack:', errorInfo?.componentStack?.slice(0, 500));
    }
  }

  handleReload = () => {
    this.setState({ hasError: false, errorId: null });
    // Full page reload ensures clean state
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  handleDismiss = () => {
    this.setState({ hasError: false, errorId: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex flex-col items-center justify-center h-screen w-screen nex-cosmic-bg"
          style={{ background: 'var(--nex-bg)', color: 'var(--nex-text)' }}
          role="alert"
          aria-label="An error occurred"
        >
          <div
            className="flex items-center justify-center rounded-full mb-4"
            style={{
              width: 48, height: 48,
              background: 'rgba(255, 59, 92, 0.1)',
              border: '1px solid rgba(255, 59, 92, 0.3)',
            }}
          >
            <AlertTriangle size={22} style={{ color: 'var(--nex-error)' }} />
          </div>

          <h1
            className="text-lg font-semibold mb-2"
            style={{ color: 'var(--nex-text)' }}
          >
            Something went wrong
          </h1>

          <p
            className="text-xs mb-1"
            style={{ color: 'var(--nex-text-muted)' }}
          >
            NEX AI encountered an unexpected error.
          </p>
          <p className="text-[10px] mb-6" style={{ color: 'var(--nex-text-muted)' }}>
            Error ID: {this.state.errorId}
          </p>

          <div className="flex items-center gap-3">
            <button
              onClick={this.handleReload}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium nex-click"
              style={{
                color: 'var(--nex-bg)',
                background: 'linear-gradient(135deg, var(--nex-accent), var(--nex-accent-secondary))',
              }}
              aria-label="Reload NEX AI"
            >
              <RefreshCw size={12} />
              Reload NEX AI
            </button>
            <button
              onClick={this.handleDismiss}
              className="px-4 py-2 rounded-lg text-xs nex-click"
              style={{
                color: 'var(--nex-text-dim)',
                border: '1px solid var(--nex-glass-border)',
                background: 'var(--nex-glass-bg)',
              }}
              aria-label="Try to continue without reloading"
            >
              Try to Continue
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
