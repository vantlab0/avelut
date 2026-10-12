import { useState, useEffect, useCallback } from 'react';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/lib/supabaseClient';

export type OTAUpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

interface OTAState {
    status: OTAUpdateStatus;
    newVersion: string | null;
    downloadProgress: number;
    errorMsg?: string;
}

// Global shared state across all hook subscribers
let globalState: OTAState = {
    status: 'idle',
    newVersion: null,
    downloadProgress: 0,
};

const listeners = new Set<(state: OTAState) => void>();

function setGlobalState(updater: Partial<OTAState> | ((prev: OTAState) => Partial<OTAState>)) {
    const next = typeof updater === 'function' ? updater(globalState) : updater;
    globalState = { ...globalState, ...next };
    listeners.forEach(l => l(globalState));
}

let isInitialized = false;
let checkInFlightPromise: Promise<void> | null = null;
let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;
let pollIntervalTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Splits version strings on dots and dashes to handle semver + timestamp:
 * e.g. "6.0.3-1791121323523" -> [6, 0, 3, 1791121323523]
 */
function parseVersionParts(ver: string): number[] {
    if (!ver) return [0];
    return ver
        .replace(/^v/i, '')
        .split(/[.-]/)
        .map(p => {
            const n = parseInt(p, 10);
            return Number.isNaN(n) ? 0 : n;
        });
}

function isVersionHigher(newVer: string, currentVer: string): boolean {
    if (!currentVer) return true;
    if (newVer === currentVer) return false;

    const n = parseVersionParts(newVer);
    const c = parseVersionParts(currentVer);
    const maxLen = Math.max(n.length, c.length);

    for (let i = 0; i < maxLen; i++) {
        const nPart = n[i] ?? 0;
        const cPart = c[i] ?? 0;
        if (nPart > cPart) return true;
        if (nPart < cPart) return false;
    }
    return false;
}

/**
 * Accurately determines the currently active running version.
 * - Reads ./version.json for the active web bundle build version.
 * - On native Capacitor, queries CapacitorUpdater.current() to verify if an OTA bundle is active.
 * - Synchronizes localStorage('current_ota_version') with reality so stale states cannot block updates.
 */
async function syncInstalledBundleVersion(): Promise<string> {
    let localVersion = '0.0.0';

    try {
        const res = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store' });
        if (res.ok) {
            const data = await res.json();
            localVersion = data.version || '0.0.0';
            localStorage.setItem('app_bundle_version', localVersion);
            if (data.commit) localStorage.setItem('app_bundle_commit', data.commit);
            if (data.buildTimestamp) localStorage.setItem('app_bundle_build_timestamp', String(data.buildTimestamp));
        }
    } catch {
        localVersion = localStorage.getItem('app_bundle_version') || '0.0.0';
    }

    if (Capacitor.isNativePlatform()) {
        try {
            const currentRes = await CapacitorUpdater.current();
            const bundle = currentRes?.bundle;
            if (bundle && bundle.id !== 'builtin' && bundle.version) {
                // An OTA bundle is active in the native container
                localVersion = bundle.version;
            }
        } catch (e) {
            console.warn('[OTA] Failed to query CapacitorUpdater.current():', e);
        }
    }

    localStorage.setItem('current_ota_version', localVersion);
    return localVersion;
}

async function checkAndUpdate(data: any) {
    if (!data || !data.version || !data.downloadUrl) return;

    try {
        const activeVersion = await syncInstalledBundleVersion();
        const pendingVersion = localStorage.getItem('pending_ota_version');
        const pendingBundleId = localStorage.getItem('pending_ota_bundle_id');

        // Check if the remote version is actually higher than what is actively running
        if (!isVersionHigher(data.version, activeVersion)) {
            // Already up to date! Clean up any stale pending keys
            if (pendingVersion && !isVersionHigher(pendingVersion, activeVersion)) {
                localStorage.removeItem('pending_ota_bundle_id');
                localStorage.removeItem('pending_ota_version');
            }
            if (globalState.status !== 'ready') {
                setGlobalState({ status: 'idle', newVersion: null, downloadProgress: 0 });
            }
            return;
        }

        // Newer update is available on Supabase!
        // Check if this version is ALREADY downloaded and ready on the device:
        if (pendingVersion === data.version) {
            let isValidPending = true;

            if (Capacitor.isNativePlatform()) {
                if (!pendingBundleId) {
                    isValidPending = false;
                } else {
                    try {
                        const listRes = await CapacitorUpdater.list();
                        const exists = listRes?.bundles?.some(
                            b => b.id === pendingBundleId && b.status !== 'error'
                        );
                        if (!exists) {
                            isValidPending = false;
                        }
                    } catch {
                        // If listing fails, assume valid if bundleId exists
                    }
                }
            }

            if (isValidPending) {
                console.log('[OTA] Newer update already downloaded and ready on device:', data.version);
                // Ensure native knows this is queued as next
                if (Capacitor.isNativePlatform() && pendingBundleId) {
                    CapacitorUpdater.next({ id: pendingBundleId }).catch(() => {});
                }
                if (globalState.status !== 'ready') {
                    setGlobalState({ status: 'ready', newVersion: data.version, downloadProgress: 100 });
                }
                return;
            } else {
                // Bundle was corrupted or missing; clear and re-download
                localStorage.removeItem('pending_ota_bundle_id');
                localStorage.removeItem('pending_ota_version');
            }
        }

        // Prevent restarting download if already actively downloading this version
        if (globalState.status === 'downloading' && globalState.newVersion === data.version) {
            return;
        }

        console.log('[OTA] Newer update found on Supabase:', data.version, 'Active:', activeVersion);
        setGlobalState({ status: 'downloading', newVersion: data.version, downloadProgress: 10 });

        if (Capacitor.isNativePlatform()) {
            const versionInfo = await CapacitorUpdater.download({
                url: data.downloadUrl,
                version: data.version,
                checksum: data.checksum,
            });

            if (versionInfo && versionInfo.id) {
                localStorage.setItem('pending_ota_bundle_id', versionInfo.id);
                localStorage.setItem('pending_ota_version', data.version);

                // Queue this bundle natively so it activates on next launch/background automatically
                await CapacitorUpdater.next({ id: versionInfo.id });

                console.log('[OTA] Update downloaded & queued as next bundle:', versionInfo.id);
                setGlobalState({ status: 'ready', newVersion: data.version, downloadProgress: 100 });
            } else {
                throw new Error('Downloaded bundle did not return a valid bundle ID');
            }
        } else {
            // Web simulation: Mark ready so user can test OTA badge
            localStorage.setItem('pending_ota_version', data.version);
            setGlobalState({ status: 'ready', newVersion: data.version, downloadProgress: 100 });
        }
    } catch (error: any) {
        console.error('[OTA] Update error:', error);
        if (globalState.status !== 'ready') {
            setGlobalState({
                status: 'error',
                newVersion: null,
                downloadProgress: 0,
                errorMsg: error?.message || String(error),
            });
            setTimeout(() => {
                if (globalState.status === 'error') {
                    setGlobalState({ status: 'idle', errorMsg: undefined });
                }
            }, 6000);
        }
    }
}

/**
 * Deduplicated check entry point. Ensures only one check runs at a time.
 * @param silent When true, background checking will not flash the UI checking badge.
 */
export function checkSupabaseOTAUpdate(silent = true): Promise<void> {
    if (checkInFlightPromise) {
        return checkInFlightPromise;
    }

    if (!silent && globalState.status === 'idle') {
        setGlobalState({ status: 'checking' });
    }

    checkInFlightPromise = (async () => {
        try {
            const { data, error } = await supabase
                .from('app_kv')
                .select('value')
                .eq('key', 'app_updates/ota_latest')
                .maybeSingle();

            if (error) {
                console.warn('[OTA] Supabase fetch error:', error);
                if (!silent && globalState.status === 'checking') {
                    setGlobalState({ status: 'idle' });
                }
                return;
            }

            if (data?.value) {
                await checkAndUpdate(data.value);
            } else if (!silent && globalState.status === 'checking') {
                setGlobalState({ status: 'idle' });
            }
        } catch (e) {
            console.warn('[OTA] Check failed:', e);
            if (!silent && globalState.status === 'checking') {
                setGlobalState({ status: 'idle' });
            }
        } finally {
            checkInFlightPromise = null;
        }
    })();

    return checkInFlightPromise;
}

function initOTAEngine() {
    if (isInitialized) return;
    isInitialized = true;

    // Verify current bundle version on boot
    void syncInstalledBundleVersion();

    if (Capacitor.isNativePlatform()) {
        try {
            // Confirm app ready state to prevent rollback
            CapacitorUpdater.notifyAppReady().catch(e => console.warn('[OTA] notifyAppReady err:', e));

            // Track actual download progress from Capgo plugin
            CapacitorUpdater.addListener('download', (info: any) => {
                if (info && typeof info.percent === 'number') {
                    setGlobalState(prev => ({
                        ...prev,
                        status: 'downloading',
                        downloadProgress: Math.min(99, Math.round(info.percent)),
                    }));
                }
            });
        } catch (err) {
            console.warn('[OTA] Native listener registration error:', err);
        }
    }

    // Check Supabase immediately on boot (silent background check)
    void checkSupabaseOTAUpdate(true);

    // Subscribe to real-time changes on app_kv for OTA updates (deduplicated channel)
    if (!realtimeChannel) {
        try {
            realtimeChannel = supabase
                .channel('public:app_kv:ota_update')
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'app_kv',
                        filter: 'key=eq.app_updates/ota_latest',
                    },
                    async (payload: any) => {
                        const val = payload?.new?.value;
                        if (val) {
                            console.log('[OTA] Realtime update detected from Supabase:', val);
                            await checkAndUpdate(val);
                        }
                    }
                );
            realtimeChannel.subscribe();
        } catch (e) {
            console.warn('[OTA] Realtime subscribe error:', e);
        }
    }

    // Check when window gains focus
    if (typeof window !== 'undefined') {
        window.addEventListener('focus', () => {
            void checkSupabaseOTAUpdate(true);
        });
    }

    // Check when Capacitor app enters foreground
    import('@capacitor/app')
        .then(({ App }) => {
            App.addListener('appStateChange', async (state) => {
                if (state.isActive) {
                    void checkSupabaseOTAUpdate(true);
                }
            });
        })
        .catch(() => {});

    // Periodic background check every 60 seconds
    if (!pollIntervalTimer) {
        pollIntervalTimer = setInterval(() => {
            void checkSupabaseOTAUpdate(true);
        }, 60_000);
    }
}

export function useOTAUpdater() {
    const [state, setState] = useState<OTAState>(globalState);

    useEffect(() => {
        initOTAEngine();
        listeners.add(setState);
        return () => {
            listeners.delete(setState);
        };
    }, []);

    const restartToUpdate = useCallback(async () => {
        try {
            const pendingBundleId = localStorage.getItem('pending_ota_bundle_id');
            const pendingVersion = localStorage.getItem('pending_ota_version');

            // Reset UI state before reload
            setGlobalState({ status: 'idle', newVersion: null, downloadProgress: 0 });

            if (Capacitor.isNativePlatform()) {
                // Clear pending keys so next boot starts clean
                localStorage.removeItem('pending_ota_bundle_id');
                localStorage.removeItem('pending_ota_version');

                if (pendingBundleId) {
                    console.log('[OTA] Applying active bundle via CapacitorUpdater.set:', pendingBundleId);
                    // CapacitorUpdater.set() atomically switches the active bundle and reloads the WebView
                    await CapacitorUpdater.set({ id: pendingBundleId });
                } else {
                    console.log('[OTA] Reloading via CapacitorUpdater.reload()');
                    await CapacitorUpdater.reload();
                }
                return;
            }

            // Web fallback: update local version and reload page
            if (pendingVersion) {
                localStorage.setItem('current_ota_version', pendingVersion);
            }
            localStorage.removeItem('pending_ota_bundle_id');
            localStorage.removeItem('pending_ota_version');
            window.location.reload();
        } catch (e) {
            console.warn('[OTA] Native apply/reload failed, falling back to window.location.reload():', e);
            window.location.reload();
        }
    }, []);

    const checkForUpdates = useCallback(async () => {
        return checkSupabaseOTAUpdate(false);
    }, []);

    return {
        updateStatus: state.status,
        newVersion: state.newVersion,
        downloadProgress: state.downloadProgress,
        errorMsg: state.errorMsg,
        restartToUpdate,
        checkForUpdates,
    };
}
