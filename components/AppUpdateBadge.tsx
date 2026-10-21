import React from 'react';
import { Capacitor } from '@capacitor/core';
import { useOTAUpdater } from '../hooks/useOTAUpdater';

export const AppUpdateBadge: React.FC<{ className?: string }> = ({ className = '' }) => {
    // Only display update status and restart pill on native mobile app
    if (!Capacitor.isNativePlatform()) {
        return null;
    }

    const { updateStatus, newVersion, downloadProgress, restartToUpdate } = useOTAUpdater();

    // Do not show banner when app is up to date
    if (updateStatus === 'idle') {
        return null;
    }

    if (updateStatus === 'checking') {
        return (
            <div
                className={`inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800 border border-[#E5E5E0] dark:border-[#2A2A2A] text-[#111111] dark:text-[#F5F5F5] text-xs font-medium select-none ${className}`}
                title="Checking for updates..."
            >
                <span className="w-3 h-3 border-2 border-neutral-400 border-t-neutral-800 dark:border-neutral-500 dark:border-t-neutral-200 rounded-full animate-spin shrink-0" />
                <span className="truncate max-w-[200px] sm:max-w-xs font-medium">
                    Checking for update...
                </span>
            </div>
        );
    }

    if (updateStatus === 'downloading') {
        return (
            <div
                className={`inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800 border border-[#E5E5E0] dark:border-[#2A2A2A] text-[#111111] dark:text-[#F5F5F5] text-xs font-medium select-none ${className}`}
                title={`Downloading version ${newVersion || ''}`}
            >
                <span className="w-3 h-3 border-2 border-neutral-400 border-t-neutral-800 dark:border-neutral-500 dark:border-t-neutral-200 rounded-full animate-spin shrink-0" />
                <span className="truncate max-w-[200px] sm:max-w-xs font-medium">
                    {downloadProgress > 0 && downloadProgress < 100
                        ? `Downloading update (${downloadProgress}%)`
                        : 'Downloading update...'}
                </span>
            </div>
        );
    }

    const [isApplying, setIsApplying] = React.useState(false);

    if (updateStatus === 'ready') {
        const handleRestart = async () => {
            if (isApplying) return;
            setIsApplying(true);
            try {
                await restartToUpdate();
            } catch {
                setIsApplying(false);
            }
        };

        return (
            <button
                type="button"
                onClick={handleRestart}
                disabled={isApplying}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-black dark:bg-white text-white dark:text-black text-xs font-semibold cursor-pointer transition-colors hover:bg-neutral-800 dark:hover:bg-neutral-200 select-none ${isApplying ? 'opacity-75 cursor-wait' : 'animate-pulse'} ${className}`}
                title="Update ready. Tap to restart."
            >
                {isApplying ? (
                    <>
                        <span className="w-3 h-3 border-2 border-neutral-400 border-t-neutral-800 dark:border-neutral-500 dark:border-t-neutral-200 rounded-full animate-spin shrink-0" />
                        <span>Applying update...</span>
                    </>
                ) : (
                    <>
                        <i className="bi bi-arrow-repeat text-xs" />
                        <span>Update ready • Restart</span>
                    </>
                )}
            </button>
        );
    }

    if (updateStatus === 'error') {
        return (
            <div
                className={`inline-flex items-center gap-2 px-3 py-1 rounded-full bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-xs font-medium select-none ${className}`}
                title="Update failed"
            >
                <i className="bi bi-exclamation-triangle text-xs" />
                <span className="truncate max-w-[200px] sm:max-w-xs font-medium">
                    Update failed
                </span>
            </div>
        );
    }

    return null;
};

export default AppUpdateBadge;
