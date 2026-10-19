import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

const isOtaChunkFailure = (message: string = '', stack: string = '') => {
  const combined = `${message} ${stack}`.toLowerCase();
  return (
    combined.includes('chunkloaderror') ||
    combined.includes('failed to fetch dynamically imported module') ||
    combined.includes('loading chunk') ||
    combined.includes('update applied') ||
    combined.includes('minified react error') ||
    combined.includes('unexpected application error')
  );
};

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

    if (typeof window !== 'undefined' && isOtaChunkFailure(error.message, errorInfo?.componentStack || '')) {
      window.dispatchEvent(new CustomEvent('avelut_ota_chunk_detected', {
        detail: {
          message: 'Update applied. Restarting…',
          reason: 'chunk_error',
        },
      }));
    }
  }

  public render() {
    if (this.state.hasError) {
      // Intentionally do not render the fullscreen crash UI. We let the app-level
      // global error handler decide whether to silently reload for OTA/chunk failures
      // and keep the current view alive for non-fatal errors.
      return this.props.children;
    }

    return this.props.children;
  }
}

export default RootErrorBoundary;
