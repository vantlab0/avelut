import React, { useState, useEffect } from 'react';

export interface ThinkingTypingIndicatorProps {
  label?: string;
  className?: string;
  reasoningText?: string;
  defaultExpanded?: boolean;
  isStreaming?: boolean;
}

export const ThinkingTypingIndicator: React.FC<ThinkingTypingIndicatorProps> = ({
  className = '',
  reasoningText = '',
  isStreaming = true,
}) => {
  return (
    <div className={`flex flex-col text-slate-600 dark:text-slate-300 text-xs select-none max-w-full ${className}`}>
      <div className="inline-flex items-center gap-2.5 font-medium w-fit text-left py-1.5">
        <span className="relative flex h-2.5 w-2.5 items-center justify-center">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
        </span>
      </div>

      {reasoningText ? (
        <div className="mt-1 w-full max-w-2xl text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300 font-reading bg-slate-50/80 dark:bg-white/[0.03] p-3 rounded-2xl border border-slate-200/70 dark:border-white/10 max-h-44 overflow-y-auto whitespace-pre-wrap select-text animate-fade-in">
          {reasoningText}
          {isStreaming && (
            <span className="inline-block w-2 h-2 ml-1.5 bg-blue-500 dark:bg-blue-400 rounded-full animate-pulse shadow-[0_0_6px_rgba(59,130,246,0.8)] align-middle" />
          )}
        </div>
      ) : null}
    </div>
  );
};

export default ThinkingTypingIndicator;
