import { db, limitToLast, off, onValue, orderByChild, query, ref as dbRef } from '@/lib/backend';
import React, { useState, useEffect } from 'react';
import { readCachedJson, writeCachedJson } from '../utils/cache';
import type { UserProfile, LeaderboardEntry } from '../types';
import { Avatar } from './Avatar';
import { VerificationBadge } from './VerificationBadge';
import { LeaderboardSkeleton } from './Skeleton';

const getWeekId = (date: Date): string => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-${weekNo}`;
};



const RankItem: React.FC<{rank: number, user: LeaderboardEntry, isCurrentUser: boolean}> = ({ rank, user, isCurrentUser }) => (
    <div className={`flex items-center p-3.5 rounded-2xl transition-all duration-200 border animate-in fade-in slide-in-from-bottom-1 duration-150 ${
        isCurrentUser 
            ? 'bg-lime-500/15 border-lime-500/40 text-neutral-900 dark:text-white dark:bg-lime-950/40 dark:border-lime-700/60 shadow-xs' 
            : 'bg-neutral-50 dark:bg-[#141414] border-neutral-200/80 dark:border-white/5 hover:bg-neutral-100/70 dark:hover:bg-[#1A1A1A]'
    }`}>
        <div className="flex-shrink-0 w-8 text-center font-bold text-lg text-neutral-500 dark:text-neutral-400">
            {rank <= 3 ? (
                <span className={rank === 1 ? 'text-amber-500 font-extrabold text-xl' : rank === 2 ? 'text-slate-400 font-extrabold text-xl' : 'text-amber-700 dark:text-amber-600 font-extrabold text-xl'}>
                    {rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}
                </span>
            ) : rank}
        </div>
        <Avatar display_name={user.display_name} photo_url={user.photo_url} className="w-10 h-10 ml-3.5 rounded-full" />
        <div className="flex-1 ml-3.5 min-w-0">
            <p className="font-semibold text-neutral-900 dark:text-white flex items-center gap-1.5 truncate text-[14.5px]">
                <span className="truncate">{user.display_name}</span>
                <VerificationBadge status={(user as any).subscription_status} />
            </p>
        </div>
        <div className="font-bold text-lime-600 dark:text-lime-400 text-base sm:text-lg shrink-0">
            {(user.xp || 0).toLocaleString()} XP
        </div>
    </div>
);

interface LeaderboardProps {
  userProfile: UserProfile;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ userProfile }) => {
  const [activeTab, setActiveTab] = useState<'overall' | 'weekly'>('overall');
  const [overallData, setOverallData] = useState<LeaderboardEntry[]>(() => {
    return readCachedJson<LeaderboardEntry[]>(`avelut_leaderboard_overall_${userProfile.department_id}`, []);
  });
  const [weeklyData, setWeeklyData] = useState<LeaderboardEntry[]>(() => {
    const weekId = getWeekId(new Date());
    return readCachedJson<LeaderboardEntry[]>(`avelut_leaderboard_weekly_${weekId}_${userProfile.department_id}`, []);
  });
  const [isLoading, setIsLoading] = useState(() => {
    const cached = readCachedJson<LeaderboardEntry[]>(
      `avelut_leaderboard_${activeTab}_${userProfile.department_id}`,
      []
    );
    return cached.length === 0;
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const weekId = getWeekId(new Date());
    const path = activeTab === 'overall' 
        ? `leaderboard_overall/${userProfile.department_id}` 
        : `leaderboard_weekly/${weekId}/${userProfile.department_id}`;
    const cacheKey = activeTab === 'overall'
        ? `avelut_leaderboard_overall_${userProfile.department_id}`
        : `avelut_leaderboard_weekly_${weekId}_${userProfile.department_id}`;

    const cached = readCachedJson<LeaderboardEntry[]>(cacheKey, []);
    if (cached.length === 0) {
      setIsLoading(true);
    }
    setError(null);
    
    const leaderboardRef = query(dbRef(db, path), orderByChild('xp'), limitToLast(100));

    const unsubscribe = onValue(leaderboardRef, (snapshot) => {
        if (snapshot.exists()) {
            const data: any[] = [];
            snapshot.forEach((child) => {
                data.push({ user_id: child.key, ...child.val() });
            });
            // Realtime db sorts ascending by child, so we reverse for descending leaderboard
            const sortedData = data.sort((a, b) => (b.xp || 0) - (a.xp || 0));
            
            writeCachedJson(cacheKey, sortedData);
            if (activeTab === 'overall') {
                setOverallData(sortedData as LeaderboardEntry[]);
            } else {
                setWeeklyData(sortedData as LeaderboardEntry[]);
            }
        } else {
            writeCachedJson(cacheKey, []);
            if (activeTab === 'overall') setOverallData([]);
            else setWeeklyData([]);
        }
        setIsLoading(false);
    }, (err) => {
        console.error("Error fetching leaderboard: ", err);
        setError("Could not load leaderboard data. Please try again later.");
        setIsLoading(false);
    });

    return () => off(leaderboardRef);
  }, [activeTab, userProfile.department_id]);

  const data = activeTab === 'overall' ? overallData : weeklyData;
  const currentUserRank = data.findIndex(u => u.user_id === userProfile.uid) + 1;
  const topUsers = data.slice(0, 10);
  const isCurrentUserInTop = currentUserRank > 0 && currentUserRank <= 10;

  const renderList = () => {
      if(isLoading) return <LeaderboardSkeleton />;
      if(error) return <p className="text-center text-red-600 dark:text-red-400 py-6">{error}</p>;
      if(data.length === 0) return <p className="text-center text-neutral-500 dark:text-neutral-400 py-8">The leaderboard is empty. Be the first to set a score!</p>;

      return (
          <div className="space-y-2.5">
              {topUsers.map((user, index) => (
                  <RankItem key={user.user_id} rank={index + 1} user={user} isCurrentUser={user.user_id === userProfile.uid} />
              ))}
              {!isCurrentUserInTop && currentUserRank > 0 && (
                  <>
                      <div className="text-center text-neutral-400 dark:text-neutral-500 py-1 font-bold">···</div>
                      <RankItem rank={currentUserRank} user={data[currentUserRank-1]} isCurrentUser={true} />
                  </>
              )}
          </div>
      );
  };

  return (
    <div className="flex-1 flex flex-col w-full max-w-4xl mx-auto bg-white dark:bg-black p-4 sm:p-6 rounded-3xl border border-neutral-200/80 dark:border-white/10 shadow-xs">
      <div className="flex-shrink-0 mb-4 bg-neutral-100 dark:bg-white/5 p-1 rounded-2xl flex border border-neutral-200/50 dark:border-white/5">
        <button
          type="button"
          onClick={() => setActiveTab('overall')}
          className={`flex-1 py-2 px-3 rounded-xl font-bold text-sm transition-all cursor-pointer ${
            activeTab === 'overall'
              ? 'bg-lime-600 text-white shadow-xs'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200/50 dark:hover:bg-white/5'
          }`}
        >
          Overall
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('weekly')}
          className={`flex-1 py-2 px-3 rounded-xl font-bold text-sm transition-all cursor-pointer ${
            activeTab === 'weekly'
              ? 'bg-lime-600 text-white shadow-xs'
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200/50 dark:hover:bg-white/5'
          }`}
        >
          This Week
        </button>
      </div>
      <div className="flex-1 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {renderList()}
      </div>
    </div>
  );
};