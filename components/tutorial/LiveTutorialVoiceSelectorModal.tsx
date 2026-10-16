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
    id: 'Cherry',
    name: 'Cherry',
    gender: 'Female',
    persona: 'A bright, clear, and cheerful voice perfect for interactive problem-solving on the whiteboard.',
    sampleText: "Hello! I'm Cherry, your live tutor. Let's break down this topic together step by step on the whiteboard.",
  },
  {
    id: 'Serena',
    name: 'Serena',
    gender: 'Female',
    persona: 'A gentle, warm, and comforting voice that explains complex theories calmly and patiently.',
    sampleText: "Hi there! I'm Serena. Take your time as we explore each concept warmly and thoroughly.",
  },
  {
    id: 'Ethan',
    name: 'Ethan',
    gender: 'Male',
    persona: 'A clear, confident, and professional male voice with great articulation.',
    sampleText: "Hey! I'm Ethan. Let's dig right into the core principles and solve these problems together.",
  },
  {
    id: 'Chelsie',
    name: 'Chelsie',
    gender: 'Female',
    persona: 'A youthful, enthusiastic voice that keeps lessons engaging and upbeat.',
    sampleText: "Welcome! I'm Chelsie. We are going to make this lesson exciting and easy to grasp!",
  },
  {
    id: 'Ryan',
    name: 'Ryan',
    gender: 'Male',
    persona: 'A high-energy, dynamic delivery style with a strong presence for calculations.',
    sampleText: "Awesome to have you here! I'm Ryan, and we're going to power through this lesson with high energy!",
  },
  {
    id: 'Mia',
    name: 'Mia',
    gender: 'Female',
    persona: 'A soothing, focused lifestyle voice ideal for steady, thoughtful study sessions.',
    sampleText: "Hello. I'm Mia. Let's take a calm, structured journey through today's topic together.",
  },
  {
    id: 'Katerina',
    name: 'Katerina',
    gender: 'Female',
    persona: 'A mature, commanding academic voice with distinct rhythm, confidence, and clarity.',
    sampleText: "Greetings. I'm Katerina. Today we break down the core foundations and mechanisms of our lesson step by step.",
    tag: 'Popular',
  },
  {
    id: 'Vivian',
    name: 'Vivian',
    gender: 'Female',
    persona: 'A mature, commanding academic voice with distinct rhythm and clarity.',
    sampleText: "Greetings. I'm Vivian. Today we analyze the foundational mechanisms and theoretical frameworks of our subject.",
  },
];

export const VOICE_SAMPLE_URLS: Record<string, { supabaseUrl: string; localUrl: string }> = {
  Cherry: {
    supabaseUrl: 'https://eywpksapztzbnthlgfhd.supabase.co/storage/v1/object/public/materials/voice_samples/cherry.wav',
    localUrl: '/assets/voices/cherry.wav',
  },
  Serena: {
    supabaseUrl: 'https://eywpksapztzbnthlgfhd.supabase.co/storage/v1/object/public/materials/voice_samples/serena.wav',
    localUrl: '/assets/voices/serena.wav',
  },
  Ethan: {
    supabaseUrl: 'https://eywpksapztzbnthlgfhd.supabase.co/storage/v1/object/public/materials/voice_samples/ethan.wav',
    localUrl: '/assets/voices/ethan.wav',
  },
  Chelsie: {
    supabaseUrl: 'https://eywpksapztzbnthlgfhd.supabase.co/storage/v1/object/public/materials/voice_samples/chelsie.wav',
    localUrl: '/assets/voices/chelsie.wav',
  },
  Ryan: {
    supabaseUrl: 'https://eywpksapztzbnthlgfhd.supabase.co/storage/v1/object/public/materials/voice_samples/ryan.wav',
    localUrl: '/assets/voices/ryan.wav',
  },
  Mia: {
    supabaseUrl: 'https://eywpksapztzbnthlgfhd.supabase.co/storage/v1/object/public/materials/voice_samples/mia.wav',
    localUrl: '/assets/voices/mia.wav',
  },
  Katerina: {
    supabaseUrl: 'https://eywpksapztzbnthlgfhd.supabase.co/storage/v1/object/public/materials/voice_samples/katerina.wav',
    localUrl: '/assets/voices/katerina.wav',
  },
  Vivian: {
    supabaseUrl: 'https://eywpksapztzbnthlgfhd.supabase.co/storage/v1/object/public/materials/voice_samples/vivian.wav',
    localUrl: '/assets/voices/vivian.wav',
  },
};

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
  initialVoice = 'Cherry',
}) => {
  const { settings: appSettings } = useAppSettings();
  const { addToast } = useToast();

  const [selectedVoice, setSelectedVoice] = useState<string>(initialVoice);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const activePlayerRef = useRef<UnifiedAudioPlayer | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const stopAllAudio = () => {
    if (audioElementRef.current) {
      try {
        audioElementRef.current.pause();
        audioElementRef.current.currentTime = 0;
        audioElementRef.current = null;
      } catch (_) {}
    }
    if (activePlayerRef.current) {
      try {
        activePlayerRef.current.stop();
        activePlayerRef.current = null;
      } catch (_) {}
    }
    setPlayingVoiceId(null);
  };

  useEffect(() => {
    return () => {
      stopAllAudio();
    };
  }, []);

  if (!isOpen) return null;

  const handlePreviewVoice = (voiceOption: VoiceOption, e: React.MouseEvent) => {
    e.stopPropagation();

    // If already playing this voice, stop it
    if (playingVoiceId === voiceOption.id) {
      stopAllAudio();
      return;
    }

    // Stop current audio before playing a new one
    stopAllAudio();

    const sample = VOICE_SAMPLE_URLS[voiceOption.id];
    setPlayingVoiceId(voiceOption.id);

    // 1. Try playing pregenerated audio from Supabase CDN with local fallback
    if (sample?.supabaseUrl || sample?.localUrl) {
      const audioUrl = sample.supabaseUrl || sample.localUrl;
      const audio = new Audio(audioUrl);
      audioElementRef.current = audio;

      audio.onended = () => {
        setPlayingVoiceId(null);
        audioElementRef.current = null;
      };

      audio.onerror = () => {
        // Fallback to local URL if Supabase CDN is unreachable
        if (sample.localUrl && audio.src !== window.location.origin + sample.localUrl) {
          const fallbackAudio = new Audio(sample.localUrl);
          audioElementRef.current = fallbackAudio;
          fallbackAudio.onended = () => {
            setPlayingVoiceId(null);
            audioElementRef.current = null;
          };
          fallbackAudio.onerror = () => {
            playDynamicFallback(voiceOption);
          };
          fallbackAudio.play().catch(() => playDynamicFallback(voiceOption));
          return;
        }
        playDynamicFallback(voiceOption);
      };

      audio.play().catch((playErr) => {
        console.warn('[VoiceSelector] Pre-generated audio playback failed, falling back to TTS:', playErr);
        playDynamicFallback(voiceOption);
      });
      return;
    }

    // Dynamic synthesis fallback
    playDynamicFallback(voiceOption);
  };

  const playDynamicFallback = (voiceOption: VoiceOption) => {
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
    stopAllAudio();
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
        <div className="flex items-center justify-between p-5 pb-4 border-b border-white/5">
          <h2 className="text-lg font-bold text-white tracking-tight">
            Select Voice
          </h2>

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
                {/* Left Avatar & Name */}
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

                  <span className="text-sm font-bold text-white tracking-tight truncate">
                    {voice.name}
                  </span>
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
            <span>Start Session</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default LiveTutorialVoiceSelectorModal;
