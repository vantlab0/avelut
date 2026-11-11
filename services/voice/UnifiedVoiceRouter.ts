import { alibabaVoiceEngine, type AlibabaAudioPlayer, type AlibabaAudioResponsePayload } from './AlibabaVoiceEngine';
import type { AppSettings } from '../../types';

export type UnifiedVoiceProvider = 'alibaba' | 'browser';

export interface UnifiedSpeechOptions {
  provider?: UnifiedVoiceProvider;
  context?: string;
  voice?: string;
  speed?: number;
  pitch?: number;
  language?: string;
  withTimestamps?: boolean;
  cacheKey?: string;
  isPrivate?: boolean;
  appSettings?: AppSettings;
  mode?: number;
  onStart?: () => void;
  onReady?: () => void;
  onTimeUpdate?: (currentTime: number, charIndex: number, spokenWord: string) => void;
  onEnd?: () => void;
  onError?: (err: Error) => void;
}

export type UnifiedAudioPlayer = AlibabaAudioPlayer;

/**
 * Unified Voice Router
 * Alibaba Cloud DashScope (Qwen3-TTS / CosyVoice - Jennifer, etc.) only.
 */
export class UnifiedVoiceRouter {
  public resolveProvider(options: UnifiedSpeechOptions = {}): UnifiedVoiceProvider {
    if (options.provider) {
      return options.provider;
    }
    const voiceLower = (options.voice || '').toLowerCase().trim();
    if (voiceLower === 'jennifer' || voiceLower.includes('alibaba') || voiceLower.includes('qwen')) {
      return 'alibaba';
    }
    if (options.appSettings?.active_voice_provider === 'alibaba') {
      return 'alibaba';
    }
    return 'alibaba';
  }

  /**
   * Play speech using Alibaba Qwen3-TTS engine
   */
  public playSpeech(
    text: string,
    options: UnifiedSpeechOptions = {}
  ): UnifiedAudioPlayer {
    const provider = this.resolveProvider(options);

    if (provider === 'alibaba') {
      const voice = options.voice || options.appSettings?.alibaba_voice_name || 'Cherry';
      return alibabaVoiceEngine.playSpeech(text, {
        appSettings: options.appSettings,
        voice,
        model: 'qwen3-tts-flash',
        language: options.language,
        cacheKey: options.cacheKey,
        isPrivate: options.isPrivate,
        onStart: options.onStart,
        onReady: options.onReady,
        onEnd: options.onEnd,
        onError: (err) => {
          console.warn('[UnifiedVoiceRouter] Alibaba TTS playback error:', err);
          options.onError?.(err);
        },
      });
    }

    // Browser fallback
    return alibabaVoiceEngine.playSpeech(text, {
      appSettings: options.appSettings,
      voice: options.voice || options.appSettings?.alibaba_voice_name || 'Cherry',
      model: 'qwen3-tts-flash',
      language: options.language,
      cacheKey: options.cacheKey,
      isPrivate: options.isPrivate,
      onStart: options.onStart,
      onReady: options.onReady,
      onEnd: options.onEnd,
      onError: (err) => {
        console.warn('[UnifiedVoiceRouter] TTS playback error:', err);
        options.onError?.(err);
      },
    });
  }

  /**
   * Pre-fetches speech payload using Alibaba voice engine
   */
  public prefetchSpeech(
    text: string,
    options: UnifiedSpeechOptions = {}
  ): void {
    const provider = this.resolveProvider(options);
    if (provider === 'alibaba') {
      void alibabaVoiceEngine.fetchAlibabaSpeech(text, {
        appSettings: options.appSettings,
        voice: options.voice || 'Jennifer',
        cacheKey: options.cacheKey,
        isPrivate: options.isPrivate,
      });
    }
  }

  /**
   * Fetches raw audio payload via Alibaba voice engine
   */
  public async fetchSpeech(
    text: string,
    options: UnifiedSpeechOptions = {}
  ): Promise<AlibabaAudioResponsePayload | null> {
    const provider = this.resolveProvider(options);
    if (provider === 'alibaba') {
      return await alibabaVoiceEngine.fetchAlibabaSpeech(text, {
        appSettings: options.appSettings,
        voice: options.voice || 'Jennifer',
        language: options.language,
        cacheKey: options.cacheKey,
        isPrivate: options.isPrivate,
      });
    }

    return await alibabaVoiceEngine.fetchAlibabaSpeech(text, {
      appSettings: options.appSettings,
      voice: options.voice || 'Jennifer',
      language: options.language,
      cacheKey: options.cacheKey,
      isPrivate: options.isPrivate,
    });
  }

  /**
   * Synthesizes/fetches speech payload for caching and offline lesson packages.
   * Alias for fetchSpeech.
   */
  public async synthesizeSpeech(
    text: string,
    options: UnifiedSpeechOptions = {}
  ): Promise<AlibabaAudioResponsePayload | null> {
    return this.fetchSpeech(text, options);
  }

  /**
   * Pre-seed Alibaba engine memory cache from device storage (IndexedDB lesson
   * packages) so playback of a prepared lesson makes zero network calls.
   */
  public primeSpeechCache(cacheKey: string, payload: any, options: UnifiedSpeechOptions = {}): void {
    if (!cacheKey || !payload?.audio) return;
    try {
      alibabaVoiceEngine.primeMemoryCache(`avelut_alibaba_tts_${cacheKey}`, payload);
    } catch (e) {
      console.warn('[UnifiedVoiceRouter] primeSpeechCache error:', e);
    }
  }

  /**
   * Universal audio stop across all engines
   */
  public stopAudio(): void {
    alibabaVoiceEngine.stopAudio();
  }

  public stopAll(): void {
    this.stopAudio();
  }
}

export const unifiedVoiceRouter = new UnifiedVoiceRouter();
export const unifiedTts = unifiedVoiceRouter;
