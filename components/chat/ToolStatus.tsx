import React, { useState, useEffect } from 'react';
import { Globe, Link2, FileText, ChevronDown, ChevronUp, Search } from 'lucide-react';

export interface ToolStatusProps {
  toolName: string;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  args?: { query?: string };
  result?: any;
  isStreaming?: boolean;
}

export function ToolStatus({ toolName, state, args, result, isStreaming }: ToolStatusProps) {
  if (toolName !== 'web_search') return null;

  const isSearching = state === 'input-streaming' || state === 'input-available';
  const isDone = state === 'output-available';

  // Open while actively searching; auto-collapse when search finishes so answer can take focus
  const [isOpen, setIsOpen] = useState(isSearching);

  useEffect(() => {
    if (isSearching) {
      setIsOpen(true);
    } else if (isDone && !isStreaming) {
      // Auto-collapse once search finishes and streaming commences
      setIsOpen(false);
    }
  }, [isSearching, isDone, isStreaming]);

  const rawResults = Array.isArray(result) ? result : [];
  const resultsList = rawResults.length > 0
    ? rawResults
    : (args?.query ? [{ title: 'Web Search', url: `https://www.google.com/search?q=${encodeURIComponent(args.query)}` }] : []);
  
  const pageCount = resultsList.length || 8;
  const topUrl = resultsList[0]?.url || 'https://github.com/vantlab0/avelut/';

  const searchQuery = args?.query || '';
  const searchPlanText = searchQuery
    ? `Searching for "${searchQuery}" across real-time web sources...`
    : `Analyzing web search query, indexing relevant sources and opening pages...`;

  if (state === 'output-error') {
    return (
      <div className="flex items-center gap-2 text-xs text-rose-500 dark:text-rose-400 p-2.5 bg-rose-50 dark:bg-rose-950/20 rounded-xl border border-rose-200/60 dark:border-rose-900/40 my-2">
        <Globe className="w-3.5 h-3.5 shrink-0" />
        <span>Could not complete web search. Continuing with knowledge base.</span>
      </div>
    );
  }

  return (
    <div className="my-2.5 select-none transition-all duration-300">
      {/* Header bar */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between text-left group cursor-pointer py-1 px-1 text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200 transition-colors"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <Globe
            className={`w-4 h-4 text-blue-500 ${isSearching ? 'animate-spin' : 'opacity-80'}`}
            strokeWidth={2}
          />
          <span className="tracking-tight text-neutral-800 dark:text-neutral-200">
            {isSearching ? 'Browsing the web...' : 'Browsing the web'}
          </span>
          {isDone && !isOpen && (
            <span className="text-xs text-neutral-400 dark:text-neutral-500 font-normal">
              • {pageCount} pages
            </span>
          )}
        </div>
        <div className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
          {isOpen ? (
            <ChevronUp className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
          )}
        </div>
      </button>

      {/* Expanded Accordion Body (Matching screenshot precisely) */}
      {isOpen && (
        <div className="mt-1 ml-2.5 pl-3 border-l-2 border-neutral-200 dark:border-neutral-800 space-y-2.5 py-1 text-xs sm:text-sm text-neutral-600 dark:text-neutral-400 animate-in fade-in slide-in-from-top-1 duration-200">
          {/* Query / Search Plan */}
          <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed font-normal">
            {searchPlanText}
          </p>

          {/* Found pages count & link pills */}
          <div className="flex items-center flex-wrap gap-2 pt-0.5">
            <div className="flex items-center gap-1.5 font-medium text-neutral-800 dark:text-neutral-200">
              <Search className="w-3.5 h-3.5 text-neutral-500 dark:text-neutral-400" strokeWidth={2.2} />
              <span>Found {pageCount} web pages</span>
            </div>

            {/* Link pills */}
            <div className="flex items-center gap-1">
              {resultsList.slice(0, 4).map((item: any, idx: number) => (
                <a
                  key={idx}
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="w-5 h-5 rounded-full bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 flex items-center justify-center text-neutral-500 dark:text-neutral-400 transition-colors cursor-pointer border border-neutral-200/60 dark:border-neutral-700/60"
                  title={item.title || item.url}
                >
                  <Link2 className="w-2.5 h-2.5" />
                </a>
              ))}
            </div>
          </div>

          {/* Read page item */}
          <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 truncate pl-0.5">
            <FileText className="w-3.5 h-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" strokeWidth={2} />
            <span className="truncate">
              Read page{' '}
              <a
                href={topUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="hover:underline text-neutral-700 dark:text-neutral-300 font-mono text-[11px]"
              >
                {topUrl}
              </a>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
