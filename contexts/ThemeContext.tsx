import { db, get, ref as dbRef, update } from '@/lib/backend';
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { readCachedJson, writeCachedJson } from '../utils/cache';
import { supabaseAuthService } from '../services/supabaseAuthService';

export type ThemeSetting = 'system' | 'light' | 'dark';
export type Mode = 'light' | 'dark';

interface ThemeContextType {
  mode: Mode;
  themeSetting: ThemeSetting;
  setThemeSetting: (setting: ThemeSetting) => void;
  setMode: (mode: Mode) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeSetting, setThemeSettingState] = useState<ThemeSetting>(() => {
    return readCachedJson<ThemeSetting>('app_theme_setting', 'system');
  });
  const [userUid, setUserUid] = useState<string | null>(null);

  const getSystemTheme = useCallback((): Mode => {
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }, []);

  const [systemMode, setSystemMode] = useState<Mode>(() => getSystemTheme());

  // Listen to OS system color scheme changes dynamically
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      setSystemMode(e.matches ? 'dark' : 'light');
    };

    setSystemMode(mediaQuery.matches ? 'dark' : 'light');

    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    } else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, []);

  useEffect(() => {
    const savedSetting = readCachedJson<ThemeSetting>('app_theme_setting', 'system');
    if (savedSetting) setThemeSettingState(savedSetting);

    const unsubscribe = supabaseAuthService.onAuthStateChanged(async (user) => {
      if (user) {
        setUserUid(user.id);
        try {
          const prefsRef = dbRef(db, `users/${user.id}/theme_preferences`);
          const snapshot = await get(prefsRef);
          if (snapshot.exists()) {
            const data = snapshot.val();
            if (data?.themeSetting) {
              setThemeSettingState(data.themeSetting);
              writeCachedJson('app_theme_setting', data.themeSetting, user.id);
            } else if (data?.mode) {
              setThemeSettingState(data.mode as ThemeSetting);
              writeCachedJson('app_theme_setting', data.mode as ThemeSetting, user.id);
            }
          }
        } catch (err) {
          console.error("Error loading theme prefs:", err);
        }
      } else {
        setUserUid(null);
      }
    });

    return () => unsubscribe();
  }, []);

  const effectiveMode: Mode = themeSetting === 'system' ? systemMode : themeSetting;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (effectiveMode === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [effectiveMode]);

  const updateThemePref = (setting: ThemeSetting) => {
    if (userUid) {
      try {
        update(dbRef(db, `users/${userUid}/theme_preferences`), {
          themeSetting: setting,
          mode: setting,
        });
      } catch (err) {
        console.error("Failed to update theme preferences:", err);
      }
    }
  };

  const setThemeSetting = (newSetting: ThemeSetting) => {
    setThemeSettingState(newSetting);
    writeCachedJson('app_theme_setting', newSetting, userUid || 'global');
    updateThemePref(newSetting);
  };

  const setMode = (newMode: Mode) => {
    setThemeSetting(newMode);
  };

  return (
    <ThemeContext.Provider value={{ mode: effectiveMode, themeSetting, setThemeSetting, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
