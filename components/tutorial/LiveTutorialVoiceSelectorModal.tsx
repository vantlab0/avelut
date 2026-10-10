import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Mic, Play, Pause, Check, X, ArrowRight, Volume2, ShieldCheck } from 'lucide-react';
import { unifiedVoiceRouter, UnifiedAudioPlayer } from '../../services/voice/UnifiedVoiceRouter';
import { useAppSettings } from '../../hooks/useAppSettings';
import { useToast } from '../../hooks/useToast';

export interface VoiceOption {
  id: string;
  name: string;
  gender: 'Male' | 'Female';
  persona: string;
  sampleText: string;
  tag?: string;
}

export const TUTORIAL_VOICES: VoiceOption[] = [
  {
    id: 'Katerina',
    name: 'Katerina',
    gender: 'Female',
    persona: 'Engaging, expressive, and articulate university lecturer.',
    sampleText: "Hello! I will be your live lecturer today. Let's break down this topic step-by-step on the interactive whiteboard.",
    tag: 'Recommended',
  },
  {
    id: 'Ethan',
    name: 'Ethan',
    gender: 'Male',
    persona: 'Conversational, friendly, and warm academic tutor.',
    sampleText: "Welcome! We'll explore core principles and work through intuitive examples together.",
    tag: 'Friendly',
  },
  {
    id: 'Harry',
    name: 'Harry',
    gender: 'Male',
    persona: 'Energetic, dynamic, and confident instructor.',
    sampleText: "Great to have you here! Let's dive deep into this concept and master it together with full energy.",
    tag: 'Energetic',
  },
  {
    id: 'Luna',
    name: 'Luna',
    gender: 'Female',
    persona: 'Gentle, calm, patient, and sweet conceptual mentor.',
    sampleText: "Hi there. Take your time as we visualize this topic together. Ask me questions whenever you'd like.",
    tag: 'Calm & Patient',
  },
  {
    id: 'Mason',
    name: 'Mason',
    gender: 'Male',
    persona: 'Academic, professional, structured, and clear professor.',
    sampleText: "Greetings. Today we analyze the foundational mechanisms and theoretical frameworks of our subject.",
    tag: 'Authoritative',
  },
  {
    id: 'Serena',
    name: 'Serena',
    gender: 'Female',
    persona: 'Supportive, encouraging, and highly interactive tutor.',
    sampleText: "Hello! You're going to do great today. Let's start with the big picture and build up our intuition.",
    tag: 'Supportive',
  },
];

export interface LiveTutorialVoiceSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectVoiceAndStart: (selectedVoice: string) => void;
  topicTitle?: string;
  courseName?: string;
  durationMinutes?: number;
  initialVoice?: string;
}

export const LiveTutorialVoiceSelectorModal: React.FC<LiveTutorialVoiceSelectorModalProps> = ({
  isOpen,
  onClose,
  onSelectVoiceAndStart,
  topicTitle = 'Live Interactive Tutorial',
  courseName,
  durationMinutes = 15,
  initialVoice = 'Katerina',
}) => {
  const { settings: appSettings } = useAppSettings();
  const { addToast } = useToast();

  const [selectedVoice, setSelectedVoice] = useState<string>(initialVoice);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const activePlayerRef = useRef<UnifiedAudioPlayer | null>(null);

  useEffect(() => {
    return () => {
      if (activePlayerRef.current) {
        try {
          activePlayerRef.current.stop();
        } catch (_) {}
      }
    };
  }, []);

  if (!isOpen) return null;

  const handlePreviewVoice = (voiceOption: VoiceOption, e: React.MouseEvent) => {
    e.stopPropagation();

    // If already playing this voice, stop it
    if (playingVoiceId === voiceOption.id) {
      if (activePlayerRef.current) {
        try {
          activePlayerRef.current.stop();
        } catch (_) {}
        activePlayerRef.current = null;
      }
      setPlayingVoiceId(null);
      return;
    }

    // Stop current audio if playing
    if (activePlayerRef.current) {
      try {
        activePlayerRef.current.stop();
      } catch (_) {}
      activePlayerRef.current = null;
    }

    setPlayingVoiceId(voiceOption.id);

    try {
      const player = unifiedVoiceRouter.playSpeech(voiceOption.sampleText, {
        appSettings,
        provider: 'alibaba',
        voice: voiceOption.id,
        speed: 1.0,
        onEnd: () => {
          setPlayingVoiceId(null);
          activePlayerRef.current = null;
        },
        onError: (err) => {
          console.warn('[VoiceSelector] Preview error:', err);
          setPlayingVoiceId(null);
          activePlayerRef.current = null;
          addToast('Could not play preview. Voice will synthesize in classroom.', 'info');
        },
      });
      activePlayerRef.current = player;
    } catch {
      setPlayingVoiceId(null);
    }
  };

  const handleConfirmStart = () => {
    if (activePlayerRef.current) {
      try {
        activePlayerRef.current.stop();
      } catch (_) {}
    }
    onSelectVoiceAndStart(selectedVoice);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg bg-[#0F0F12] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col text-white"
      >
        {/* Top Header */}
        <div className="flex items-start justify-between p-5 pb-3 border-b border-white/5">
          <div className="flex flex-col">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold tracking-wider uppercase bg-neutral-900 text-neutral-300 border border-neutral-800">
                <span className="w-1.5 h-1.5 rounded-full bg-red-600" /> Teacher Voice Selection
              </span>
              <span className="text-[11px] font-medium text-neutral-400 px-2.5 py-1 rounded-md bg-neutral-900 border border-neutral-800">
                {durationMinutes} Mins Session
              </span>
            </div>
            <h2 className="text-lg font-bold text-white tracking-tight line-clamp-1">
              {topicTitle}
            </h2>
            <p className="text-xs text-white/50 mt-0.5">
              Choose your AI instructor voice to initialize the session
            </p>
          </div>

          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition-all shrink-0 cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Voices List */}
        <div className="p-5 space-y-2.5 max-h-[58vh] overflow-y-auto">
          {TUTORIAL_VOICES.map((voice) => {
            const isSelected = selectedVoice === voice.id;
            const isPlaying = playingVoiceId === voice.id;

            return (
              <div
                key={voice.id}
                onClick={() => setSelectedVoice(voice.id)}
                className={`p-3.5 sm:p-4 rounded-2xl border text-left transition-all duration-150 cursor-pointer flex items-center justify-between ${
                  isSelected
                    ? 'bg-[#18181D] border-red-600'
                    : 'bg-[#141418]/60 border-white/5 hover:bg-[#18181D]/80 hover:border-white/10'
                }`}
              >
                {/* Left Avatar & Info */}
                <div className="flex items-center gap-3.5 min-w-0 flex-1 pr-3">
                  <div
                    className={`flex items-center justify-center w-11 h-11 rounded-xl shrink-0 transition-colors font-bold text-sm ${
                      isSelected
                        ? 'bg-red-600 text-white'
                        : 'bg-neutral-800 text-white/90'
                    }`}
                  >
                    {voice.name[0]}
                  </div>

                  <div className="flex flex-col min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white tracking-tight truncate">
                        {voice.name}
                      </span>
                      <span className="text-[10px] font-medium text-neutral-400 bg-neutral-800 px-2 py-0.5 rounded-md">
                        {voice.gender}
                      </span>
                      {voice.tag && (
                        <span className="text-[10px] font-semibold text-red-500 bg-neutral-900 border border-neutral-800 px-2 py-0.5 rounded-md">
                          {voice.tag}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-neutral-400 line-clamp-1 mt-0.5">
                      {voice.persona}
                    </p>
                  </div>
                </div>

                {/* Right Actions: Play Preview & Checkmark */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={(e) => handlePreviewVoice(voice, e)}
                    type="button"
                    title={isPlaying ? 'Pause sample' : 'Listen to preview'}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                      isPlaying
                        ? 'bg-red-600 text-white'
                        : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white border border-neutral-700'
                    }`}
                  >
                    {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                  </button>

                  <div
                    className={`w-6 h-6 rounded-full border flex items-center justify-center transition-colors ${
                      isSelected
                        ? 'border-red-600 bg-red-600 text-white'
                        : 'border-white/20 bg-transparent'
                    }`}
                  >
                    {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div className="p-5 pt-3 border-t border-white/5 flex items-center justify-between gap-3">
          <button
            onClick={onClose}
            type="button"
            className="px-4 py-3 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-bold text-white/70 hover:text-white transition-colors cursor-pointer"
          >
            Back
          </button>

          <button
            onClick={handleConfirmStart}
            type="button"
            className="flex-1 py-3.5 px-6 rounded-2xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm tracking-wide flex items-center justify-center gap-2 active:scale-[0.98] transition-all cursor-pointer"
          >
            <span>Start Session with {selectedVoice}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default LiveTutorialVoiceSelectorModal;
