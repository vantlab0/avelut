import React, {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { UserProfile } from '../../../types';
import { Avatar } from '../../Avatar';

export interface MessengerNewChatProps {
  allUsers: UserProfile[];
  currentUser: UserProfile;
  studyPartners: Record<string, boolean>;
  partnerRequests: Record<string, any>;
  newChatSearchQuery: string;
  setNewChatSearchQuery: (query: string) => void;
  openChatWithUser: (user: UserProfile) => void;
  sendPartnerRequest: (user: UserProfile) => void;
  acceptPartnerRequest: (user: UserProfile) => void;
  declinePartnerRequest: (user: UserProfile) => void;
  addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
  navigateToSubRoute: (path: string) => void;
  onNavigate?: (route: string) => void;
}

type RequestStatus = 'partner' | 'sent' | 'received' | 'none';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Build a minimal profile when the user is not yet in allUsers */
function profileFromRequest(
  req: any,
  allUsers: UserProfile[],
  side: 'incoming' | 'sent'
): UserProfile {
  const otherId =
    side === 'incoming'
      ? req.senderId || req.sender_id
      : req.receiverId || req.receiver_id;
  const found = allUsers.find((u) => u?.uid === otherId);
  if (found) return found;
  return {
    uid: otherId || 'unknown',
    display_name: req.senderName || req.sender_name || 'User',
    photo_url: null,
  } as UserProfile;
}

const humanize = (value?: string | null) => (value || '').replace(/_/g, ' ').trim();

const normalizeLevel = (level?: string | number | null) => {
  if (level === undefined || level === null || level === '') return '';
  const raw = String(level).trim();
  return /^\d+$/.test(raw) ? `${raw}L` : raw;
};

/**
 * Lightweight sessionStorage-backed state.
 * Keeps the active tab / filters stable when this screen unmounts and
 * remounts (e.g. opening a chat and coming back), without touching the shell.
 */
function useStickyState<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initial;
    try {
      const raw = window.sessionStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore (private mode / quota) */
      }
    },
    [key]
  );

  return [value, update];
}

/* ------------------------------------------------------------------ */
/*  Row (memoized so filtering/typing never re-renders the whole list) */
/* ------------------------------------------------------------------ */

interface UserRowProps {
  user: UserProfile;
  status: RequestStatus;
  onOpenChat: (user: UserProfile) => void;
  onViewProfile: (user: UserProfile) => void;
  onConnect: (user: UserProfile) => void;
  onAccept: (user: UserProfile) => void;
  onDecline: (user: UserProfile) => void;
}

const primaryButton =
  'text-xs font-semibold text-white bg-[#0066FF] hover:bg-[#0055D4] px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer';
const ghostButton =
  'text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors cursor-pointer px-1';
const quietButton =
  'text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 border border-slate-200 dark:border-white/10 px-3 py-1.5 rounded-lg transition-colors cursor-pointer';

const UserRow = memo(function UserRow({
  user,
  status,
  onOpenChat,
  onViewProfile,
  onConnect,
  onAccept,
  onDecline,
}: UserRowProps) {
  const name = user.display_name || user.email || 'User';
  const primary =
    humanize(user.department_id) ||
    humanize(user.college_id) ||
    humanize(user.school_id) ||
    'Student';
  const level = normalizeLevel(user.level);
  const context = humanize(user.school_id);
  const showContext = !!context && context.toLowerCase() !== primary.toLowerCase();

  const isPartner = status === 'partner';

  const handleRowClick = () => {
    if (isPartner) onOpenChat(user);
    else onViewProfile(user);
  };

  return (
    <div
      onClick={handleRowClick}
      className="flex items-center gap-3 px-3.5 py-3 hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors cursor-pointer"
    >
      <Avatar
        className="w-11 h-11 rounded-full shrink-0 object-cover border border-slate-200 dark:border-white/10"
        photo_url={user.photo_url}
        display_name={name}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h4 className="font-semibold text-sm text-slate-900 dark:text-white truncate">
            {name}
          </h4>
          {isPartner && (
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4 text-emerald-500 shrink-0"
              aria-label="Study partner"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          )}
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
          <span className="capitalize">{primary}</span>
          {level && (
            <span className="text-slate-400 dark:text-slate-500"> · {level}</span>
          )}
        </p>

        {showContext && (
          <p className="text-[11px] text-slate-400 dark:text-slate-500 truncate mt-0.5 capitalize">
            {context}
          </p>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {status === 'partner' && (
          <button type="button" onClick={() => onOpenChat(user)} className={quietButton}>
            Message
          </button>
        )}

        {status === 'sent' && (
          <>
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">
              Pending
            </span>
            <button type="button" onClick={() => onDecline(user)} className={ghostButton}>
              Cancel
            </button>
          </>
        )}

        {status === 'received' && (
          <>
            <button type="button" onClick={() => onDecline(user)} className={ghostButton}>
              Decline
            </button>
            <button type="button" onClick={() => onAccept(user)} className={primaryButton}>
              Accept
            </button>
          </>
        )}

        {status === 'none' && (
          <button type="button" onClick={() => onConnect(user)} className={primaryButton}>
            Connect
          </button>
        )}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ */
/*  Small presentational bits                                          */
/* ------------------------------------------------------------------ */

const SearchIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-4 h-4"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const Surface: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div
    className={`rounded-2xl bg-white dark:bg-white/[0.03] border border-slate-200/70 dark:border-white/10 overflow-hidden divide-y divide-slate-100 dark:divide-white/[0.06] ${className}`}
  >
    {children}
  </div>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2 pl-1">
    {children}
  </h3>
);

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export const MessengerNewChat: React.FC<MessengerNewChatProps> = ({
  allUsers,
  currentUser,
  studyPartners,
  partnerRequests,
  newChatSearchQuery,
  setNewChatSearchQuery,
  openChatWithUser,
  sendPartnerRequest,
  acceptPartnerRequest,
  declinePartnerRequest,
  navigateToSubRoute,
  onNavigate,
}) => {
  const [activeTab, setActiveTab] = useStickyState<'find' | 'requests'>(
    'avelut_new_chat_tab',
    'find'
  );
  const [scopeFilter, setScopeFilter] = useStickyState<'all' | 'my_school' | 'my_college'>(
    'avelut_new_chat_scope',
    'all'
  );
  const [schoolFilter, setSchoolFilter] = useStickyState<string>(
    'avelut_new_chat_school',
    'all'
  );
  const [levelFilter, setLevelFilter] = useStickyState<string>(
    'avelut_new_chat_level',
    'all'
  );
  const [showAdvanced, setShowAdvanced] = useStickyState<boolean>(
    'avelut_new_chat_advanced',
    false
  );

  // Latest handlers in a ref -> the callbacks below never change identity,
  // so memoized rows are not forced to re-render on every shell render.
  const handlers = useRef({
    openChatWithUser,
    sendPartnerRequest,
    acceptPartnerRequest,
    declinePartnerRequest,
    onNavigate,
  });
  useEffect(() => {
    handlers.current = {
      openChatWithUser,
      sendPartnerRequest,
      acceptPartnerRequest,
      declinePartnerRequest,
      onNavigate,
    };
  });

  const openChat = useCallback(
    (user: UserProfile) => {
      void handlers.current.openChatWithUser(user);
      navigateToSubRoute('/messenger');
    },
    [navigateToSubRoute]
  );

  const viewProfile = useCallback((user: UserProfile) => {
    handlers.current.onNavigate?.(`public_profile_${user.uid}`);
  }, []);

  const connect = useCallback((user: UserProfile) => {
    void handlers.current.sendPartnerRequest(user);
  }, []);

  const accept = useCallback((user: UserProfile) => {
    void handlers.current.acceptPartnerRequest(user);
  }, []);

  const decline = useCallback((user: UserProfile) => {
    void handlers.current.declinePartnerRequest(user);
  }, []);

  const clearFilters = useCallback(() => {
    setScopeFilter('all');
    setSchoolFilter('all');
    setLevelFilter('all');
  }, [setScopeFilter, setSchoolFilter, setLevelFilter]);

  const uniqueSchools = useMemo(() => {
    const setOfSchools = new Set<string>();
    (allUsers || []).forEach((u) => {
      if (u?.school_id) setOfSchools.add(u.school_id);
    });
    return Array.from(setOfSchools).sort();
  }, [allUsers]);

  // Keep typing instant on large directories: the input stays on the live
  // value while the (heavier) filtering runs on a deferred value.
  const deferredQuery = useDeferredValue(newChatSearchQuery);

  const filteredUsers = useMemo(() => {
    let users = (allUsers || []).filter(
      (u) => u && u.uid && u.uid !== currentUser?.uid
    );

    if (scopeFilter === 'my_school' && currentUser?.school_id) {
      users = users.filter((u) => u.school_id === currentUser.school_id);
    } else if (scopeFilter === 'my_college' && currentUser?.college_id) {
      users = users.filter((u) => u.college_id === currentUser.college_id);
    }

    if (schoolFilter !== 'all') {
      users = users.filter((u) => u.school_id === schoolFilter);
    }

    if (levelFilter !== 'all') {
      users = users.filter(
        (u) => String(u.level) === levelFilter || String(u.level) === `${levelFilter}L`
      );
    }

    const q = deferredQuery.trim().toLowerCase();
    if (q) {
      users = users.filter((u) => {
        const name = (u.display_name || '').toLowerCase();
        const school = (u.school_id || '').toLowerCase().replace(/_/g, ' ');
        const college = (u.college_id || '').toLowerCase().replace(/_/g, ' ');
        const dept = (u.department_id || '').toLowerCase().replace(/_/g, ' ');
        const level = String(u.level || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        return (
          name.includes(q) ||
          school.includes(q) ||
          college.includes(q) ||
          dept.includes(q) ||
          level.includes(q) ||
          email.includes(q)
        );
      });
    }

    return users;
  }, [allUsers, currentUser, scopeFilter, schoolFilter, levelFilter, deferredQuery]);

  const statusFor = useCallback(
    (uid: string): RequestStatus => {
      if (studyPartners[uid] === true) return 'partner';
      const req = partnerRequests[uid];
      if (req?.status === 'sent') return 'sent';
      if (req?.status === 'received') return 'received';
      return 'none';
    },
    [studyPartners, partnerRequests]
  );

  const receivedRequests = useMemo(() => {
    return Object.entries(partnerRequests || {})
      .filter(([, req]) => req && req.status === 'received')
      .map(([key, req]) => ({
        key,
        user: profileFromRequest(req, allUsers || [], 'incoming'),
      }));
  }, [partnerRequests, allUsers]);

  const sentRequests = useMemo(() => {
    return Object.entries(partnerRequests || {})
      .filter(([, req]) => req && req.status === 'sent')
      .map(([key, req]) => ({
        key,
        user: profileFromRequest(req, allUsers || [], 'sent'),
      }));
  }, [partnerRequests, allUsers]);

  const requestCount = receivedRequests.length + sentRequests.length;

  const hasActiveFilters =
    scopeFilter !== 'all' || schoolFilter !== 'all' || levelFilter !== 'all';

  const inputValue = newChatSearchQuery;
  const isSearchStale = inputValue !== deferredQuery;

  return (
    <div className="flex h-full w-full flex-col bg-slate-50 dark:bg-neutral-950 text-slate-900 dark:text-white overflow-hidden animate-fade-in">
      {/* ---------------- Fixed header: title, tabs, search, filters ---------------- */}
      <div className="shrink-0 border-b border-slate-200/70 dark:border-white/10 bg-white/90 dark:bg-neutral-950/90 backdrop-blur">
        <div className="mx-auto w-full max-w-2xl px-3 sm:px-4">
          {/* Title */}
          <div className="flex items-center gap-2 pt-3 pb-2">
            <button
              type="button"
              onClick={() => navigateToSubRoute('/messenger')}
              className="-ml-2 w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-white/10 text-slate-500 dark:text-slate-400 transition-colors cursor-pointer"
              aria-label="Back"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-5 h-5"
              >
                <path d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="min-w-0 flex-1">
              <h1 className="text-[15px] font-bold leading-tight text-slate-900 dark:text-white">
                New Chat
              </h1>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                Find study partners by school, faculty and level
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigateToSubRoute('/messenger')}
              className="text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer px-1"
            >
              Cancel
            </button>
          </div>

          {/* Segmented tabs */}
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 dark:bg-white/5 p-1">
            <button
              type="button"
              onClick={() => setActiveTab('find')}
              className={`py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                activeTab === 'find'
                  ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              Find Partners
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('requests')}
              className={`py-2 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                activeTab === 'requests'
                  ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
              }`}
            >
              Requests
              {requestCount > 0 && (
                <span className="rounded-full text-[10px] font-black h-4 min-w-4 px-1 flex items-center justify-center bg-red-500 text-white">
                  {requestCount}
                </span>
              )}
            </button>
          </div>

          {/* Search */}
          <div className="relative mt-2.5">
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              <SearchIcon />
            </div>
            <input
              type="text"
              placeholder="Search name, school, department or level"
              value={inputValue}
              onChange={(e) => setNewChatSearchQuery(e.target.value)}
              className="w-full bg-slate-100/80 dark:bg-white/5 text-sm text-slate-900 dark:text-white pl-10 pr-10 py-2.5 rounded-xl border border-transparent focus:border-[#0066FF]/40 focus:bg-white dark:focus:bg-white/[0.07] focus:outline-none focus:ring-1 focus:ring-[#0066FF]/40 transition placeholder:text-slate-400"
            />
            {inputValue && (
              <button
                type="button"
                onClick={() => setNewChatSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                aria-label="Clear search"
              >
                <CloseIcon />
              </button>
            )}
          </div>

          {/* Filters (find tab only) */}
          {activeTab === 'find' && (
            <div className="pt-2.5 pb-3 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto scrollbar-none rounded-xl bg-slate-100 dark:bg-white/5 p-1">
                  {[
                    { id: 'all' as const, label: 'All', show: true },
                    {
                      id: 'my_school' as const,
                      label: 'My Campus',
                      show: !!currentUser?.school_id,
                    },
                    {
                      id: 'my_college' as const,
                      label: 'My Faculty',
                      show: !!currentUser?.college_id,
                    },
                  ]
                    .filter((option) => option.show)
                    .map((option) => {
                      const isActive = scopeFilter === option.id && schoolFilter === 'all';
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => {
                            setScopeFilter(option.id);
                            setSchoolFilter('all');
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                            isActive
                              ? 'bg-white dark:bg-white/10 text-[#0066FF] dark:text-blue-400 shadow-sm'
                              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                </div>

                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  aria-label="Filters"
                  className={`shrink-0 w-9 h-9 flex items-center justify-center rounded-xl border transition-colors cursor-pointer ${
                    showAdvanced || hasActiveFilters
                      ? 'border-[#0066FF]/40 text-[#0066FF] dark:text-blue-400 bg-[#0066FF]/5'
                      : 'border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5'
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    className="w-4 h-4"
                  >
                    <line x1="4" y1="7" x2="20" y2="7" />
                    <line x1="4" y1="12" x2="20" y2="12" />
                    <line x1="4" y1="17" x2="20" y2="17" />
                    <circle cx="9" cy="7" r="2" fill="currentColor" stroke="none" />
                    <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
                    <circle cx="8" cy="17" r="2" fill="currentColor" stroke="none" />
                  </svg>
                </button>
              </div>

              {showAdvanced && (
                <div className="flex items-center gap-2">
                  <select
                    value={schoolFilter}
                    onChange={(e) => {
                      setSchoolFilter(e.target.value);
                      if (e.target.value !== 'all') setScopeFilter('all');
                    }}
                    className="flex-1 min-w-0 text-xs font-semibold bg-slate-100/80 dark:bg-white/5 border border-transparent focus:border-[#0066FF]/40 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
                  >
                    <option value="all">Any School ({uniqueSchools.length})</option>
                    {uniqueSchools.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                  <select
                    value={levelFilter}
                    onChange={(e) => setLevelFilter(e.target.value)}
                    className="flex-1 min-w-0 text-xs font-semibold bg-slate-100/80 dark:bg-white/5 border border-transparent focus:border-[#0066FF]/40 rounded-xl px-3 py-2 text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
                  >
                    <option value="all">Any Level</option>
                    <option value="100">100 Level</option>
                    <option value="200">200 Level</option>
                    <option value="300">300 Level</option>
                    <option value="400">400 Level</option>
                    <option value="500">500 Level</option>
                    <option value="600">600 Level</option>
                    <option value="Postgraduate">Postgraduate</option>
                  </select>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-red-500 transition-colors cursor-pointer px-1"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {activeTab !== 'find' && <div className="pb-3" />}
        </div>
      </div>

      {/* ---------------- Scrollable list ---------------- */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="mx-auto w-full max-w-2xl px-3 sm:px-4 py-4 space-y-5">
          {activeTab === 'find' ? (
            filteredUsers.length > 0 ? (
              <Surface>
                {filteredUsers.map((u) => (
                  <UserRow
                    key={u.uid}
                    user={u}
                    status={statusFor(u.uid)}
                    onOpenChat={openChat}
                    onViewProfile={viewProfile}
                    onConnect={connect}
                    onAccept={accept}
                    onDecline={decline}
                  />
                ))}
              </Surface>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] px-6 py-12 text-center">
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                  {isSearchStale ? 'Searching…' : 'No students found'}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Try a different name, school or department.
                </p>
                {(hasActiveFilters || inputValue) && (
                  <button
                    type="button"
                    onClick={() => {
                      clearFilters();
                      setNewChatSearchQuery('');
                    }}
                    className="mt-4 text-xs font-bold text-[#0066FF] hover:underline cursor-pointer"
                  >
                    Reset search & filters
                  </button>
                )}
              </div>
            )
          ) : (
            <>
              {receivedRequests.length > 0 && (
                <section>
                  <SectionTitle>Received ({receivedRequests.length})</SectionTitle>
                  <Surface>
                    {receivedRequests.map(({ key, user }) => (
                      <UserRow
                        key={key}
                        user={user}
                        status="received"
                        onOpenChat={openChat}
                        onViewProfile={viewProfile}
                        onConnect={connect}
                        onAccept={accept}
                        onDecline={decline}
                      />
                    ))}
                  </Surface>
                </section>
              )}

              {sentRequests.length > 0 && (
                <section>
                  <SectionTitle>Sent ({sentRequests.length})</SectionTitle>
                  <Surface>
                    {sentRequests.map(({ key, user }) => (
                      <UserRow
                        key={key}
                        user={user}
                        status="sent"
                        onOpenChat={openChat}
                        onViewProfile={viewProfile}
                        onConnect={connect}
                        onAccept={accept}
                        onDecline={decline}
                      />
                    ))}
                  </Surface>
                </section>
              )}

              {receivedRequests.length === 0 && sentRequests.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] px-6 py-12 text-center">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    No pending requests
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Requests you send or receive will appear here.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('find')}
                    className="mt-4 text-xs font-bold text-[#0066FF] hover:underline cursor-pointer"
                  >
                    Find study partners →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
