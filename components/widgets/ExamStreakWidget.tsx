import React, { useState, useEffect } from 'react';
import { Flame, Calendar, Clock, Edit2, ArrowRight, BookOpen, Mic, X, Check } from 'lucide-react';
import type { UserProfile } from '../../types';

interface ExamStreakWidgetProps {
  userProfile?: UserProfile | null;
  onNavigate?: (tab: string) => void;
  className?: string;
}

interface ExamTarget {
  examName: string;
  targetDate: string; // ISO date string 'YYYY-MM-DD'
  subject?: string;
}

const PRESET_EXAMS = [
  'Physics WAEC/GCSE',
  'Mathematics WAEC',
  'Chemistry JAMB',
  'Biology GCSE',
  'English Language WAEC',
  'Physics JAMB',
  'Further Maths GCSE',
  'University Finals',
];

export const ExamStreakWidget: React.FC<ExamStreakWidgetProps> = ({
  userProfile,
  onNavigate,
  className = '',
}) => {
  const userId = userProfile?.uid || 'guest';
  const streakCount = userProfile?.current_streak ?? 1;

  // Load target exam from storage with default: 18 days until Physics WAEC/GCSE
  const [examTarget, setExamTarget] = useState<ExamTarget>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(`avelut_exam_target_${userId}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed?.examName && parsed?.targetDate) return parsed;
        }
      } catch {}
    }

    // Default target date: exactly 18 days from today
    const d = new Date();
    d.setDate(d.getDate() + 18);
    const dateStr = d.toISOString().split('T')[0];

    return {
      examName: 'Physics WAEC/GCSE',
      targetDate: dateStr,
      subject: 'Physics',
    };
  });

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(examTarget.examName);
  const [editDate, setEditDate] = useState(examTarget.targetDate);

  // Calculate days remaining
  const calculateDaysRemaining = (targetDateStr: string): number => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(targetDateStr);
    target.setHours(0, 0, 0, 0);
    const diffTime = target.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  };

  const daysRemaining = calculateDaysRemaining(examTarget.targetDate);

  const handleSaveTarget = () => {
    const trimmed = editName.trim() || 'Physics WAEC/GCSE';
    const newTarget: ExamTarget = {
      examName: trimmed,
      targetDate: editDate,
    };
    setExamTarget(newTarget);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(`avelut_exam_target_${userId}`, JSON.stringify(newTarget));
      } catch {}
    }
    setIsEditing(false);
  };

  return (
    <div
      className={`w-full max-w-3xl mx-auto rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-[#121215] p-5 sm:p-6 transition-all select-none ${className}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left: Study Streak */}
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Flame className="w-6 h-6 text-amber-500 fill-amber-500 animate-pulse" />
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-lg sm:text-xl font-black tracking-tight text-neutral-900 dark:text-white">
                🔥 {streakCount} {streakCount === 1 ? 'Day' : 'Days'} Streak
              </span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                Active
              </span>
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              Study daily to keep your exam readiness sharp!
            </p>
          </div>
        </div>

        {/* Right: Exam Countdown Badge */}
        <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-neutral-200/60 dark:border-neutral-800">
          <div className="flex flex-col sm:items-end">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
              <Calendar className="w-3.5 h-3.5 text-red-500" />
              <span className="truncate max-w-[170px]">{examTarget.examName}</span>
              <button
                type="button"
                onClick={() => {
                  setEditName(examTarget.examName);
                  setEditDate(examTarget.targetDate);
                  setIsEditing(true);
                }}
                className="p-1 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
                title="Change Exam / Date"
              >
                <Edit2 className="w-3 h-3 opacity-60 hover:opacity-100" />
              </button>
            </div>

            <div className="flex items-baseline gap-1 mt-0.5">
              <span className="text-xl sm:text-2xl font-black text-red-600 dark:text-red-500 tabular-nums">
                {daysRemaining}
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
                {daysRemaining === 1 ? 'Day left' : 'Days left'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Launch Action Strip */}
      <div className="mt-4 pt-4 border-t border-neutral-200/60 dark:border-neutral-800/80 flex flex-wrap items-center justify-between gap-2.5">
        <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-red-500" />
          <span>Target: {new Date(examTarget.targetDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
        </div>

        <div className="flex items-center gap-2">
          {onNavigate && (
            <>
              <button
                type="button"
                onClick={() => onNavigate('voice_tutorial')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition-all active:scale-95 cursor-pointer"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>Live Tutorial</span>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('notebooks')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-300 dark:hover:bg-neutral-700 text-neutral-800 dark:text-neutral-200 text-xs font-bold transition-all active:scale-95 cursor-pointer"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Notebooks</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Target Customization Modal */}
      {isEditing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#18181B] border border-neutral-200 dark:border-neutral-800 p-5 shadow-2xl text-neutral-900 dark:text-white space-y-4">
            <div className="flex items-center justify-between border-b border-neutral-200/60 dark:border-neutral-800 pb-3">
              <h3 className="text-base font-bold">Set Exam Countdown</h3>
              <button
                onClick={() => setIsEditing(false)}
                className="p-1 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 block mb-1">
                  Exam Title
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="e.g. Physics WAEC/GCSE"
                  className="w-full px-3 py-2 text-sm rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent text-neutral-900 dark:text-white focus:outline-none focus:border-red-500"
                />
              </div>

              {/* Quick Presets */}
              <div>
                <span className="text-[11px] font-semibold text-neutral-400 block mb-1">
                  Popular Presets:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_EXAMS.slice(0, 4).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setEditName(p)}
                      className="text-[11px] px-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-red-500/10 hover:text-red-500 transition-colors cursor-pointer"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 block mb-1">
                  Exam Date
                </label>
                <input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl border border-neutral-300 dark:border-neutral-700 bg-transparent text-neutral-900 dark:text-white focus:outline-none focus:border-red-500"
                />
              </div>
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-3.5 py-2 text-xs font-semibold rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveTarget}
                className="px-4 py-2 text-xs font-bold rounded-xl bg-red-600 hover:bg-red-700 text-white flex items-center gap-1.5 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save Target</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExamStreakWidget;
