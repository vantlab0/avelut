import { db, equalTo, get, orderByChild, query, ref as dbRef } from '@/lib/backend';
import React, { useState, useEffect } from 'react';
import type { UserProfile, AppSettings } from '../types';
import { VerificationBadge } from './VerificationBadge';
import { DEFAULT_USAGE_SETTINGS } from '../utils/appSettings';
import { Browser } from '@capacitor/browser';
import { isNative } from '../utils/capacitorUtils';
import { TransactionRowSkeleton } from './Skeleton';
import { DedicatedAccountCard } from './DedicatedAccountCard';
import { triggerPaystackPurchase } from '../utils/usage';
import { useToast } from '../hooks/useToast';

interface BillingSettingsProps {
  userProfile: UserProfile;
  appSettings: AppSettings;
  onProfileUpdate: (updatedData: Partial<UserProfile>) => Promise<{ success: boolean; error?: string }>;
}

export const BillingSettingsScreen: React.FC<BillingSettingsProps> = ({ userProfile, appSettings, onProfileUpdate }) => {
  const usageSettings = appSettings?.usage_settings || DEFAULT_USAGE_SETTINGS;
  const tiers = usageSettings?.tiers || (usageSettings as any)?.plans || DEFAULT_USAGE_SETTINGS.tiers;
  const [transactions, setTransactions] = useState<any[]>([]);
  const [isLoadingTx, setIsLoadingTx] = useState(true);

  const { addToast } = useToast();
  const [isProcessingPaystack, setIsProcessingPaystack] = useState(false);
  const [selectedTopupAmount, setSelectedTopupAmount] = useState<number>(300);

  const handleInstantPaystackTopup = async (amount: number) => {
    // Google Play Store Policy Guard:
    // If running inside the native Android APK/AAB, 3rd party embedded popups for digital goods are restricted by Google.
    // We open the external browser (Chrome Custom Tabs) to keep the app 100% compliant with Google Play.
    if (isNative()) {
      const billingUrl = `https://avelut.xyz/refill-credits?uid=${userProfile.uid}&amount=${amount}`;
      await Browser.open({ url: billingUrl });
      return;
    }

    if (!appSettings?.paystack_public_key) {
      handleManageBilling();
      return;
    }
    if (!userProfile?.email) {
      addToast('Please ensure your account has a valid email address.', 'warning');
      return;
    }
    setIsProcessingPaystack(true);
    try {
      await triggerPaystackPurchase({
        publicKey: appSettings.paystack_public_key,
        email: userProfile.email,
        amount,
        userId: userProfile.uid,
        purchaseType: 'additional_credits',
        metadata: { credit_amount: amount, pack_label: `Credit Refill ₦${amount}` },
        addToast,
        onSuccess: async (reference) => {
          const currentBal = userProfile.ai_credits_balance ?? userProfile.ai_credits ?? 0;
          const newBal = currentBal + amount;
          await onProfileUpdate({
            ai_credits: newBal,
            ai_credits_balance: newBal,
          });
          addToast(`Successfully credited ₦${amount.toLocaleString()} to your balance!`, 'success');
        },
      });
    } catch (err: any) {
      console.warn('Paystack checkout error:', err);
    } finally {
      setIsProcessingPaystack(false);
    }
  };

  useEffect(() => {
    const fetchTransactions = async () => {
      if (!userProfile.email) {
        setIsLoadingTx(false);
        return;
      }
      try {
        const fetchMatches = async (childKey: 'user_email' | 'email') => {
          const q = query(dbRef(db, 'usage_logs/payments'), orderByChild(childKey), equalTo(userProfile.email));
          const snap = await get(q);
          if (!snap.exists()) {
            return [];
          }
          return Object.keys(snap.val()).map(k => ({ id: k, ...snap.val()[k] }));
        };

        const primaryMatches = await fetchMatches('user_email');
        const fallbackMatches = primaryMatches.length > 0 ? [] : await fetchMatches('email');
        const list = [...primaryMatches, ...fallbackMatches].sort((a: any, b: any) => b.timestamp - a.timestamp);
        setTransactions(list);
      } catch (err) {
        console.error("Error fetching transactions:", err);
      } finally {
        setIsLoadingTx(false);
      }
    };
    fetchTransactions();
  }, [userProfile.email]);

  const handleManageBilling = async () => {
    const baseUrl = isNative() ? 'https://avelut.xyz' : window.location.origin;
    const billingUrl = `${baseUrl}/refill-credits?uid=${userProfile.uid}`;

    if (isNative()) {
      await Browser.open({ url: billingUrl });
    } else {
      window.open(billingUrl, '_blank');
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-8 animate-in fade-in duration-300 max-w-6xl mx-auto">
      
      {/* Account Balance Card */}
      <div className="bg-white dark:bg-[#0A0A0A] border border-[#E3E9F1] dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <span className="text-[11px] font-bold text-[#64748B] dark:text-slate-400 uppercase tracking-wider mb-1 block">Account Plan & Balance</span>
            <div className="flex items-baseline gap-3">
              <span className="text-4xl sm:text-5xl font-black text-[#0F172A] dark:text-white tracking-tight">{userProfile.ai_credits_balance ?? '—'}</span>
              <span className="text-sm font-bold text-[#64748B] dark:text-slate-400">Credits</span>
              <span className="text-xs font-bold px-3 py-1 bg-[#F1F5F9] dark:bg-slate-800 text-[#0066FF] rounded-full border border-[#E3E9F1] dark:border-slate-700 capitalize ml-2">
                {userProfile.subscription_status || 'Free Tier'}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-[#64748B] dark:text-slate-400 mt-2 max-w-md font-medium">
              Use credits for Live Voice Tutorials (₦300/topic), flashcards (₦50/card), or subscribe to Weekly/Monthly plans for unlimited access.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row md:flex-col gap-2.5 w-full md:w-auto">
            <button
              onClick={async () => {
                const baseUrl = isNative() ? 'https://avelut.xyz' : window.location.origin;
                const url = `${baseUrl}/plans?uid=${userProfile.uid}`;
                if (isNative()) await Browser.open({ url });
                else window.open(url, '_blank');
              }}
              className="px-6 py-3 bg-[#0066FF] hover:bg-[#002D62] text-white rounded-2xl text-xs font-bold transition-all w-full md:w-auto shadow-2xs cursor-pointer active:scale-95 text-center"
            >
              View Subscription Plans
            </button>
            <button
              onClick={() => handleInstantPaystackTopup(300)}
              disabled={isProcessingPaystack}
              className="px-6 py-3 bg-[#F1F5F9] dark:bg-slate-800 hover:bg-[#E3E9F1] text-[#0F172A] dark:text-white rounded-2xl text-xs font-bold transition-all w-full md:w-auto border border-[#E3E9F1] dark:border-slate-700 cursor-pointer active:scale-95 text-center disabled:opacity-50"
            >
              {isProcessingPaystack ? 'Opening Paystack...' : 'Instant Refill (₦300 Pass)'}
            </button>
          </div>
        </div>
      </div>

      {/* Payment Method Switcher: Dedicated Virtual Account vs In-App Paystack Modal */}
      {appSettings?.enable_dedicated_accounts ? (
        <DedicatedAccountCard
          userProfile={userProfile}
          onAccountCreated={(acct) => {
            void onProfileUpdate({
              dva_account_number: acct.account_number,
              dva_bank_name: acct.bank_name,
              dva_account_name: acct.account_name,
            });
          }}
        />
      ) : (
        /* In-App Paystack Top-Up Card (Zero Redirect) */
        <div className="bg-white dark:bg-[#0A0A0A] border border-[#E3E9F1] dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <h3 className="text-lg font-black text-[#0F172A] dark:text-white tracking-tight">
                  Instant Credit Refill (In-App Checkout)
                </h3>
              </div>
              <p className="text-xs text-[#64748B] dark:text-slate-400 mt-1">
                Top up your credits in seconds via Card, Bank Transfer, or USSD without leaving the app.
              </p>
            </div>
            <span className="text-[11px] font-bold px-3 py-1 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-full border border-emerald-200 dark:border-emerald-800 self-start sm:self-auto">
              Zero Redirect • Instant Credit
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { amount: 300, label: 'Single Topic Pass', badge: '₦300' },
              { amount: 500, label: 'Standard Refill', badge: '₦500' },
              { amount: 1000, label: 'Plus Pack', badge: '₦1,000' },
              { amount: 2500, label: 'Power Pack', badge: '₦2,500' },
            ].map((pack) => (
              <button
                key={pack.amount}
                type="button"
                onClick={() => setSelectedTopupAmount(pack.amount)}
                className={`p-4 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  selectedTopupAmount === pack.amount
                    ? 'border-[#0066FF] bg-blue-50/50 dark:bg-blue-950/20 shadow-2xs'
                    : 'border-[#E3E9F1] dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700 bg-[#F8FAFC] dark:bg-slate-900/40'
                }`}
              >
                <div className="text-lg font-black text-[#0F172A] dark:text-white mb-1">
                  {pack.badge}
                </div>
                <div className="text-[11px] font-semibold text-[#64748B] dark:text-slate-400">
                  {pack.label}
                </div>
              </button>
            ))}
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-[#E3E9F1] dark:border-slate-800">
            <div className="text-xs text-[#64748B] dark:text-slate-400 font-medium">
              You will receive <strong className="text-[#0F172A] dark:text-white font-bold">{selectedTopupAmount.toLocaleString()} AI Credits</strong> immediately after payment.
            </div>
            <button
              type="button"
              onClick={() => handleInstantPaystackTopup(selectedTopupAmount)}
              disabled={isProcessingPaystack}
              className="w-full sm:w-auto px-8 py-3.5 bg-[#0066FF] hover:bg-[#002D62] disabled:opacity-50 text-white rounded-2xl font-black text-xs transition-all cursor-pointer shadow-md active:scale-95 flex items-center justify-center gap-2"
            >
              <i className="bi bi-shield-check"></i>
              {isProcessingPaystack ? 'Loading Checkout...' : `Pay ₦${selectedTopupAmount.toLocaleString()} via Paystack`}
            </button>
          </div>
        </div>
      )}

      {/* Recent Transactions */}
      <div className="bg-white dark:bg-black p-6 sm:p-8 rounded-3xl border border-slate-200 dark:border-white/10 shadow-sm flex flex-col gap-6">
        <div>
          <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">Recent Transactions</h3>
          <p className="text-sm text-slate-500 font-medium mt-1">Your recent payments and credit refills.</p>
        </div>
        
        {isLoadingTx ? (
           <div className="overflow-x-auto">
             <table className="w-full text-left border-collapse">
               <thead>
                 <tr className="border-b border-slate-100 dark:border-white/10">
                   <th className="py-3 px-4 text-xs font-black uppercase tracking-widest text-slate-400">Date</th>
                   <th className="py-3 px-4 text-xs font-black uppercase tracking-widest text-slate-400">Reference</th>
                   <th className="py-3 px-4 text-xs font-black uppercase tracking-widest text-slate-400">Tier</th>
                   <th className="py-3 px-4 text-xs font-black uppercase tracking-widest text-slate-400 text-right">Amount</th>
                   <th className="py-3 px-4 text-xs font-black uppercase tracking-widest text-slate-400 text-center">Status</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                 {Array.from({ length: 4 }).map((_, i) => <TransactionRowSkeleton key={i} />)}
               </tbody>
             </table>
           </div>
        ) : transactions.length === 0 ? (
           <div className="py-12 flex flex-col items-center justify-center text-center bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-white/5">
             <i className="bi bi-clock text-2xl text-slate-300 mb-3"></i>
             <p className="text-sm font-bold text-slate-600 dark:text-slate-400">No transactions yet</p>
           </div>
        ) : (
           <div className="overflow-x-auto">
             <table className="w-full text-left border-collapse">
               <thead>
                 <tr className="border-b border-slate-100 dark:border-white/10">
                   <th className="py-3 px-4 text-xs font-black uppercase tracking-widest text-slate-400">Date</th>
                   <th className="py-3 px-4 text-xs font-black uppercase tracking-widest text-slate-400">Reference</th>
                   <th className="py-3 px-4 text-xs font-black uppercase tracking-widest text-slate-400">Tier</th>
                   <th className="py-3 px-4 text-xs font-black uppercase tracking-widest text-slate-400 text-right">Amount</th>
                   <th className="py-3 px-4 text-xs font-black uppercase tracking-widest text-slate-400 text-center">Status</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                 {transactions.slice(0, 10).map((tx) => (
                   <tr key={tx.id} className="text-sm hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                     <td className="py-4 px-4 text-slate-600 dark:text-slate-400 font-medium">
                       {new Date(tx.timestamp).toLocaleDateString()}
                     </td>
                     <td className="py-4 px-4 font-mono text-xs text-slate-500">{tx.reference || 'N/A'}</td>
                     <td className="py-4 px-4 font-bold text-slate-700 dark:text-slate-300 uppercase text-xs">{tx.tier_id}</td>
                     <td className="py-4 px-4 text-right font-black text-slate-900 dark:text-white">
                       ₦{(Number(tx.amount) || 0).toLocaleString()}
                     </td>
                     <td className="py-4 px-4">
                        <div className="flex justify-center">
                          {(!tx.status || tx.status === 'success' || tx.status === 'successful') ? (
                              <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-md text-[10px] font-black uppercase">
                                  <i className="bi bi-check-circle-fill text-xs"></i> Success
                              </span>
                          ) : (
                              <span className="flex items-center gap-1 text-red-600 bg-red-50 dark:bg-red-500/10 px-2 py-1 rounded-md text-[10px] font-black uppercase">
                                  Failed
                              </span>
                          )}
                        </div>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
           </div>
        )}
      </div>

    </div>
  );
};
