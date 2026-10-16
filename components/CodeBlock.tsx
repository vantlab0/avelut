import React, { useState, useEffect } from 'react';
import { Copy, Check, Eye, Code2 } from 'lucide-react';
import { codeToHtml } from 'shiki';

interface CodeBlockProps {
  language?: string;
  value: string;
}

// In-memory cache to guarantee 0ms instant rendering on repeated/cached blocks
const highlightCache = new Map<string, string>();

const normalizeLanguage = (lang?: string): string => {
  const l = (lang || '').toLowerCase().trim();
  const map: Record<string, string> = {
    js: 'javascript',
    javascript: 'javascript',
    ts: 'typescript',
    typescript: 'typescript',
    py: 'python',
    python: 'python',
    sh: 'bash',
    bash: 'bash',
    shell: 'bash',
    zsh: 'bash',
    html: 'html',
    css: 'css',
    c: 'c',
    cpp: 'cpp',
    'c++': 'cpp',
    cs: 'csharp',
    'c#': 'csharp',
    csharp: 'csharp',
    java: 'java',
    rust: 'rust',
    rs: 'rust',
    go: 'go',
    golang: 'go',
    php: 'php',
    sql: 'sql',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
    markdown: 'markdown',
    jsx: 'jsx',
    tsx: 'tsx',
    xml: 'xml',
    svg: 'svg',
    kotlin: 'kotlin',
    kt: 'kotlin',
    swift: 'swift',
    ruby: 'ruby',
    rb: 'ruby',
    dart: 'dart',
  };
  return map[l] || (l ? l : 'text');
};

export const CodeBlock: React.FC<CodeBlockProps> = ({ language = 'code', value }) => {
  const [copied, setCopied] = useState(false);
  const normalizedLang = normalizeLanguage(language);
  const svgMatch = value.match(/<svg[\s\S]*?<\/svg>/i);
  const isSvg = normalizedLang === 'svg' || !!svgMatch;
  const svgContent = svgMatch ? svgMatch[0] : value;
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>(isSvg ? 'preview' : 'code');

  useEffect(() => {
    if (isSvg) {
      setActiveTab('preview');
    }
  }, [isSvg]);

  const cacheKey = `${normalizedLang}:${value}`;

  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(() => {
    return highlightCache.get(cacheKey) || null;
  });

  useEffect(() => {
    const cached = highlightCache.get(cacheKey);
    if (cached) {
      setHighlightedHtml(cached);
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        const langToUse = normalizedLang === 'svg' ? 'xml' : normalizedLang;
        const html = await codeToHtml(value, {
          lang: langToUse,
          theme: 'github-dark',
        });
        if (isMounted) {
          highlightCache.set(cacheKey, html);
          setHighlightedHtml(html);
        }
      } catch {
        try {
          const fallbackHtml = await codeToHtml(value, {
            lang: 'text',
            theme: 'github-dark',
          });
          if (isMounted) {
            highlightCache.set(cacheKey, fallbackHtml);
            setHighlightedHtml(fallbackHtml);
          }
        } catch {
          // Keep raw text fallback
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [value, normalizedLang, cacheKey]);

  const handleCopy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const displayLanguage = isSvg ? 'SVG Visual Diagram' : (language || 'code').toLowerCase().trim();

  return (
    <div className="not-prose my-4 w-full rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-[#0d1117] text-neutral-100 shadow-md">
      {/* Code Header Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#161b22] border-b border-neutral-800 text-xs text-neutral-400 font-mono select-none">
        <div className="flex items-center gap-2.5">
          <span className="flex gap-1.5 items-center">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80 inline-block" />
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80 inline-block" />
          </span>
          <span className="font-semibold tracking-wider uppercase ml-1 text-[11px] text-neutral-300">
            {displayLanguage}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* SVG Preview / Code Toggle Switcher */}
          {isSvg && (
            <div className="flex items-center bg-neutral-800/80 rounded-lg p-0.5 border border-neutral-700/60 mr-1.5">
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-sans transition-all cursor-pointer ${
                  activeTab === 'preview'
                    ? 'bg-blue-600 text-white font-bold shadow-xs'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Eye className="w-3 h-3" />
                <span>Diagram</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('code')}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-sans transition-all cursor-pointer ${
                  activeTab === 'code'
                    ? 'bg-blue-600 text-white font-bold shadow-xs'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                <Code2 className="w-3 h-3" />
                <span>Code</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-sans text-neutral-300 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer active:scale-95"
            title="Copy code to clipboard"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-medium">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* SVG Interactive Visual Preview */}
      {isSvg && activeTab === 'preview' ? (
        <div className="p-6 overflow-x-auto flex items-center justify-center bg-white dark:bg-[#111215] border-t border-neutral-200 dark:border-neutral-800/80 min-h-[200px] text-neutral-900 dark:text-neutral-100 [&_svg]:max-w-full [&_svg]:max-h-[460px] [&_svg]:h-auto [&_svg]:w-auto [&_svg]:mx-auto select-none rounded-b-2xl">
          <div className="w-full flex justify-center" dangerouslySetInnerHTML={{ __html: svgContent }} />
        </div>
      ) : (
        /* Syntax Highlighted Code Body */
        <div className="p-4 overflow-x-auto text-[13.5px] leading-relaxed font-mono font-normal whitespace-pre text-neutral-100 [&_pre]:!bg-transparent [&_pre]:!m-0 [&_pre]:!p-0 [&_code]:!bg-transparent [&_code]:!p-0 [&_code]:!font-mono">
          {highlightedHtml ? (
            <div dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
          ) : (
            <code>{value}</code>
          )}
        </div>
      )}
    </div>
  );
};
