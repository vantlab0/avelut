import React, { useState, useEffect } from 'react';

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

  return (
    <div className="fixed inset-0 z-50 bg-[#0A0A0A] flex flex-col items-center justify-center p-6 text-white select-none">
      <div className="relative w-full max-w-md mx-auto flex flex-col items-center text-center space-y-6">
        {/* Topic Title */}
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white line-clamp-2">
          {topicTitle}
        </h1>

        {/* Straight Line Red Progress Bar */}
        <div className="w-full pt-4 space-y-3">
          <div className="flex items-center justify-between text-xs font-medium">
            <span className="text-neutral-400 tracking-wide">
              Initializing Classroom...
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
