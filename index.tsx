import './utils/domPolyfill';
import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

const OTA_RELOAD_DELAY_MS = 1500;
let reloadScheduled = false;

const isOtaChunkFailure = (value?: string | null, stack?: string | null) => {
  const candidate = `${value || ''} ${stack || ''}`.toLowerCase();
  return (
    candidate.includes('chunkloaderror') ||
    candidate.includes('failed to fetch dynamically imported module') ||
    candidate.includes('loading chunk') ||
    candidate.includes('minified react error') ||
    candidate.includes('unexpected application error') ||
    candidate.includes('update applied')
  );
};

const triggerToast = (message: string, type: 'info' | 'warning' | 'error' = 'info', duration = 3000) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('avelut_toast', {
      detail: { message, type, duration },
    })
  );
};

const scheduleReload = (reason: string) => {
  if (typeof window === 'undefined' || reloadScheduled) return;
  reloadScheduled = true;

  triggerToast('Update applied. Restarting…', 'info', 1800);
  console.warn(`[app-shell] Reloading after ${reason}...`);

  setTimeout(() => {
    try {
      if (Capacitor.isNativePlatform()) {
        CapacitorUpdater.reload().catch(() => window.location.reload());
      } else {
        window.location.reload();
      }
    } catch {
      window.location.reload();
    }
  }, OTA_RELOAD_DELAY_MS);
};

const handleFatalRuntimeIssue = (label: string, reason?: unknown) => {
  const errorText = typeof reason === 'string' ? reason : reason && typeof (reason as any).message === 'string' ? (reason as any).message : '';
  const stackText = reason && typeof (reason as any).stack === 'string' ? (reason as any).stack : '';

  if (isOtaChunkFailure(errorText, stackText)) {
    scheduleReload(label);
    return;
  }

  // Keep the existing UI alive for non-fatal runtime problems. Only surface a brief toast.
  triggerToast('A temporary issue was detected. Your session is still active.', 'warning', 2500);
};

// Immediately notify native layer that JavaScript loaded successfully.
// This prevents Capgo's automatic rollback timer from reverting OTA updates.
if (Capacitor.isNativePlatform()) {
  CapacitorUpdater.notifyAppReady().catch((e) => {
    console.warn('[OTA] Early notifyAppReady error:', e);
  });
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ToastProvider } from './hooks/useToast';
import { RootErrorBoundary } from './components/RootErrorBoundary';

// Automatically reload the page if a dynamically imported module fails to load.
window.addEventListener('vite:preloadError', () => {
  scheduleReload('vite preload error');
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const message = reason && typeof reason === 'object' && 'message' in reason ? String((reason as any).message) : String(reason || '');
  const stack = reason && typeof reason === 'object' && 'stack' in reason ? String((reason as any).stack) : '';

  if (isOtaChunkFailure(message, stack)) {
    event.preventDefault();
    event.stopPropagation();
    scheduleReload('chunk / module load failure');
    return;
  }

  handleFatalRuntimeIssue('unhandled rejection', reason);
});

window.addEventListener('error', (event) => {
  const message = event.message || '';
  const stack = event.error && typeof event.error === 'object' && 'stack' in event.error ? String((event.error as any).stack) : '';

  if (
    message &&
    (
      message.includes('reportAllChanges') ||
      (message.includes('startTime') && (event.filename?.includes('VM') || !event.filename))
    )
  ) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (isOtaChunkFailure(message, stack)) {
    event.preventDefault();
    event.stopPropagation();
    scheduleReload('chunk / script error');
    return;
  }

  handleFatalRuntimeIssue('global runtime error', event.error || message);
}, true);

import { HelmetProvider } from 'react-helmet-async';
import { ThemeProvider } from './contexts/ThemeContext';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const appContent = (
  <React.StrictMode>
    <RootErrorBoundary>
      <HelmetProvider>
        <ThemeProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ThemeProvider>
      </HelmetProvider>
    </RootErrorBoundary>
  </React.StrictMode>
);

const root = ReactDOM.createRoot(rootElement);
root.render(appContent);

if (Capacitor.isNativePlatform()) {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const reg of registrations) {
        reg.unregister().catch(() => {});
      }
    }).catch(() => {});
  }
  if (typeof window !== 'undefined' && 'caches' in window) {
    caches.keys().then((keys) => {
      for (const key of keys) {
        caches.delete(key).catch(() => {});
      }
    }).catch(() => {});
  }
} else if ('serviceWorker' in navigator && typeof window !== 'undefined') {
  navigator.serviceWorker.register('/service-worker.js')
    .then((reg) => {
      console.log('Service Worker registered successfully:', reg.scope);
      void reg.update().catch(() => {});
    })
    .catch((err) => console.warn('Service Worker registration failed:', err));
}
