import React, { useState } from 'react';
import { saveCBTExam, saveFlashcardDeck } from '../services/playgroundStorageService';
import type { CBTExam, CBTExamQuestion, FlashcardDeck } from '../types/playground';

interface ActionCardProps {
  type: 'cbt' | 'flashcards' | 'action:cbt' | 'action:flashcards' | 'quiz' | 'action:quiz';
  rawPayload: string;
}

export const ActionCard: React.FC<ActionCardProps> = ({ type, rawPayload }) => {
  const [isSaved, setIsSaved] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);

  let data: any = null;
  try {
    data = JSON.parse(rawPayload);
  } catch {
    // If partial JSON while streaming, return null or placeholder
    return null;
  }

  if (!data || typeof data !== 'object') return null;

  const isCBT = type.includes('cbt') || type.includes('quiz') || type.includes('test') || Array.isArray(data.questions);
  const title = data.title || (isCBT ? 'Practice CBT Exam' : 'Flashcard Study Deck');
  const topicName = data.topicName || data.topic || 'General Practice';
  const itemCount = Array.isArray(data.questions)
    ? data.questions.length
    : Array.isArray(data.cards)
    ? data.cards.length
    : data.itemCount || 10;
  const duration = data.durationMinutes || 15;

  const handleAction = async () => {
    setIsLaunching(true);
    try {
      const lastUid = typeof window !== 'undefined' ? localStorage.getItem('avelut_last_uid') : null;
      let userId = lastUid || 'local_user';
      if (lastUid) {
        const cached = localStorage.getItem(`avelut_profile_${lastUid}`);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (parsed?.uid) userId = parsed.uid;
          } catch {}
        }
      }

      if (isCBT) {
        const examId = data.id || `cbt_${Date.now()}`;
        const optionLetters = ['a', 'b', 'c', 'd', 'e', 'f'];

        const questions: CBTExamQuestion[] = (data.questions || []).map((q: any, idx: number) => {
          const rawOptions = Array.isArray(q.options) ? q.options : [];
          let detectedCorrectId = '';

          // Determine correctOptionId based on various possible AI formats
          if (typeof q.correctOptionId === 'string' && q.correctOptionId.trim()) {
            detectedCorrectId = q.correctOptionId.trim().toLowerCase();
          } else if (typeof q.correct_option_id === 'string' && q.correct_option_id.trim()) {
            detectedCorrectId = q.correct_option_id.trim().toLowerCase();
          } else if (typeof q.correctAnswer === 'number' && rawOptions[q.correctAnswer] !== undefined) {
            detectedCorrectId = optionLetters[q.correctAnswer] || `opt_${q.correctAnswer}`;
          } else if (typeof q.correctAnswer === 'string') {
            const trimmed = q.correctAnswer.trim();
            // Single letter e.g. "A", "b"
            if (/^[a-fA-F]$/.test(trimmed)) {
              detectedCorrectId = trimmed.toLowerCase();
            }
          }

          const options = rawOptions.map((opt: any, oIdx: number) => {
            const optLetter = optionLetters[oIdx] || `opt_${oIdx}`;
            const optText = typeof opt === 'string' ? opt : (opt.text || opt.label || '');
            const optId = String(opt?.id || optLetter).toLowerCase();

            // Check if this option matches correct answer text
            if (!detectedCorrectId && typeof q.correctAnswer === 'string' && q.correctAnswer.trim()) {
              if (optText.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase()) {
                detectedCorrectId = optId;
              }
            }
            if (!detectedCorrectId && (opt.isCorrect || opt.is_correct)) {
              detectedCorrectId = optId;
            }

            return {
              id: optId,
              text: optText,
            };
          });

          // Fallback to first option if not detected
          if (!detectedCorrectId && options.length > 0) {
            detectedCorrectId = options[0].id;
          }

          return {
            id: q.id || `q_${idx + 1}`,
            prompt: q.prompt || q.question || '',
            options,
            correctOptionId: detectedCorrectId,
            explanation: q.explanation || '',
          };
        });

        const exam: CBTExam = {
          id: examId,
          title,
          topicName,
          durationMinutes: duration,
          questions,
          createdAt: Date.now(),
        };

        // Cache synchronously in sessionStorage for immediate zero-latency transition
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(`active_cbt_${examId}`, JSON.stringify(exam));
          sessionStorage.setItem(
            'avelut_playground_target',
            JSON.stringify({ type: 'cbt_exam', examId, exam })
          );
        }

        // Persist to offline storage
        try {
          await saveCBTExam(userId, exam);
          if (userId !== 'local_user') {
            await saveCBTExam('local_user', exam);
          }
        } catch (e) {
          console.warn('Error persisting CBT exam:', e);
        }

        setIsSaved(true);

        // Open CBT Exam directly in the app
        window.dispatchEvent(
          new CustomEvent('avelut_navigate', {
            detail: {
              view: 'playground',
              path: `/playground/cbt/${examId}`,
              examId,
              type: 'cbt_exam',
              exam,
            },
          })
        );
      } else {
        const deckId = data.id || `deck_${Date.now()}`;
        const deck: FlashcardDeck = {
          id: deckId,
          title,
          topicName,
          cards: (data.cards || []).map((c: any, idx: number) => ({
            id: c.id || `card_${idx + 1}`,
            front: c.front || c.question || '',
            back: c.back || c.answer || '',
          })),
          createdAt: Date.now(),
        };

        // Cache synchronously in sessionStorage for immediate zero-latency transition
        if (typeof window !== 'undefined') {
          sessionStorage.setItem(`active_deck_${deckId}`, JSON.stringify(deck));
          sessionStorage.setItem(
            'avelut_playground_target',
            JSON.stringify({ type: 'flashcards_study', deckId, deck })
          );
        }

        // Persist to offline storage
        try {
          await saveFlashcardDeck(userId, deck);
          if (userId !== 'local_user') {
            await saveFlashcardDeck('local_user', deck);
          }
        } catch (e) {
          console.warn('Error persisting flashcard deck:', e);
        }

        setIsSaved(true);

        // Open Flashcard Deck directly in the app
        window.dispatchEvent(
          new CustomEvent('avelut_navigate', {
            detail: {
              view: 'playground',
              path: `/playground/flashcards/${deckId}`,
              deckId,
              type: 'flashcards_study',
              deck,
            },
          })
        );
      }
    } catch (err) {
      console.error('Error launching action card:', err);
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <div className="not-prose my-5 w-full rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-gradient-to-br from-neutral-50 via-white to-neutral-100 dark:from-[#131518] dark:via-[#101214] dark:to-[#0a0b0d] p-5 sm:p-6 shadow-md overflow-hidden relative group">
      {/* Subtle ambient lighting */}
      <div className={`absolute -top-12 -right-12 w-36 h-36 rounded-full blur-3xl pointer-events-none ${
        isCBT ? 'bg-blue-500/15' : 'bg-emerald-500/15'
      }`} />

      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left Side: Icon & Details */}
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${
            isCBT
              ? 'bg-blue-600 text-white shadow-blue-500/20'
              : 'bg-emerald-600 text-white shadow-emerald-500/20'
          }`}>
            {isCBT ? (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            )}
          </div>

          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                isCBT
                  ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                  : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
              }`}>
                {isCBT ? 'CBT Test Ready' : 'Flashcards Deck'}
              </span>
              <span className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">
                {isCBT ? `${itemCount} Questions • ${duration} Mins` : `${itemCount} Cards`}
              </span>
            </div>

            <h4 className="text-base font-extrabold text-neutral-900 dark:text-white leading-snug">
              {title}
            </h4>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              Topic: <strong className="text-neutral-700 dark:text-neutral-300">{topicName}</strong>
            </p>
          </div>
        </div>

        {/* Right Side: Launch Button */}
        <div className="sm:self-center shrink-0">
          <button
            type="button"
            onClick={handleAction}
            disabled={isLaunching}
            className={`w-full sm:w-auto px-6 py-3 rounded-2xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md active:scale-95 text-white ${
              isCBT
                ? 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
                : 'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800'
            }`}
          >
            <span>{isLaunching ? 'Opening...' : isCBT ? 'Start CBT Test' : 'Open Flashcards'}</span>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
