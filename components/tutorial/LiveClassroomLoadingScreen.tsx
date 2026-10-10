import React, { useState, useEffect } from 'react';
import { Mic, Clock } from 'lucide-react';

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
    const duration = 2400; // 2.4 seconds smooth loading progression

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const rawProgress = Math.min(100, Math.floor((elapsed / duration) * 100));

      setProgress(rawProgress);

      if (rawProgress >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          onComplete();
        }, 200);
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
    <div className="fixed inset-0 z-50 bg-[#0A0A0A] flex flex-col items-center justify-center p-6 text-white select-none">
      <div className="relative w-full max-w-lg mx-auto flex flex-col items-center text-center space-y-6">
        {/* Flat Plain Badge (No pulsing, no glow) */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-neutral-900 border border-neutral-800 text-neutral-300 text-xs font-semibold tracking-wider uppercase">
          <span className="w-2 h-2 rounded-full bg-red-600" />
          <span>Live Classroom</span>
        </div>

        {/* Topic Title & Course */}
        <div className="space-y-2">
          {courseName && (
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-widest">
              {courseName}
            </p>
          )}
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white line-clamp-2">
            {topicTitle}
          </h1>
        </div>

        {/* Parameters Badges (Flat neutral) */}
        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-900 border border-neutral-800 text-xs text-neutral-300">
            <Clock className="w-3.5 h-3.5 text-red-500" />
            <span>{durationMinutes} Minutes</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-900 border border-neutral-800 text-xs text-neutral-300">
            <Mic className="w-3.5 h-3.5 text-red-500" />
            <span>Voice: <strong className="text-white">{selectedVoice}</strong></span>
          </div>
        </div>

        {/* Straight Line Red Progress Bar (Flat, brutal/plain coloring, no glow) */}
        <div className="w-full max-w-md pt-6 space-y-3">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-neutral-400 tracking-wide">
              {getStatusText(progress)}
            </span>
            <span className="text-red-500 font-bold tabular-nums">
              {progress}%
            </span>
          </div>

          {/* Straight line bar container */}
          <div className="w-full h-2 bg-neutral-900 rounded-sm overflow-hidden border border-neutral-800">
            <div
              className="h-full bg-red-600 transition-all duration-75 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveClassroomLoadingScreen;
