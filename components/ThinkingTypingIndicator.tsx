import React, { useState, useEffect } from 'react';

export interface ThinkingTypingIndicatorProps {
  label?: string;
  className?: string;
  reasoningText?: string;
  defaultExpanded?: boolean;
  isStreaming?: boolean;
}

const STATUS_STAGES = [
  'Thinking...',
  'Consulting knowledge...',
  'Doing research...',
  'Verifying response...',
  'Synthesizing answer...',
];

export const ThinkingTypingIndicator: React.FC<ThinkingTypingIndicatorProps> = ({
  className = '',
  reasoningText = '',
  isStreaming = true,
}) => {
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStageIndex((prev) => (prev + 1) % STATUS_STAGES.length);
    }, 2400);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className={`flex flex-col text-neutral-600 dark:text-neutral-300 text-xs select-none max-w-full ${className}`}>
      <div className="inline-flex items-center gap-2.5 font-medium w-fit text-left py-1.5">
        <span className="relative flex h-3 w-3 items-center justify-center">
          <span className="inline-block rounded-full h-2.5 w-2.5 bg-blue-600 dark:bg-blue-400 animate-dot-breathe" />
        </span>
        <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400 transition-all duration-300">
          {STATUS_STAGES[stageIndex]}
        </span>
      </div>

      {reasoningText ? (
        <div className="mt-1 w-full max-w-2xl text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300 font-reading bg-slate-50/80 dark:bg-white/[0.03] p-3 rounded-2xl border border-slate-200/70 dark:border-white/10 max-h-44 overflow-y-auto whitespace-pre-wrap select-text animate-fade-in">
          {reasoningText}
          {isStreaming && (
            <span className="inline-block w-2 h-2 ml-1.5 bg-blue-600 dark:bg-blue-400 rounded-full animate-dot-breathe align-middle" />
          )}
        </div>
      ) : null}
    </div>
  );
};

export default ThinkingTypingIndicator;
