import React, { useState, useEffect } from 'react';
import { Sparkles, Mic, Clock, BookOpen } from 'lucide-react';

export interface LiveClassroomLoadingScreenProps {
  topicTitle: string;
  courseName?: string;
  durationMinutes: number;
  selectedVoice: string;
  onComplete: () => void;
}

export const LiveClassroomLoadingScreen: React.FC<LiveClassroomLoadingScreenProps> = ({
  topicTitle,
  courseName,
  durationMinutes,
  selectedVoice,
  onComplete,
}) => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const duration = 2800; // 2.8 seconds smooth loading progression

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const rawProgress = Math.min(100, Math.floor((elapsed / duration) * 100));

      setProgress(rawProgress);

      if (rawProgress >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          onComplete();
        }, 300);
      }
    }, 40);

    return () => clearInterval(interval);
  }, [onComplete]);

  const getStatusText = (prog: number) => {
    if (prog < 25) return 'Configuring AI Teacher Engine...';
    if (prog < 50) return `Calibrating Voice Synthesizer (${selectedVoice})...`;
    if (prog < 75) return 'Setting up Interactive Whiteboard...';
    if (prog < 98) return 'Establishing Realtime Classroom Stream...';
    return 'Ready! Entering Classroom...';
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#0A0A0A] flex flex-col items-center justify-center p-6 text-white select-none overflow-hidden">
      {/* Subtle Red Ambient Glow in Background */}
      <div className="absolute top-1/4 w-[500px] h-[500px] bg-red-600/10 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative w-full max-w-lg mx-auto flex flex-col items-center text-center space-y-6">
        {/* Pulsing Live Badge */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-red-500/10 border border-red-500/25 text-red-400 text-xs font-bold tracking-wider uppercase shadow-[0_0_15px_rgba(239,68,68,0.2)]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
          <span>Preparing Live Classroom</span>
        </div>

        {/* Topic Title & Course */}
        <div className="space-y-2">
          {courseName && (
            <p className="text-xs font-semibold text-white/40 uppercase tracking-widest">
              {courseName}
            </p>
          )}
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white line-clamp-2">
            {topicTitle}
          </h1>
        </div>

        {/* Selected Parameters Badges */}
        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-white/70">
            <Clock className="w-3.5 h-3.5 text-red-400" />
            <span>{durationMinutes} Minutes</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-white/70">
            <Mic className="w-3.5 h-3.5 text-red-400" />
            <span>Voice: <strong className="text-white">{selectedVoice}</strong></span>
          </div>
        </div>

        {/* Straight Line Red Progress Bar */}
        <div className="w-full max-w-md pt-6 space-y-3">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-white/60 tracking-wide transition-all duration-200">
              {getStatusText(progress)}
            </span>
            <span className="text-red-400 font-bold tabular-nums">
              {progress}%
            </span>
          </div>

          {/* Straight line bar container */}
          <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden p-0.5 border border-white/10 shadow-inner">
            <div
              className="h-full bg-gradient-to-r from-red-600 via-red-500 to-rose-400 rounded-full shadow-[0_0_20px_rgba(239,68,68,0.9)] transition-all duration-75 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveClassroomLoadingScreen;
