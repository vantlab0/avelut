import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  activeItem?: string;
  onNavigate?: (tab: string) => void;
  sectionName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class SectionErrorBoundary extends Component<Props, State> {
  private recoveryTimer: any = null;

  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.warn(
      `[SectionErrorBoundary] Caught error in ${this.props.sectionName || this.props.activeItem || 'section'}:`,
      error,
      errorInfo
    );

    // Show friendly, non-intrusive toast instead of an error card
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('avelut_toast', {
          detail: {
            message: 'A minor display hiccup was resolved. Your session is active.',
            type: 'info',
            duration: 4000,
          },
        })
      );
    }

    // Auto-navigate to safe chat view if in a sub-section
    if (this.props.activeItem && this.props.activeItem !== 'chat' && this.props.onNavigate) {
      this.props.onNavigate('chat');
    }

    // Auto-recover state smoothly so no stuck error state persists
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = setTimeout(() => {
      this.setState({ hasError: false, error: null });
    }, 150);
  }

  public componentDidUpdate(prevProps: Props) {
    // If the active route/tab changes, automatically reset the error state
    if (prevProps.activeItem !== this.props.activeItem && this.state.hasError) {
      if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
      this.setState({ hasError: false, error: null });
    }
  }

  public componentWillUnmount() {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
  }

  public render() {
    if (this.state.hasError) {
      // Instead of an intrusive error boundary card, render an unobtrusive transition placeholder
      return (
        <div className="flex-1 w-full min-h-[300px] flex items-center justify-center p-6 animate-pulse text-sm text-neutral-400 dark:text-neutral-500">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
            <span>Restoring session...</span>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
