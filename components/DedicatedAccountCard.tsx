import React, { useState, useEffect } from 'react';
import type { UserProfile } from '../types';
import { useToast } from '../hooks/useToast';
import { triggerHaptic } from '../utils/capacitorUtils';
import { ImpactStyle } from '@capacitor/haptics';

interface DedicatedAccountCardProps {
  userProfile?: UserProfile | null;
  onAccountCreated?: (account: any) => void;
  className?: string;
}

export const DedicatedAccountCard: React.FC<DedicatedAccountCardProps> = ({
  userProfile,
  onAccountCreated,
  className = '',
}) => {
  const { addToast } = useToast();
  const [account, setAccount] = useState<{
    account_number: string;
    bank_name: string;
    account_name: string;
  } | null>(() => {
    if (userProfile?.dva_account_number) {
      return {
        account_number: userProfile.dva_account_number,
        bank_name: userProfile.dva_bank_name || 'Wema Bank',
        account_name: userProfile.dva_account_name || userProfile.display_name,
      };
    }
    return null;
  });

  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Check if account was already created and stored in app_kv
  useEffect(() => {
    if (account?.account_number || !userProfile?.uid) return;

    let isMounted = true;
    (async () => {
      try {
        const apiBase = typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.()
          ? 'https://www.avelut.xyz'
          : '';
        const res = await fetch(`${apiBase}/api/paystack-dva?userId=${encodeURIComponent(userProfile.uid)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.account && isMounted) {
            setAccount(data.account);
            onAccountCreated?.(data.account);
          }
        }
      } catch {
        // Silently ignore if not found
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [userProfile?.uid, account?.account_number, onAccountCreated]);

  const handleGenerateAccount = async () => {
    if (!userProfile?.uid || !userProfile?.email) {
      addToast('Please ensure your account has a valid email address.', 'warning');
      return;
    }

    setIsLoading(true);

    try {
      const nameParts = (userProfile.display_name || 'Student').trim().split(' ');
      const firstName = nameParts[0] || 'Student';
      const lastName = nameParts.slice(1).join(' ') || 'Avelut';

      const apiBase = typeof window !== 'undefined' && (window as any).Capacitor?.isNativePlatform?.()
        ? 'https://www.avelut.xyz'
        : '';
      const res = await fetch(`${apiBase}/api/paystack-dva`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userProfile.uid,
          email: userProfile.email,
          firstName,
          lastName,
          phone: (userProfile as any).phone || '',
        }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.account) {
        setAccount(data.account);
        onAccountCreated?.(data.account);
        void triggerHaptic(ImpactStyle.Heavy);
        addToast('Dedicated virtual account created successfully!', 'success');
      } else {
        addToast(data.error || 'Could not generate virtual account. Please try again.', 'error');
      }
    } catch (err: any) {
      console.error('[DVA] Error generating virtual account:', err);
      addToast('Network error while creating account number.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = () => {
    if (!account?.account_number) return;
    navigator.clipboard.writeText(account.account_number).then(() => {
      setCopied(true);
      void triggerHaptic(ImpactStyle.Medium);
      addToast('Account number copied! Send funds from any bank app to top up instantly.', 'success');
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {
      addToast('Failed to copy account number.', 'error');
    });
  };

  return (
    <div className={`w-full ${className}`}>
      {account ? (
        <div className="relative overflow-hidden rounded-3xl p-6 sm:p-7 bg-gradient-to-br from-neutral-900 via-neutral-950 to-black text-white shadow-xl border border-neutral-800">
          {/* Subtle Ambient Background Glow */}
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-10 -left-10 w-36 h-36 bg-emerald-600/15 rounded-full blur-3xl pointer-events-none" />

          {/* Header Row */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[12px] font-bold tracking-wider uppercase text-emerald-400">
                Instant Auto-Topup
              </span>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-white/90 text-xs font-semibold backdrop-blur-md">
              <svg className="w-3.5 h-3.5 text-blue-400" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              <span>{account.bank_name}</span>
            </div>
          </div>

          {/* Main Account Number Section */}
          <div className="my-4">
            <div className="text-[12px] uppercase tracking-wider text-neutral-400 font-medium mb-1">
              Your Dedicated Account Number
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="font-mono text-2xl sm:text-3xl font-extrabold tracking-widest text-white selection:bg-blue-600">
                {account.account_number.replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2 $3')}
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 cursor-pointer shadow-sm ${
                  copied
                    ? 'bg-emerald-500 text-white'
                    : 'bg-white text-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-200'
                }`}
              >
                {copied ? (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25c0-.621.504-1.125 1.125-1.125h6.75c.621 0 1.125.504 1.125 1.125v9.25c0 .621-.504 1.125-1.125 1.125z" />
                    </svg>
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Account Details Footer */}
          <div className="pt-4 mt-2 border-t border-neutral-800 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-300">
            <div>
              <span className="text-neutral-500 block text-[11px] uppercase tracking-wider">Account Name</span>
              <span className="font-semibold text-white">{account.account_name}</span>
            </div>
            <div>
              <span className="text-neutral-500 block text-[11px] uppercase tracking-wider text-right">Bank</span>
              <span className="font-semibold text-white">{account.bank_name}</span>
            </div>
          </div>

          {/* Info pill */}
          <div className="mt-4 pt-3 flex items-center gap-2 text-[12px] text-neutral-400 bg-white/5 px-3 py-2 rounded-xl">
            <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            <span>Transfer any amount from OPay, Kuda, GTBank, PalmPay, etc. Credits appear in seconds automatically.</span>
          </div>
        </div>
      ) : (
        <div className="rounded-3xl p-6 sm:p-7 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-blue-600/10 dark:bg-blue-400/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6H2.25m0 0v10.5m0-10.5h16.5m0 0h1.5m-1.5 0v10.5m-16.5 0h16.5m-16.5 0H2.25m16.5 0h1.5m0 0v-1.5m0 1.5H19.5" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-neutral-900 dark:text-white mb-1">
            Dedicated Virtual Bank Account
          </h3>
          <p className="text-sm text-neutral-500 dark:text-neutral-400 max-w-sm mx-auto mb-5 leading-relaxed">
            Get your own dedicated bank account number. Transfer money directly from any Nigerian banking app to top up credits instantly without leaving the app.
          </p>
          <button
            type="button"
            disabled={isLoading}
            onClick={handleGenerateAccount}
            className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm tracking-wide shadow-md hover:shadow-lg transition-all active:scale-95 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2 mx-auto"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <span>Generating Bank Account...</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                <span>Generate My Dedicated Account Number</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
