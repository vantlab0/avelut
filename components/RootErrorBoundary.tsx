import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class RootErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[RootErrorBoundary] Caught unhandled React error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  private handleClearAndReload = () => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('active_conversation_id');
        sessionStorage.clear();
      } catch {}
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          width: '100vw',
          backgroundColor: '#0F172A',
          color: '#F8FAFC',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          boxSizing: 'border-box',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          textAlign: 'center',
        }}>
          <div style={{
            width: '56px',
            height: '56px',
            borderRadius: '16px',
            backgroundColor: '#1E293B',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '18px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}>
            <svg style={{ width: '28px', height: '28px', color: '#38BDF8' }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>

          <h2 style={{ fontSize: '20px', fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
            Application Reload Needed
          </h2>
          <p style={{ fontSize: '14px', color: '#94A3B8', margin: '0 0 24px', maxWidth: '380px', lineHeight: 1.5 }}>
            A temporary display error occurred. Tapping below will refresh the workspace seamlessly.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '280px' }}>
            <button
              onClick={this.handleReload}
              style={{
                backgroundColor: '#0066FF',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: '12px',
                padding: '12px 20px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              Refresh App
            </button>
            <button
              onClick={this.handleClearAndReload}
              style={{
                backgroundColor: 'transparent',
                color: '#94A3B8',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                borderRadius: '12px',
                padding: '10px 20px',
                fontSize: '13px',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              Reset Cache & Reload
            </button>
          </div>

          {process.env.NODE_ENV !== 'production' && this.state.error && (
            <div style={{ marginTop: '30px', textAlign: 'left', maxWidth: '90vw', overflowX: 'auto', backgroundColor: '#020617', padding: '12px', borderRadius: '8px', fontSize: '11px', color: '#F87171' }}>
              <pre>{this.state.error.toString()}</pre>
            </div>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}

export default RootErrorBoundary;
