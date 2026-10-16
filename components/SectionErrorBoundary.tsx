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
  }

  public componentDidUpdate(prevProps: Props) {
    // If the active route/tab changes, automatically reset the error state
    if (prevProps.activeItem !== this.props.activeItem && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleGoToChat = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onNavigate) {
      this.props.onNavigate('chat');
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 w-full min-h-[50vh] flex flex-col items-center justify-center p-6 text-center select-none animate-in fade-in duration-300">
          <div className="w-16 h-16 rounded-3xl bg-neutral-100 dark:bg-[#1A1A1E] border border-neutral-200 dark:border-white/10 flex items-center justify-center mb-4 shadow-sm text-blue-600 dark:text-blue-400">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>

          <h3 className="text-lg sm:text-xl font-black text-neutral-900 dark:text-white tracking-tight mb-2">
            Something didn't load properly
          </h3>

          <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-sm mb-6 leading-relaxed">
            Your data and active session are safe. You can retry loading this section or head right back to the chat.
          </p>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={this.handleRetry}
              className="px-5 py-2.5 rounded-xl bg-neutral-200 dark:bg-white/10 hover:bg-neutral-300 dark:hover:bg-white/15 text-neutral-800 dark:text-white text-xs sm:text-sm font-bold transition active:scale-95 cursor-pointer"
            >
              Try Again
            </button>
            <button
              type="button"
              onClick={this.handleGoToChat}
              className="px-5 py-2.5 rounded-xl bg-[#0066FF] hover:bg-blue-600 text-white text-xs sm:text-sm font-bold shadow-md shadow-blue-500/20 transition active:scale-95 cursor-pointer"
            >
              Back to Chat
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
