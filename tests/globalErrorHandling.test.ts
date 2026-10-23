import { describe, it, expect, vi, beforeEach } from 'vitest';

// Setup minimal DOM globals for node environment
if (typeof global.window === 'undefined') {
  class CustomEventMock extends Event {
    detail: any;
    constructor(message: string, data?: any) {
      super(message);
      this.detail = data?.detail;
    }
  }

  const listeners: Record<string, Function[]> = {};
  const mockWindow = {
    dispatchEvent: (evt: any) => {
      const fnList = listeners[evt.type] || [];
      fnList.forEach((fn) => fn(evt));
      return true;
    },
    addEventListener: (type: string, fn: Function) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
    removeEventListener: (type: string, fn: Function) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter((f) => f !== fn);
      }
    },
    location: { reload: vi.fn() },
  };

  (global as any).window = mockWindow;
  (global as any).CustomEvent = CustomEventMock;
}

const mockNavigator = { onLine: true };
try {
  Object.defineProperty(globalThis, 'navigator', {
    value: mockNavigator,
    writable: true,
    configurable: true,
  });
} catch {
  // navigator might already exist
}

import {
  isOtaChunkFailure,
  handleNonFatalError,
  triggerToast,
  clearToastThrottleCache,
} from '../index';

describe('Global Error Handling & Toast Throttling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearToastThrottleCache();
    mockNavigator.onLine = true;
  });

  describe('isOtaChunkFailure', () => {
    it('identifies OTA and chunk load failure signatures', () => {
      expect(isOtaChunkFailure('ChunkLoadError: Loading chunk 5 failed')).toBe(true);
      expect(isOtaChunkFailure('Failed to fetch dynamically imported module')).toBe(true);
      expect(isOtaChunkFailure('Minified React error #418; visit https://react.dev/...')).toBe(true);
      expect(isOtaChunkFailure('unexpected application error')).toBe(true);
      expect(isOtaChunkFailure('Error: loading chunk 123')).toBe(true);
    });

    it('returns false for standard application errors', () => {
      expect(isOtaChunkFailure('TypeError: Cannot read properties of undefined')).toBe(false);
      expect(isOtaChunkFailure('SyntaxError: Unexpected token')).toBe(false);
      expect(isOtaChunkFailure('User profile missing')).toBe(false);
    });
  });

  describe('handleNonFatalError', () => {
    it('logs diagnostic info to console.warn without dispatching generic toast for standard errors', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');

      handleNonFatalError('unhandled rejection', new Error('Database connection timeout'));

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[global-error] Non-fatal runtime issue caught (unhandled rejection):',
        'Error: Database connection timeout'
      );

      expect(dispatchEventSpy).not.toHaveBeenCalled();
    });

    it('triggers warning toast when explicitly offline', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');

      mockNavigator.onLine = false;

      handleNonFatalError('network error', new Error('Failed to fetch'));

      expect(dispatchEventSpy).toHaveBeenCalledTimes(1);
      const event = dispatchEventSpy.mock.calls[0][0] as CustomEvent;
      expect(event.type).toBe('avelut_toast');
      expect(event.detail.message).toBe('Network connection lost. Your session is still active.');
      expect(event.detail.type).toBe('warning');
    });
  });

  describe('triggerToast deduplication & throttling', () => {
    it('throttles identical toast messages sent within short succession', () => {
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');

      triggerToast('Test message', 'info');
      triggerToast('Test message', 'info');
      triggerToast('Test message', 'info');

      expect(dispatchEventSpy).toHaveBeenCalledTimes(1);
    });

    it('allows different toast messages or types to pass through', () => {
      const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');

      triggerToast('First message', 'info');
      triggerToast('Second message', 'info');
      triggerToast('First message', 'warning');

      expect(dispatchEventSpy).toHaveBeenCalledTimes(3);
    });
  });
});
