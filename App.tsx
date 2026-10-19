import React, { useEffect } from 'react';
import { MainContent } from './MainContent';
import { Capacitor } from '@capacitor/core';
import { listenToKeyboard } from './utils/capacitorUtils';

export function App() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const viewport = (window as any).visualViewport;
    const applyKeyboardViewportOffset = () => {
      if (!viewport) {
        document.documentElement.style.setProperty('--keyboard-offset', '0px');
        return;
      }

      const keyboardOffset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop
      );

      document.documentElement.style.setProperty('--keyboard-offset', `${keyboardOffset}px`);
    };

    applyKeyboardViewportOffset();

    if (viewport) {
      viewport.addEventListener('resize', applyKeyboardViewportOffset);
      viewport.addEventListener('scroll', applyKeyboardViewportOffset);
    }

    const cleanup = listenToKeyboard(
      () => {
        applyKeyboardViewportOffset();
      },
      () => {
        document.documentElement.style.setProperty('--keyboard-offset', '0px');
      }
    );

    return () => {
      cleanup();
      document.documentElement.style.setProperty('--keyboard-offset', '0px');
      if (viewport) {
        viewport.removeEventListener('resize', applyKeyboardViewportOffset);
        viewport.removeEventListener('scroll', applyKeyboardViewportOffset);
      }
    };
  }, []);

  return (
    <div style={{ overflow: 'hidden', paddingBottom: 'var(--keyboard-offset, 0px)' }}>
      <MainContent />
    </div>
  );
}

export default App;
