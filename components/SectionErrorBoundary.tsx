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

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('avelut_toast', {
          detail: {
            message: 'A minor display hiccup was detected. Keeping your session active.',
            type: 'warning',
            duration: 3000,
          },
        })
      );
    }

    if (this.props.activeItem && this.props.activeItem !== 'chat' && this.props.onNavigate) {
      this.props.onNavigate('chat');
    }

    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = setTimeout(() => {
      this.setState({ hasError: false, error: null });
    }, 150);
  }

  public componentDidUpdate(prevProps: Props) {
    if (prevProps.activeItem !== this.props.activeItem && this.state.hasError) {
      if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
      this.setState({ hasError: false, error: null });
    }
  }

  public componentWillUnmount() {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
  }

  public render() {
    return this.props.children;
  }
}
