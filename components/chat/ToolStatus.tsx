import React from 'react';
import { Globe, Link2, FileText, ChevronDown } from 'lucide-react';

export interface ToolStatusProps {
  toolName: string;
  state: 'input-streaming' | 'input-available' | 'output-available' | 'output-error';
  args?: { query?: string };
  result?: any;
}

export function ToolStatus({ toolName, state, args, result }: ToolStatusProps) {
  if (toolName !== 'web_search') return null;

  // State: Browsing / Searching
  if (state === 'input-streaming' || state === 'input-available') {
    return (
      <div className="flex items-center gap-3 text-sm text-neutral-600 dark:text-neutral-400 p-3 bg-neutral-100 dark:bg-neutral-800/50 rounded-lg animate-pulse my-2">
        <Globe className="w-4 h-4 animate-spin text-blue-500" />
        <span>Browsing the web... {args?.query ? `("${args.query}")` : ''}</span>
        <ChevronDown className="w-4 h-4 ml-auto opacity-50" />
      </div>
    );
  }

  // State: Results Found
  if (state === 'output-available' && result) {
    const resultsList = Array.isArray(result) ? result : [];
    return (
      <div className="flex flex-col gap-2 p-3 bg-neutral-50 dark:bg-neutral-900/50 rounded-lg border border-neutral-200 dark:border-neutral-800 my-2">
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
          <Globe className="w-4 h-4 text-green-500" />
          <span>Found {resultsList.length} web pages</span>
          <div className="flex gap-1 ml-auto">
            {resultsList.slice(0, 3).map((r: any, i: number) => (
              <a
                key={i}
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="w-6 h-6 bg-neutral-200 dark:bg-neutral-800 rounded-full flex items-center justify-center hover:bg-neutral-300 dark:hover:bg-neutral-700 transition-colors"
                title={r.title || r.url}
              >
                <Link2 className="w-3 h-3 text-neutral-600 dark:text-neutral-300" />
              </a>
            ))}
          </div>
        </div>
        {resultsList.length > 0 && resultsList[0]?.url && (
          <div className="flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400 pl-6">
            <FileText className="w-3 h-3" />
            <span className="truncate">Read page {resultsList[0].url}</span>
          </div>
        )}
      </div>
    );
  }

  if (state === 'output-error') {
    return (
      <div className="text-sm text-red-500 p-2.5 bg-red-50 dark:bg-red-950/30 rounded-lg border border-red-200 dark:border-red-900/50 my-2">
        Failed to search the web.
      </div>
    );
  }

  return null;
}
