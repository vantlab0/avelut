import React, { useState } from 'react';
import type { AppSettings } from '../../../types';
import { createAvelutAI, getResponseText } from '../../../utils/inference';
import { AVELUT_TEXT_MODEL } from '../../../lib/textModel';

interface AIModelProviderSelectorProps {
  appSettings: Partial<AppSettings>;
  onChange?: (updated: Partial<AppSettings>) => void;
}

/**
 * Read-only text model status. Avelut uses exactly one text model; there are
 * no per-feature or provider model selectors. Provider keys live server-side
 * in Supabase api_keys (with env fallback) and are never edited in the browser.
 */
export const AIModelProviderSelector: React.FC<AIModelProviderSelectorProps> = ({
  appSettings,
  onChange: _onChange,
}) => {
  void _onChange;
  const [testPrompt, setTestPrompt] = useState("Explain Newton's Second Law in 2 concise sentences with an equation.");
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ text: string; latencyMs: number; error?: string } | null>(null);

  const handleTestInference = async () => {
    setIsTesting(true);
    setTestResult(null);
    const startTime = Date.now();

    try {
      const client = createAvelutAI(appSettings as AppSettings, null);
      if (!client) {
        throw new Error('Alibaba client could not be instantiated. Check the server-side AI configuration.');
      }

      const response = await client.models.generateContent({
        contents: testPrompt,
        config: {
          temperature: 0.7,
        },
      });

      const latencyMs = Date.now() - startTime;
      const text = getResponseText(response);
      setTestResult({ text, latencyMs });
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      setTestResult({ text: '', latencyMs, error: err.message || 'Unknown error' });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-[#0A0A0A] p-6 sm:p-7 rounded-3xl border border-slate-200 dark:border-white/10 shadow-sm space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-white/10 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center text-amber-500">
            <i className="bi bi-cpu-fill text-xl"></i>
          </div>
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white">Alibaba AI Engine</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Qwen models powered by Alibaba Cloud DashScope / Model Studio</p>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/50">
          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
          <span className="text-xs font-bold text-amber-900 dark:text-amber-300">
            Active: Alibaba Qwen ({AVELUT_TEXT_MODEL})
          </span>
        </div>
      </div>

      <div className="p-5 rounded-2xl border-2 border-amber-500 bg-amber-50/50 dark:bg-amber-950/20 shadow-md ring-2 ring-amber-500/20">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Alibaba Integration</span>
          <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-black uppercase tracking-wider">Default & Active</span>
        </div>
        <h4 className="text-sm font-black text-slate-900 dark:text-white flex items-center gap-2 mb-1">
          <i className="bi bi-lightning-charge-fill text-amber-500"></i> {AVELUT_TEXT_MODEL}
        </h4>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          The single canonical text model for all Avelut AI features. Model selection is locked; caller-supplied
          models and legacy aliases are normalized to this value on the server.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="px-2.5 py-1 text-xs font-mono rounded-lg bg-amber-500 text-white border border-amber-500">
            {AVELUT_TEXT_MODEL}
          </span>
        </div>
      </div>

      <div className="p-5 rounded-2xl bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/10 space-y-2">
        <h4 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Credentials</h4>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          The DashScope API key is managed server-side in the Supabase <code>api_keys</code> table (provider{' '}
          <code>alibaba</code>) with a server environment-variable fallback. It cannot be viewed or changed here.
        </p>
      </div>

      <div className="p-5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/30 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-black uppercase tracking-wider text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
            <i className="bi bi-lightning-charge-fill text-amber-500"></i> Live Alibaba Qwen Benchmark & Test
          </h4>
          {testResult && (
            <span className="px-2 py-0.5 rounded-full bg-white dark:bg-[#0A0A0A] border border-amber-200 dark:border-amber-800/40 text-[10px] font-mono font-bold text-amber-600 dark:text-amber-400">
              ⚡ {testResult.latencyMs}ms
            </span>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={testPrompt}
            onChange={(e) => setTestPrompt(e.target.value)}
            placeholder="Type a test prompt..."
            className="flex-1 p-3 rounded-xl bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white text-xs outline-none focus:border-amber-500"
          />
          <button
            type="button"
            onClick={handleTestInference}
            disabled={isTesting}
            className="px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
          >
            <i className={`bi ${isTesting ? 'bi-arrow-repeat animate-spin' : 'bi-send-fill'}`}></i>
            <span>{isTesting ? 'Testing...' : 'Test Response'}</span>
          </button>
        </div>

        {testResult && (
          <div className="p-3.5 rounded-xl bg-white dark:bg-[#0A0A0A] border border-slate-200 dark:border-white/10 text-xs space-y-1">
            {testResult.error ? (
              <p className="text-rose-600 dark:text-rose-400 font-bold">❌ Error: {testResult.error}</p>
            ) : (
              <div>
                <p className="font-bold text-slate-900 dark:text-white mb-1">Response:</p>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{testResult.text}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
