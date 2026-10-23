import { db, get, off, onValue, push, ref as dbRef, remove, serverTimestamp, set, update } from '@/lib/backend';
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createAvelutAI, getResponseText, getResponseReasoningText, accumulateUsageMetadata, type AiUsageMetadata } from '../utils/inference';
import { isNearBottom, scrollContainerToBottom } from '../utils/scrollUtils';
import { compressBase64Image } from '../utils/mediaUpload';
import type { UserProfile, Message, ChatConversation } from '../types';
import { useToast } from '../hooks/useToast';
import { checkAICredits, deductAICredits, getFeatureCost, getFeatureModel } from '../utils/usage';
import { LimitExceededModal } from './LimitExceededModal';
import { useApiLimiter } from '../hooks/useApiLimiter';
import { useAppSettings } from '../hooks/useAppSettings';
import {
  getLocalConversations,
  getLocalMessages,
  saveLocalMessage,
  saveLocalConversation,
  renameLocalConversation,
  deleteLocalConversation,
  generateLocalId,
  healCorruptedMessagesInSqlite,
  deleteLocalMessage,
  updateLocalMessageText,
} from '../services/chatStorageService';
import { isAiMessage, normalizeConversationMessages } from '../utils/chatMessageNormalizer';
import { getCachedAIResponse, setCachedAIResponse } from '../services/aiCacheService';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Avatar } from './Avatar';
import { ConfirmationModal } from './ConfirmationModal';
import { MarkdownContent } from './MarkdownContent';
import { ThinkingTypingIndicator } from './ThinkingTypingIndicator';
import { ChatLimitBanner } from './ChatLimitBanner';
import { ToolStatus } from './chat/ToolStatus';
import { isRealTimeSearchNeeded, cleanSearchQuery } from '../lib/web-search-detector';
import {
  RefreshCcw,
  ThumbsUp,
  ThumbsDown,
  Share2,
  Camera,
  Image,
  FileText,
  Globe,
  Layers,
  CheckSquare,
  Palette,
  Plus,
  X,
  Mic,
  ArrowUp,
  Square,
  Copy,
  Volume2,
  MoreVertical,
  RotateCw,
  AlertCircle,
  Pencil,
  WifiOff,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { showKeyboard, hideKeyboard, triggerHaptic } from '../utils/capacitorUtils';
import { subscribeTable } from '../lib/sqlite/sqliteService';
import { ExamStreakWidget } from './widgets/ExamStreakWidget';

export type ChatMode = 'context' | 'fast' | 'deep' | 'exam';

export interface ChatModeOption {
  id: ChatMode;
  label: string;
  description: string;
}

export interface AiCapabilities {
  browse: boolean;
  flashcards: boolean;
  quiz: boolean;
  illustrations: boolean;
}

const DEFAULT_CAPABILITIES: AiCapabilities = {
  browse: true,
  flashcards: false,
  quiz: false,
  illustrations: false,
};

export const getStoredCapabilities = (): AiCapabilities => {
  if (typeof window === 'undefined') return DEFAULT_CAPABILITIES;
  try {
    const raw = localStorage.getItem('avelut_ai_capabilities');
    if (!raw) return DEFAULT_CAPABILITIES;
    return { ...DEFAULT_CAPABILITIES, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CAPABILITIES;
  }
};

export const saveStoredCapabilities = (caps: AiCapabilities) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('avelut_ai_capabilities', JSON.stringify(caps));
  } catch {}
};

const CHAT_MODES: ChatModeOption[] = [
  { id: 'context', label: 'Context Aware', description: 'Uses courses & progress context' },
  { id: 'fast', label: 'Fast', description: 'Short & concise answers' },
  { id: 'deep', label: 'Deep', description: 'Step-by-step detailed explanations' },
  { id: 'exam', label: 'Exam Mode', description: 'Practice exam question style' },
];

export const CollapsibleUserMessage: React.FC<{ text?: string }> = ({ text = '' }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (el) {
      const overflow = el.scrollHeight > 135;
      setIsOverflowing(overflow);
    }
  }, [text]);

  return (
    <div className="relative inline-block text-left max-w-full">
      <div
        ref={contentRef}
        className={`px-5 py-3 rounded-[22px] text-[15px] sm:text-[16px] leading-relaxed bg-[#f0f0f0] dark:bg-[#2f2f2f] text-neutral-900 dark:text-white break-words transition-all duration-300 ${
          !isExpanded && isOverflowing ? 'max-h-[135px] overflow-hidden relative' : ''
        }`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
          {text}
        </ReactMarkdown>

        {!isExpanded && isOverflowing && (
          <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#f0f0f0] dark:from-[#2f2f2f] via-[#f0f0f0]/80 dark:via-[#2f2f2f]/80 to-transparent pointer-events-none rounded-b-[22px]" />
        )}
      </div>

      {isOverflowing && (
        <div className="flex justify-end mt-1.5">
          {isExpanded ? (
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="text-[12px] font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-white flex items-center gap-1 transition-colors px-2 py-0.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <span>Show less</span>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="w-7 h-7 rounded-full bg-neutral-200 dark:bg-neutral-700 hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-700 dark:text-neutral-200 flex items-center justify-center transition-all shadow-sm active:scale-95"
              title="Expand message"
              aria-label="Expand message"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const timeAgo = (timestamp: number): string => {
  const now = Date.now();
  const seconds = Math.floor((now - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const parseFollowUpsAndContent = (text: string) => {
  if (!text) return { cleanedText: '', followUps: [] as string[] };
  const lines = text.split('\n');
  const followUps: string[] = [];
  const contentLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('↳')) {
      const prompt = trimmed.replace(/^↳\s*/, '').trim();
      if (prompt) followUps.push(prompt);
    } else {
      contentLines.push(lines[i]);
    }
  }

  return {
    cleanedText: contentLines.join('\n').trim(),
    followUps,
  };
};

// --- CAMERA CAPTURE VIEW ---
export const CameraCaptureView: React.FC<{
  onClose: () => void;
  onConfirm: (base64Image: string) => void;
}> = ({ onClose, onConfirm }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error('Camera access error:', err);
        alert('Could not access the camera. Please check permissions.');
        onClose();
      }
    };
    startCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [onClose]);

  const handleSnap = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setCapturedImage(dataUrl);
      }
    }
  };

  const handleRetake = () => {
    setCapturedImage(null);
  };

  return (
    <div className="fixed inset-0 z-[1000] bg-black flex flex-col justify-between">
      {/* Viewport */}
      <div className="relative flex-1 flex items-center justify-center overflow-hidden">
        {!capturedImage ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        ) : (
          <img src={capturedImage} alt="Captured" className="w-full h-full object-contain" />
        )}
        <canvas ref={canvasRef} className="hidden" />

        {/* Top close button (always visible) */}
        <button
          onClick={onClose}
          className="absolute top-6 left-4 w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center backdrop-blur-sm z-10"
        >
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Bottom Controls */}
      <div className="h-32 bg-black flex items-center justify-center px-6 shrink-0 relative pb-safe">
        {!capturedImage ? (
          <button
            onClick={handleSnap}
            className="w-16 h-16 rounded-full border-[4px] border-white/50 flex items-center justify-center active:scale-95 transition-transform"
          >
            <div className="w-12 h-12 bg-white rounded-full" />
          </button>
        ) : (
          <div className="flex items-center gap-12 w-full justify-center">
            <button
              onClick={handleRetake}
              className="w-14 h-14 rounded-full bg-red-500/20 text-red-500 flex items-center justify-center active:scale-95 transition-transform"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <button
              className="w-16 h-16 rounded-full border-[4px] border-white/20 flex items-center justify-center pointer-events-none opacity-50"
            >
              <div className="w-12 h-12 bg-white/20 rounded-full" />
            </button>
            <button
              onClick={() => onConfirm(capturedImage)}
              className="w-14 h-14 rounded-full bg-green-500/20 text-green-500 flex items-center justify-center active:scale-95 transition-transform"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// --- REDESIGNED INPUT COMPOSER ---
const MAX_CHAT_IMAGES = 6;
const MAX_SAFE_PAYLOAD_BYTES = 10 * 1024 * 1024; // 10MB safe cap

export const ImageGridRenderer: React.FC<{ images: string[] }> = ({ images }) => {
  if (!images || images.length === 0) return null;

  if (images.length === 1) {
    return (
      <div className="mb-2 overflow-hidden rounded-[20px] border border-neutral-200/80 dark:border-white/10 shadow-sm max-w-sm">
        <img
          src={images[0]}
          alt="Uploaded attachment"
          className="w-full max-h-72 object-contain bg-neutral-100 dark:bg-neutral-900 rounded-[20px]"
        />
      </div>
    );
  }

  const gridCols = images.length === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3';

  return (
    <div className={`grid ${gridCols} gap-2 mb-2 max-w-md w-full`}>
      {images.map((src, idx) => (
        <div key={idx} className="relative aspect-square overflow-hidden rounded-[16px] border border-neutral-200/80 dark:border-white/10 bg-neutral-100 dark:bg-neutral-900">
          <img src={src} alt={`Attachment ${idx + 1}`} className="w-full h-full object-cover" />
        </div>
      ))}
    </div>
  );
};

export const GrokChatComposer: React.FC<{
  input: string;
  setInput: (val: string) => void;
  isLoading: boolean;
  selectedMode: ChatMode;
  onSelectMode: (mode: ChatMode) => void;
  voiceStatus: 'idle' | 'listening' | 'processing';
  onToggleVoice: () => void;
  attachedImages: string[];
  onRemoveImage: (index: number) => void;
  onAttachImage?: (base64Img: string) => void;
  onOpenGallery: () => void;
  onOpenCamera: () => void;
  onOpenFile: () => void;
  capabilities: AiCapabilities;
  onToggleCapability: (key: keyof AiCapabilities) => void;
  onSend: () => void;
  onStop?: () => void;
  autoFocus?: boolean;
}> = ({
  input,
  setInput,
  isLoading,
  voiceStatus,
  onToggleVoice,
  attachedImages,
  onRemoveImage,
  onAttachImage,
  onOpenGallery,
  onOpenCamera,
  onOpenFile,
  capabilities,
  onToggleCapability,
  onSend,
  onStop,
  autoFocus,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  // Close attach menu when clicking outside or pressing Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowAttachMenu(false);
      }
    };
    if (showAttachMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showAttachMenu]);

  // Helper to activate focus and trigger keyboard when explicitly requested
  const activateKeyboard = useCallback(() => {
    if (!textareaRef.current) return;
    try {
      textareaRef.current.focus({ preventScroll: true });
      const len = textareaRef.current.value.length;
      try {
        textareaRef.current.setSelectionRange(len, len);
      } catch {}
    } catch {}
    window.scrollTo(0, 0);
    if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
    if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
    void showKeyboard();
  }, []);

  const dismissKeyboard = useCallback(() => {
    try {
      if (textareaRef.current) {
        textareaRef.current.blur();
      }
      if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      void hideKeyboard();
    } catch {}
  }, []);

  // Auto-focus textarea on mount so users can immediately start typing
  useEffect(() => {
    if (autoFocus) {
      const timer = setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus({ preventScroll: true });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [autoFocus]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 140)}px`;
    }
  }, [input]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          const reader = new FileReader();
          reader.onload = (ev) => {
            const result = ev.target?.result as string;
            if (result && onAttachImage) {
              onAttachImage(result);
            }
          };
          reader.readAsDataURL(file);
          return;
        }
      }
    }
  }, [onAttachImage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      dismissKeyboard();
      onSend();
    }
  };

  const handleAttachClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowAttachMenu((prev) => !prev);
  };

  const hasText = Boolean(input.trim()) || attachedImages.length > 0;

  return (
    <div
      className="w-full max-w-3xl mx-auto px-3 sm:px-4 pt-2 relative z-20 bg-white/95 dark:bg-black/95 backdrop-blur-md shrink-0"
      style={{
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom), var(--keyboard-height, 0px))',
        transition: 'padding-bottom 0.15s ease',
      }}
      onPaste={handlePaste}
    >
      <div className="relative flex flex-col bg-white dark:bg-[#212124] rounded-[28px] border border-[#E5E5E5] dark:border-white/10 transition-all focus-within:ring-1 focus-within:ring-black/10 dark:focus-within:ring-white/10 shadow-xs">
        
        {/* Attached Images Preview Row */}
        {attachedImages.length > 0 && (
          <div className="px-4 pt-4 pb-0 flex flex-wrap gap-2.5">
            {attachedImages.map((src, index) => (
              <div key={index} className="relative group shrink-0">
                <img
                  src={src}
                  alt={`Attached ${index + 1}`}
                  className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-[14px] border border-black/10 dark:border-white/10 shadow-xs"
                />
                <button
                  type="button"
                  onClick={() => onRemoveImage(index)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-neutral-900 text-white flex items-center justify-center shadow-sm hover:bg-neutral-800 transition-colors cursor-pointer"
                  aria-label="Remove image"
                >
                  <X className="w-3 h-3" strokeWidth={2.2} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Top: Text input / textarea */}
        <div className={`px-4 ${attachedImages.length > 0 ? 'pt-2' : 'pt-3.5'} pb-1`}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => {
              window.scrollTo(0, 0);
              if (document.documentElement.scrollTop !== 0) document.documentElement.scrollTop = 0;
              if (document.body.scrollTop !== 0) document.body.scrollTop = 0;
            }}
            placeholder="Ask anything or paste images..."
            rows={1}
            className="w-full bg-transparent border-0 outline-none focus:outline-none focus:ring-0 text-[#171717] dark:text-white placeholder-[#8E8E93] dark:placeholder-neutral-500 text-[15px] sm:text-base resize-none max-h-36 py-0 leading-relaxed [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          />
        </div>

        {/* Bottom Row */}
        <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
          {/* Left Actions: + (plus) button */}
          <div className="flex items-center gap-2">
            <div className="relative" ref={attachMenuRef}>
              <button
                type="button"
                onClick={handleAttachClick}
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  showAttachMenu
                    ? 'bg-neutral-200 dark:bg-neutral-800 text-[#171717] dark:text-white'
                    : 'text-neutral-500 hover:text-[#171717] dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800/60'
                }`}
                title="Attach file"
                aria-label="Attach file"
              >
                <Plus
                  className={`w-5 h-5 transition-transform duration-200 ${showAttachMenu ? 'rotate-45' : ''}`}
                  strokeWidth={2}
                />
              </button>

              {/* Redesigned Attachment/Tools Popup */}
              {showAttachMenu && (
                <div 
                  className="absolute bottom-full left-0 mb-2.5 w-60 sm:w-64 max-w-[calc(100vw-2rem)] bg-white dark:bg-[#18181b] rounded-[20px] shadow-xl shadow-black/8 dark:shadow-black/40 border border-neutral-200/80 dark:border-white/10 p-1.5 z-50 animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-150 ease-out select-none"
                  style={{ transformOrigin: 'bottom left' }}
                >
                  {/* TOP SECTION: File Attachment Actions */}
                  <div className="space-y-0.5">
                    {/* 1. Camera */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachMenu(false);
                        onOpenCamera();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 min-h-[44px] rounded-xl text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition-colors cursor-pointer text-left group"
                    >
                      <Camera className="w-[18px] h-[18px] text-neutral-600 dark:text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors shrink-0" strokeWidth={1.9} />
                      <span className="text-[14px] font-medium text-neutral-900 dark:text-neutral-100">Camera</span>
                    </button>

                    {/* 2. Gallery */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachMenu(false);
                        onOpenGallery();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 min-h-[44px] rounded-xl text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition-colors cursor-pointer text-left group"
                    >
                      <Image className="w-[18px] h-[18px] text-neutral-600 dark:text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors shrink-0" strokeWidth={1.9} />
                      <span className="text-[14px] font-medium text-neutral-900 dark:text-neutral-100">Gallery</span>
                    </button>

                    {/* 3. Files */}
                    <button
                      type="button"
                      onClick={() => {
                        setShowAttachMenu(false);
                        onOpenFile();
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2 min-h-[44px] rounded-xl text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800/60 transition-colors cursor-pointer text-left group"
                    >
                      <FileText className="w-[18px] h-[18px] text-neutral-600 dark:text-neutral-400 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors shrink-0" strokeWidth={1.9} />
                      <span className="text-[14px] font-medium text-neutral-900 dark:text-neutral-100">Files</span>
                    </button>
                  </div>

                  {/* Subtle Separator */}
                  <div className="h-px bg-neutral-100 dark:bg-white/[0.08] my-1 mx-1" />

                  {/* BOTTOM SECTION: AI Capability Toggles */}
                  <div className="space-y-0.5">
                    {/* 4. Browse */}
                    <div className="flex items-center justify-between px-3 py-1.5 min-h-[44px] rounded-xl hover:bg-neutral-50 dark:hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <Globe className="w-[18px] h-[18px] text-neutral-600 dark:text-neutral-400 shrink-0" strokeWidth={1.9} />
                        <span className="text-[14px] font-medium text-neutral-900 dark:text-neutral-100">Browse</span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={capabilities.browse}
                        aria-label={`Browse ${capabilities.browse ? 'enabled' : 'disabled'}`}
                        onClick={() => onToggleCapability('browse')}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          capabilities.browse ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-200 dark:bg-neutral-700'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full shadow-sm transition duration-200 ease-in-out ${
                            capabilities.browse ? 'translate-x-4 bg-white dark:bg-neutral-900' : 'translate-x-0.5 bg-white'
                          }`}
                        />
                      </button>
                    </div>

                    {/* 5. Flashcards */}
                    <div className="flex items-center justify-between px-3 py-1.5 min-h-[44px] rounded-xl hover:bg-neutral-50 dark:hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <Layers className="w-[18px] h-[18px] text-neutral-600 dark:text-neutral-400 shrink-0" strokeWidth={1.9} />
                        <span className="text-[14px] font-medium text-neutral-900 dark:text-neutral-100">Flashcards</span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={capabilities.flashcards}
                        aria-label={`Flashcards ${capabilities.flashcards ? 'enabled' : 'disabled'}`}
                        onClick={() => onToggleCapability('flashcards')}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          capabilities.flashcards ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-200 dark:bg-neutral-700'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full shadow-sm transition duration-200 ease-in-out ${
                            capabilities.flashcards ? 'translate-x-4 bg-white dark:bg-neutral-900' : 'translate-x-0.5 bg-white'
                          }`}
                        />
                      </button>
                    </div>

                    {/* 6. Quiz */}
                    <div className="flex items-center justify-between px-3 py-1.5 min-h-[44px] rounded-xl hover:bg-neutral-50 dark:hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <CheckSquare className="w-[18px] h-[18px] text-neutral-600 dark:text-neutral-400 shrink-0" strokeWidth={1.9} />
                        <span className="text-[14px] font-medium text-neutral-900 dark:text-neutral-100">Quiz</span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={capabilities.quiz}
                        aria-label={`Quiz ${capabilities.quiz ? 'enabled' : 'disabled'}`}
                        onClick={() => onToggleCapability('quiz')}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          capabilities.quiz ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-200 dark:bg-neutral-700'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full shadow-sm transition duration-200 ease-in-out ${
                            capabilities.quiz ? 'translate-x-4 bg-white dark:bg-neutral-900' : 'translate-x-0.5 bg-white'
                          }`}
                        />
                      </button>
                    </div>

                    {/* 7. Illustrations */}
                    <div className="flex items-center justify-between px-3 py-1.5 min-h-[44px] rounded-xl hover:bg-neutral-50 dark:hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-center gap-3 min-w-0">
                        <Palette className="w-[18px] h-[18px] text-neutral-600 dark:text-neutral-400 shrink-0" strokeWidth={1.9} />
                        <span className="text-[14px] font-medium text-neutral-900 dark:text-neutral-100">Illustrations</span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={capabilities.illustrations}
                        aria-label={`Illustrations ${capabilities.illustrations ? 'enabled' : 'disabled'}`}
                        onClick={() => onToggleCapability('illustrations')}
                        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          capabilities.illustrations ? 'bg-neutral-900 dark:bg-white' : 'bg-neutral-200 dark:bg-neutral-700'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full shadow-sm transition duration-200 ease-in-out ${
                            capabilities.illustrations ? 'translate-x-4 bg-white dark:bg-neutral-900' : 'translate-x-0.5 bg-white'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Integrated Voice / Send / Stop Action Button */}
          <div className="flex items-center ml-auto">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (isLoading) {
                  onStop?.();
                  return;
                }
                if (voiceStatus === 'listening') {
                  onToggleVoice();
                } else if (hasText) {
                  dismissKeyboard();
                  onSend();
                } else {
                  onToggleVoice();
                }
              }}
              className={`h-9 sm:h-10 px-3.5 sm:px-4 rounded-full flex items-center justify-center gap-1.5 shrink-0 transition-all duration-150 active:scale-95 text-xs sm:text-sm font-medium select-none cursor-pointer ${
                isLoading
                  ? 'bg-[#171717] hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black shadow-xs'
                  : voiceStatus === 'listening'
                  ? 'bg-rose-500 hover:bg-rose-600 text-white animate-pulse shadow-xs shadow-rose-500/25'
                  : hasText
                  ? 'bg-[#171717] hover:bg-neutral-800 text-white dark:bg-white dark:hover:bg-neutral-100 dark:text-black shadow-xs'
                  : 'bg-[#F2F2F2] hover:bg-[#E8E8E8] text-[#171717] border border-[#E5E5E5] dark:bg-neutral-800/80 dark:hover:bg-neutral-800 dark:text-neutral-200 dark:border-white/5'
              }`}
              title={isLoading ? 'Stop generating' : voiceStatus === 'listening' ? 'Stop listening' : hasText ? 'Send message' : 'Speak to dictate'}
              aria-label={isLoading ? 'Stop generating' : voiceStatus === 'listening' ? 'Stop listening' : hasText ? 'Send message' : 'Speak to dictate'}
            >
              {isLoading ? (
                <>
                  <Square className="w-3 h-3 fill-current" />
                  <span>Stop</span>
                </>
              ) : voiceStatus === 'listening' ? (
                <>
                  <span className="flex items-center gap-0.5 h-3.5">
                    <span className="w-0.5 h-2.5 bg-white rounded-full animate-pulse" />
                    <span className="w-0.5 h-4 bg-white rounded-full animate-pulse [animation-delay:150ms]" />
                    <span className="w-0.5 h-2 bg-white rounded-full animate-pulse [animation-delay:300ms]" />
                  </span>
                  <span>Listening...</span>
                </>
              ) : hasText ? (
                <>
                  <span>Send</span>
                  <ArrowUp className="w-3.5 h-3.5" strokeWidth={2.2} />
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4 text-[#171717] dark:text-neutral-300" strokeWidth={1.9} />
                  <span>Voice</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- CHAT INTERFACE ---
interface ChatProps {
  userProfile: UserProfile;
  onNavigate?: (tab: string) => void;
  onOpenMenu?: () => void;
  setCustomHeaderConfig?: (config: any) => void;
  activeConversationId?: string | null;
  onSelectConversation?: (id: string | null) => void;
}

// Memory cache for instantaneous 0ms frame-0 chat rendering (native instant feel)
const chatMessagesMemoryCache = new Map<string, Message[]>();
let chatConversationsMemoryCache: ChatConversation[] = [];

export const Chat: React.FC<ChatProps> = ({ 
  userProfile, 
  onNavigate, 
  onOpenMenu, 
  setCustomHeaderConfig,
  activeConversationId: propActiveConversationId,
  onSelectConversation,
}) => {
  const [conversations, setConversations] = useState<ChatConversation[]>(() => chatConversationsMemoryCache);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(propActiveConversationId ?? null);
  const [messages, setMessages] = useState<Message[]>(() => {
    if (propActiveConversationId && chatMessagesMemoryCache.has(propActiveConversationId)) {
      return normalizeConversationMessages(chatMessagesMemoryCache.get(propActiveConversationId)!);
    }
    return [];
  });

  useEffect(() => {
    void healCorruptedMessagesInSqlite();
  }, []);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMode, setSelectedMode] = useState<ChatMode>('context');
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'listening' | 'processing'>('idle');
  const [courseContext, setCourseContext] = useState<string>('');
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [showLimitBanner, setShowLimitBanner] = useState(false);
  const [modalState, setModalState] = useState<{ isOpen: boolean; title: string; message: string; onConfirm: () => void; confirmText?: string }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [isSwitchingChat, setIsSwitchingChat] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [moreMenuMsgId, setMoreMenuMsgId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState<string>('');
  const [activeUserBubbleMenuId, setActiveUserBubbleMenuId] = useState<string | null>(null);
  const [aiCapabilities, setAiCapabilities] = useState<AiCapabilities>(() => getStoredCapabilities());

  const handleToggleCapability = useCallback((key: keyof AiCapabilities) => {
    setAiCapabilities((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveStoredCapabilities(next);
      return next;
    });
  }, []);

  const switchingConvoIdRef = useRef<string | null>(null);
  const newlyCreatedConvoIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docFileInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    stickToBottomRef.current = isNearBottom(el);
  }, []);

  // Keep the view pinned when media finishes loading and grows the bubble.
  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const handleMediaLoad = () => {
      if (stickToBottomRef.current) scrollContainerToBottom(el, 'auto');
    };
    el.addEventListener('load', handleMediaLoad, true);
    return () => el.removeEventListener('load', handleMediaLoad, true);
  }, []);
  const activeRequestIdRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { addToast } = useToast();
  const { attemptApiCall } = useApiLimiter();
  const { settings: appSettings } = useAppSettings();

  const handleStopGenerating = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const lastMsg = prev[prev.length - 1];
      if (lastMsg && (lastMsg.sender === 'bot' || isAiMessage(lastMsg))) {
        const hasText = !!lastMsg.text?.trim();
        const finalText = hasText ? lastMsg.text : 'Response aborted by user.';
        return prev.map((m, idx) =>
          idx === prev.length - 1 ? { ...m, status: 'interrupted' as const, text: finalText } : m
        );
      }
      return prev;
    });
    setIsLoading(false);
  }, []);

  const aiModel = getFeatureModel('chat_interaction', appSettings);
  const ai = useMemo(() => createAvelutAI(appSettings, userProfile), [appSettings, userProfile]);

  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;

  useEffect(() => {
    if (propActiveConversationId !== undefined) {
      if (propActiveConversationId === null && isLoadingRef.current) {
        return;
      }
      setActiveConversationId(propActiveConversationId);
    }
  }, [propActiveConversationId]);

  const addOptimizedImage = useCallback(async (base64Img: string) => {
    try {
      const optimized = await compressBase64Image(base64Img, 1600, 0.82);
      setAttachedImages((prev) => {
        if (prev.length >= MAX_CHAT_IMAGES) {
          addToast(`Maximum ${MAX_CHAT_IMAGES} images allowed per message.`, 'warning');
          return prev;
        }
        return [...prev, optimized];
      });
    } catch {
      setAttachedImages((prev) => prev.length < MAX_CHAT_IMAGES ? [...prev, base64Img] : prev);
    }
  }, [addToast]);

  useEffect(() => {
    const pendingImg = localStorage.getItem('shared_chat_pending_image');
    if (pendingImg) {
      void addOptimizedImage(pendingImg);
      localStorage.removeItem('shared_chat_pending_image');
    }

    const handleAttach = (e: any) => {
      if (e.detail?.image) {
        void addOptimizedImage(e.detail.image);
        localStorage.removeItem('shared_chat_pending_image');
      }
    };
    window.addEventListener('avelut_attach_chat_image', handleAttach);
    return () => {
      window.removeEventListener('avelut_attach_chat_image', handleAttach);
    };
  }, [addOptimizedImage]);

  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
    setMessages([]);
    onSelectConversation?.(null);
  }, [onSelectConversation]);

  const handleClearCurrentChat = useCallback(() => {
    if (messages.length === 0) return;
    setModalState({
      isOpen: true,
      title: 'Clear Messages',
      message: 'Are you sure you want to clear all messages in this conversation? This cannot be undone.',
      confirmText: 'Clear',
      onConfirm: async () => {
        setMessages([]);
        setModalState((s) => ({ ...s, isOpen: false }));
        addToast('Messages cleared', 'info');
      },
    });
  }, [messages.length, addToast]);

  const handleDeleteCurrentChat = useCallback(() => {
    if (!activeConversationId) return;
    setModalState({
      isOpen: true,
      title: 'Delete Conversation',
      message: 'Are you sure you want to delete this conversation? All chat history for this topic will be permanently removed.',
      confirmText: 'Delete',
      onConfirm: async () => {
        setIsDeleting(true);
        try {
          await deleteLocalConversation(activeConversationId);
          setActiveConversationId(null);
          setMessages([]);
          onSelectConversation?.(null);
          addToast('Conversation deleted', 'info');
        } catch (e) {
          console.error('Error deleting conversation:', e);
          addToast('Failed to delete conversation', 'error');
        } finally {
          setIsDeleting(false);
          setModalState((s) => ({ ...s, isOpen: false }));
        }
      },
    });
  }, [activeConversationId, onSelectConversation, addToast]);

  useEffect(() => {
    if (!setCustomHeaderConfig) return;
    setCustomHeaderConfig({
      hideTitle: true,
      title: null,
      hideDefaultRightActions: false,
      hideProfileAvatar: true,
      onNewChat: handleNewChat,
      onClearChat: handleClearCurrentChat,
      onDeleteChat: handleDeleteCurrentChat,
      hasActiveChat: Boolean(activeConversationId),
      hasMessages: messages.length > 0,
    });
    return () => {
      setCustomHeaderConfig(null);
    };
  }, [
    setCustomHeaderConfig,
    handleNewChat,
    handleDeleteCurrentChat,
    handleClearCurrentChat,
    activeConversationId,
    messages.length,
  ]);

  useEffect(() => {
    let isMounted = true;
    getLocalConversations(userProfile.uid).then((localConvos) => {
      if (isMounted) {
        setConversations(
          (localConvos || []).map((c) => ({
            id: c.id,
            user_id: c.user_id || userProfile.uid,
            title: c.title || 'New Chat',
            created_at: c.created_at || 0,
            last_updated_at: c.last_updated_at || c.created_at || 0,
          }))
        );
      }
    }).catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [userProfile.uid]);

  useEffect(() => {
    let contextText = `STUDENT LEVEL: ${userProfile.level || ''}\nDEPARTMENT: ${userProfile.department_id || ''}\n\n`;
    try {
      const cachedProgress = typeof window !== 'undefined' ? JSON.parse(window.localStorage.getItem(`avelut_progress_${userProfile.uid}`) || '{}') : null;
      if (cachedProgress && Object.keys(cachedProgress).length > 0) {
        contextText += 'STUDENT PROGRESS DATA:\n';
        Object.keys(cachedProgress).forEach((courseId) => {
          const courses = cachedProgress[courseId];
          if (courses && typeof courses === 'object') {
            contextText += `- ${courseId}: ${Object.keys(courses).filter((k) => courses[k]?.status === 'completed').join(', ')}\n`;
          }
        });
        setCourseContext(contextText);
      }
    } catch {}

    const fetchCourseContext = async () => {
      try {
        const progressRef = dbRef(db, `user_progress/${userProfile.uid}`);
        const progressSnap = await get(progressRef);
        if (progressSnap.exists()) {
          let updatedText = `STUDENT LEVEL: ${userProfile.level || ''}\nDEPARTMENT: ${userProfile.department_id || ''}\n\nSTUDENT PROGRESS DATA:\n`;
          const progressData = progressSnap.val();
          Object.keys(progressData).forEach((courseId) => {
            const courses = progressData[courseId];
            if (courses && typeof courses === 'object') {
              updatedText += `- ${courseId}: ${Object.keys(courses).filter((k) => courses[k]?.status === 'completed').join(', ')}\n`;
            }
          });
          setCourseContext(updatedText);
        }
      } catch (err) {
        console.error('Error fetching course context:', err);
      }
    };
    fetchCourseContext();
  }, [userProfile.uid, userProfile.department_id, userProfile.level]);

  useEffect(() => {
    if (!activeConversationId) {
      if (!isLoadingRef.current) {
        setMessages([]);
      }
      setIsSwitchingChat(false);
      switchingConvoIdRef.current = null;
      return;
    }

    // ⚡ FIRST MESSAGE FIX: If this conversation was just created in handleSendMessage,
    // do NOT treat it as switching conversations! Keep the optimistic messages in memory,
    // do NOT show skeleton loader, and do NOT wipe in-flight streaming messages!
    if (newlyCreatedConvoIdRef.current === activeConversationId) {
      newlyCreatedConvoIdRef.current = null;
      switchingConvoIdRef.current = activeConversationId;
      setIsSwitchingChat(false);

      const messagesRef = dbRef(db, `chat_messages/${activeConversationId}`);
      const unsubscribe = onValue(messagesRef, (snapshot) => {
        if (snapshot.exists()) {
          const data: any[] = [];
          snapshot.forEach((child) => {
            let attachments: any[] | undefined = undefined;
            const val = child.val();
            if (val.attachments_json) {
              try { attachments = JSON.parse(val.attachments_json); } catch {}
            }
            data.push({ id: child.key, ...val, attachments });
          });
          const normalized = normalizeConversationMessages(data);
          setMessages((current) => {
            const dbTexts = new Set(normalized.map((m: any) => `${m.sender === 'user' ? 'user' : 'bot'}:${m.text}`));
            const dbIds = new Set(normalized.map((m: any) => m.id));
            const inFlight = current.filter(
              (m) => !dbIds.has(m.id) && !dbTexts.has(`${m.sender}:${m.text}`)
            );
            const inFlightUsers = inFlight.filter((m) => m.sender === 'user');
            const inFlightBots = inFlight.filter((m) => m.sender !== 'user');
            const merged = [...normalized, ...inFlightUsers].sort((a, b) => a.timestamp - b.timestamp);
            return [...merged, ...inFlightBots] as Message[];
          });
        }
      });

      return () => {
        off(messagesRef);
      };
    }

    let isMounted = true;
    switchingConvoIdRef.current = activeConversationId;

    // Instant native render from memory cache if available (0ms - zero skeleton flicker)
    if (chatMessagesMemoryCache.has(activeConversationId)) {
      const cached = normalizeConversationMessages(chatMessagesMemoryCache.get(activeConversationId)!);
      chatMessagesMemoryCache.set(activeConversationId, cached);
      setMessages(cached);
      setIsSwitchingChat(false);
    } else if (!isLoadingRef.current) {
      setIsSwitchingChat(true);
    }

    const loadLocal = () => {
      getLocalMessages(activeConversationId).then((localMsgs) => {
        if (isMounted && switchingConvoIdRef.current === activeConversationId) {
          const sorted = normalizeConversationMessages(localMsgs);
          chatMessagesMemoryCache.set(activeConversationId, sorted);
          setMessages((current) => {
            if (isLoadingRef.current) {
              const dbIds = new Set(sorted.map((m) => m.id));
              const inFlight = current.filter((m) => !dbIds.has(m.id));
              const inFlightUsers = inFlight.filter((m) => m.sender === 'user');
              const inFlightBots = inFlight.filter((m) => m.sender !== 'user');
              const merged = [...sorted, ...inFlightUsers].sort((a, b) => a.timestamp - b.timestamp);
              return [...merged, ...inFlightBots] as Message[];
            }
            return sorted;
          });
          setIsSwitchingChat(false);
        }
      }).catch(() => {
        if (isMounted && switchingConvoIdRef.current === activeConversationId) {
          setIsSwitchingChat(false);
        }
      });
    };

    loadLocal();

    // Reactive SQLite table change subscription for live updates
    const unsubSqlite = subscribeTable('messages', () => {
      if (isMounted && switchingConvoIdRef.current === activeConversationId) {
        loadLocal();
      }
    });

    return () => {
      isMounted = false;
      unsubSqlite();
    };
  }, [activeConversationId]);

  // Only scroll down when a conversation loads or a new message arrives while
  // the user is already near the bottom. DO NOT auto-scroll on every streaming
  // chunk, and never drag a user away from older messages they are reading.
  const prevMsgCountRef = useRef(messages.length);
  const activeConvoRef = useRef(activeConversationId);
  useEffect(() => {
    const isConvoSwitched = activeConvoRef.current !== activeConversationId;
    activeConvoRef.current = activeConversationId;

    if (isConvoSwitched) {
      stickToBottomRef.current = true;
    }

    const hasNewMessage = messages.length > prevMsgCountRef.current;
    if (isConvoSwitched || (hasNewMessage && stickToBottomRef.current)) {
      const behavior: ScrollBehavior = isConvoSwitched ? 'auto' : 'smooth';
      requestAnimationFrame(() => scrollContainerToBottom(messagesScrollRef.current, behavior));
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length, activeConversationId]);

  // Streaming updates change the text length without changing the message
  // count. Keep following the answer only while the user is still at the
  // bottom; scrolling up to read history disables this via
  // `handleMessagesScroll`.
  const lastMessageContentLength = (() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return 0;
    const partsLen = lastMessage.parts ? JSON.stringify(lastMessage.parts).length : 0;
    return (lastMessage.text?.length ?? 0) + (lastMessage.reasoningText?.length ?? 0) + partsLen;
  })();
  useEffect(() => {
    if (!stickToBottomRef.current) return;
    const frame = requestAnimationFrame(() => {
      if (stickToBottomRef.current) {
        scrollContainerToBottom(messagesScrollRef.current, 'auto');
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [lastMessageContentLength]);

  const recognitionRef = useRef<any>(null);

  const stopVoiceRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setVoiceStatus('idle');
  }, []);

  const startVoiceRecognition = useCallback(() => {
    const SpeechRecognitionClass =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      addToast('Voice recognition is not supported on this browser.', 'warning');
      return;
    }

    try {
      stopVoiceRecognition();

      const rec = new SpeechRecognitionClass();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'en-US';

      const initialText = input.trim();
      let accumulatedFinal = '';

      rec.onstart = () => {
        setVoiceStatus('listening');
      };

      rec.onresult = (event: any) => {
        let interimText = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const piece = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) {
            accumulatedFinal = `${accumulatedFinal} ${piece}`.trim();
          } else {
            interimText = `${interimText} ${piece}`.trim();
          }
        }
        const spoken = `${accumulatedFinal} ${interimText}`.trim();
        if (spoken) {
          const newContent = initialText ? `${initialText} ${spoken}` : spoken;
          setInput(newContent);
        }
      };

      rec.onerror = (event: any) => {
        if (event.error !== 'no-speech') {
          addToast(event.error === 'not-allowed' ? 'Microphone permission denied.' : 'Voice recognition ended.', 'info');
        }
        setVoiceStatus('idle');
      };

      rec.onend = () => {
        setVoiceStatus('idle');
      };

      recognitionRef.current = rec;
      rec.start();
    } catch (e: any) {
      console.warn('SpeechRecognition start failed:', e);
      addToast('Could not start microphone.', 'error');
      setVoiceStatus('idle');
    }
  }, [input, addToast, stopVoiceRecognition]);

  const toggleVoice = useCallback(() => {
    if (voiceStatus === 'listening') {
      stopVoiceRecognition();
    } else {
      startVoiceRecognition();
    }
  }, [voiceStatus, startVoiceRecognition, stopVoiceRecognition]);

  useEffect(() => {
    return () => {
      stopVoiceRecognition();
    };
  }, [stopVoiceRecognition]);

  // Support pasting images anywhere in Avelut AI chat
  useEffect(() => {
    const handleWindowPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items || items.length === 0) return;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            const reader = new FileReader();
            reader.onload = (ev) => {
              const result = ev.target?.result as string;
              if (result) {
                void addOptimizedImage(result);
              }
            };
            reader.readAsDataURL(file);
            return;
          }
        }
      }
    };

    window.addEventListener('paste', handleWindowPaste);
    return () => window.removeEventListener('paste', handleWindowPaste);
  }, [addOptimizedImage]);

  const handleSaveEdit = async (msgId: string, newText: string) => {
    const trimmed = newText.trim();
    if (!trimmed) return;

    // 1. Abort any active in-flight AI generation before processing edit
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    activeRequestIdRef.current = null;
    setIsLoading(false);

    setEditingMessageId(null);
    setActiveUserBubbleMenuId(null);

    const targetIdx = messages.findIndex((m) => m.id === msgId);
    if (targetIdx === -1) return;

    // 2. Delete all subsequent messages from targetIdx + 1 onward in SQLite
    const subsequentMsgs = messages.slice(targetIdx + 1);
    for (const sm of subsequentMsgs) {
      void deleteLocalMessage(sm.id);
    }

    // 3. Update the edited message text in SQLite
    void updateLocalMessageText(msgId, trimmed);

    // 4. Form truncated history up to targetIdx
    const updatedUserMsg: Message = { ...messages[targetIdx], text: trimmed };
    const truncatedHistory = [...messages.slice(0, targetIdx), updatedUserMsg];

    setMessages(truncatedHistory);
    if (activeConversationId) {
      chatMessagesMemoryCache.set(activeConversationId, truncatedHistory);
    }

    // 5. Trigger fresh AI response generation for the edited prompt using truncated history
    await handleSendMessage(trimmed, {
      editingUserMsgId: msgId,
      customHistory: truncatedHistory.slice(0, targetIdx),
    });
  };

  const handleSendMessage = async (
    customText?: string,
    options?: {
      editingUserMsgId?: string;
      customHistory?: Message[];
    }
  ) => {
    stopVoiceRecognition();
    void hideKeyboard();
    if (activeRequestIdRef.current || isLoading) {
      console.warn('[Chat] Duplicate submission blocked by active requestId lock:', activeRequestIdRef.current);
      return;
    }

    const textToSend = customText || input;
    if ((!textToSend.trim() && attachedImages.length === 0) || isLoading) return;

    const cost = getFeatureCost('chat_interaction', appSettings);
    const creditCheck = checkAICredits(userProfile, cost, appSettings);
    if (!creditCheck.allowed) {
      setShowLimitBanner(true);
      return;
    }

    const currentImages = [...attachedImages];
    const cleanUserText = textToSend.replace(/\[Attached Image\]/g, '').trim();
    const promptText = cleanUserText || (currentImages.length > 0 ? 'Please analyze these attached images, solve any problems shown, and explain them step by step in detail.' : '');
    const displayInput = cleanUserText;

    if (currentImages.length > MAX_CHAT_IMAGES) {
      addToast(`You can attach up to ${MAX_CHAT_IMAGES} images per message.`, 'warning');
      return;
    }

    // Estimate total payload size in bytes
    const totalImageBytes = currentImages.reduce((sum, img) => sum + img.length, 0);
    const textBytes = promptText.length;
    const totalPayloadBytes = totalImageBytes + textBytes;
    const payloadMB = (totalPayloadBytes / (1024 * 1024)).toFixed(2);

    if (totalPayloadBytes > MAX_SAFE_PAYLOAD_BYTES) {
      addToast('These images are too large to send together. Please remove one or more images or try smaller images.', 'warning');
      return;
    }

    const requestId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    activeRequestIdRef.current = requestId;

    console.log(`[Chat] request started requestId=${requestId} imageCount=${currentImages.length} payloadMB=${payloadMB}`);

    const now = Date.now();
    const isEditing = !!options?.editingUserMsgId;
    const userMsgId = options?.editingUserMsgId || generateLocalId('user_msg');
    const aiMsgId = generateLocalId('ai_msg');

    const userMsgAttachments = currentImages.map((img) => ({
      type: 'image' as const,
      dataUrl: img,
    }));

    // ⚡ INSTANT OPTIMISTIC DISPLAY: Display user message & AI thinking state immediately in the UI on line 1
    const optimisticUserMsg: Message = {
      id: userMsgId,
      text: displayInput,
      image_url: currentImages[0] || undefined,
      attachments: userMsgAttachments,
      sender: 'user',
      timestamp: now,
    };

    const optimisticAiMsg: Message = {
      id: aiMsgId,
      text: '',
      reasoningText: '',
      sender: 'bot',
      timestamp: now + 999999,
    };

    if (isEditing) {
      const priorHistory = options?.customHistory || [];
      const updatedUserMsg: Message = {
        ...(messages.find((m) => m.id === userMsgId) || optimisticUserMsg),
        id: userMsgId,
        text: displayInput,
        attachments: userMsgAttachments.length > 0 ? userMsgAttachments : (messages.find((m) => m.id === userMsgId)?.attachments),
        image_url: currentImages[0] || (messages.find((m) => m.id === userMsgId)?.image_url),
        sender: 'user',
        timestamp: now,
      };
      const activeBranch = [...priorHistory, updatedUserMsg, optimisticAiMsg];
      setMessages(activeBranch);
      if (activeConversationId) {
        chatMessagesMemoryCache.set(activeConversationId, [...priorHistory, updatedUserMsg]);
      }
    } else {
      setMessages((prev) => [...prev.filter((m) => m.id !== aiMsgId && m.id !== userMsgId), optimisticUserMsg, optimisticAiMsg]);
    }
    stickToBottomRef.current = true;
    const currentAbort = new AbortController();
    abortControllerRef.current = currentAbort;

    setInput('');
    setAttachedImages([]);
    setIsLoading(true);

    // Immediate re-pin after the optimistic message paints.
    requestAnimationFrame(() => scrollContainerToBottom(messagesScrollRef.current, 'auto'));

    try {
      let currentConvoId = activeConversationId;

      const isNewConvo = !currentConvoId;
      if (!currentConvoId) {
        currentConvoId = generateLocalId('conv');
        newlyCreatedConvoIdRef.current = currentConvoId;
        const initialTitle = (cleanUserText || (currentImages.length > 0 ? 'Image Analysis' : 'New Chat')).slice(0, 30);
        void saveLocalConversation({
          id: currentConvoId,
          user_id: userProfile.uid,
          title: initialTitle,
          created_at: now,
          last_updated_at: now,
        });

        setActiveConversationId(currentConvoId);
        onSelectConversation?.(currentConvoId);
      }

      // Title generation is queued in background without image attachments and strictly non-blocking
      const convoIdForTitle = currentConvoId;
      const textOnlyPrompt = (cleanUserText || 'Image Analysis').slice(0, 300);
      const triggerBackgroundTitleGen = () => {
        if (!isNewConvo || !ai || !convoIdForTitle) return;
        (async () => {
          try {
            const titleResult = await ai.models.generateContent({
              model: aiModel,
              contents: [{
                role: 'user',
                parts: [{
                  text: `Summarize the following user text into a short, concise chat title of 3 to 6 words. Do not use quotes, punctuation, or preamble. Return ONLY the title.\n\nUser text: "${textOnlyPrompt}"`
                }]
              }],
              config: { temperature: 0.3 }
            });
            const generatedTitle = getResponseText(titleResult).trim().replace(/^["']|["']$/g, '');
            if (generatedTitle && generatedTitle.length > 0) {
              void renameLocalConversation(convoIdForTitle, generatedTitle, userProfile.uid);
            }
          } catch (e) {
            console.warn('[Chat] Non-blocking title generation skipped on error:', (e as any)?.message || e);
          }
        })();
      };

      if (!isEditing) {
        // Save user message to local SQLite asynchronously (no cloud writes for speed & privacy)
        void saveLocalMessage({
          id: userMsgId,
          conversation_id: currentConvoId,
          user_id: userProfile.uid,
          sender: 'user',
          text: displayInput,
          attachments_json: userMsgAttachments.length > 0 ? JSON.stringify(userMsgAttachments) : null,
          image_url: currentImages[0] || undefined,
          timestamp: now,
        });
      }

      const updateOrAppendAiMessage = (
        text: string,
        reasoningText?: string,
        parts?: MessagePart[]
      ) => {
        setMessages((prev) => {
          const exists = prev.some((m) => m.id === aiMsgId);
          if (exists) {
            return prev.map((m) =>
              m.id === aiMsgId
                ? {
                    ...m,
                    text,
                    reasoningText,
                    parts: parts !== undefined ? parts : m.parts,
                  }
                : m
            );
          } else {
            return [
              ...prev,
              {
                id: aiMsgId,
                text,
                reasoningText,
                parts,
                sender: 'bot',
                timestamp: Date.now() + 999999,
              },
            ];
          }
        });
      };

      const baseSystemInstruction = [
        'You are Avelut, an intelligent, helpful, and versatile AI assistant and study companion.',
        '',
        'CURRENT USER CAPABILITY TOGGLES:',
        `- Browse: ${aiCapabilities.browse ? 'ON' : 'OFF'}`,
        `- Flashcards: ${aiCapabilities.flashcards ? 'ON' : 'OFF'}`,
        `- Quiz: ${aiCapabilities.quiz ? 'ON' : 'OFF'}`,
        `- Illustrations: ${aiCapabilities.illustrations ? 'ON' : 'OFF'}`,
        '',
        'STRICT RULES:',
        aiCapabilities.browse
          ? '- Browse is ON: You have internet browsing capability available for real-time web searches. When questions involve current events, today\'s news, live data, or recent facts (2024-2026), live web search results will be retrieved for you. Use them to answer accurately and cite source URLs. For timeless topics, science, math, code, concepts, and general conversation, answer directly from your knowledge base with clear, elite clarity.'
          : '- Browse is OFF: NEVER browse the web, never search, and never cite live web results. Answer only from knowledge + conversation.',
        aiCapabilities.flashcards
          ? '- Flashcards is ON: You may generate flashcards when the user asks or when it clearly helps learning.'
          : '- Flashcards is OFF: NEVER generate flashcards, never output flashcard-style Q/A cards (action:flashcards), and never suggest "here are some flashcards". Stay focused on normal conversational teaching.',
        aiCapabilities.quiz
          ? '- Quiz is ON: You may generate quizzes / practice questions when helpful or requested.'
          : '- Quiz is OFF: NEVER generate quizzes, multiple-choice questions as a quiz, or "quiz me" style content (action:cbt) unless the user explicitly forces it in plain language AND the toggle is on. Prefer normal explanation.',
        aiCapabilities.illustrations
          ? '- Illustrations is ON: You may produce or request illustrations / board drawings (```svg or pollinations images) when they aid understanding.'
          : '- Illustrations is OFF: NEVER generate or request board illustrations, diagrams, ```svg code fences, or visual drawing links/images.',
        '- If a capability is OFF, never produce that content in any form; just answer the user\'s message normally.',
        '',
        'Guidelines:',
        aiCapabilities.browse
          ? '- Web search capability is active. If grounding search results are provided in your context, base your answer on them and cite the sources.'
          : '- Web browsing is disabled by the user toggle.',
        '- Treat users naturally, warmly, and directly as a helpful general-purpose assistant. When greeted with casual greetings like "hello", "hi", "hey", or "good morning", respond concisely and friendly without assuming any specialized topic, course, or engineering major.',
        '- For substantive questions, study topics, homework, or tasks, provide elite, clear, structured explanations.',
        '- Be concise, clear, and structured. Do not include excessive background fluff or wordy preambles.',
        '- When formatting math or equations, use standard LaTeX ($...$ for inline, $$...$$ for blocks).',
        '- When explaining concepts:',
        '  * Use ## and ### headings for sections',
        '  * Use **bold** for key terms and *italics* for emphasis',
        '  * Use bullet lists and numbered steps for readability',
        '  * Use code fences with syntax highlighting for code/examples',
        aiCapabilities.quiz
          ? '- INTERACTIVE TESTING & CBT EXAMS: When a student asks you to test them, quiz them, practice exam questions, or create a mock exam on any topic, output an interactive CBT action card block:\n```action:cbt\n{\n  "title": "Topic Quiz Title",\n  "topic": "Subject/Topic",\n  "durationMinutes": 10,\n  "questions": [\n    {\n      "id": "q1",\n      "question": "Clear multiple choice question?",\n      "options": ["Option A", "Option B", "Option C", "Option D"],\n      "correctAnswer": 0,\n      "explanation": "Brief explanation of why this answer is correct."\n    }\n  ]\n}\n```'
          : '',
        aiCapabilities.flashcards
          ? '- FLASHCARDS CREATION: When a student asks to generate flashcards or summarize concepts for revision, output an interactive flashcard action card block:\n```action:flashcards\n{\n  "title": "Topic Flashcards Deck",\n  "topic": "Subject/Topic",\n  "cards": [\n    {\n      "front": "Front concept, term, or question",\n      "back": "Clear concise definition or explanation"\n    }\n  ]\n}\n```'
          : '',
        aiCapabilities.illustrations
          ? '- VISUAL SVG DIAGRAMS: When explaining workflows, structures, architectures, biological/chemical systems, algorithms, geometric layouts, or flowcharts, output a complete, responsive SVG visual diagram inside a ```svg code fence.\n- VISUAL IMAGES & ILLUSTRATIONS: When explaining physical objects, science, nature, anatomy, history, or real-world concepts, embed an educational visual using markdown: `![Caption description](https://image.pollinations.ai/prompt/detailed%20educational%20illustration%20of%20SUBJECT?width=800&height=500&nologo=true)` where SUBJECT is the specific topic.'
          : '',
        '- SUGGESTED NEXT STEPS / FOLLOW-UPS: For substantive or educational answers (but NOT on simple greetings like "hi" or "hello"), provide 2 to 3 relevant follow-up actions or questions that the user can tap. Prefix EACH follow-up on its own line with "↳ ". ONLY suggest actions that correspond to currently ON capabilities.',
      ].filter(Boolean).join('\n');

      let modeInstruction = '';
      if (selectedMode === 'fast') {
        modeInstruction = '\nKeep your answer extremely brief and to the point.';
      } else if (selectedMode === 'deep') {
        modeInstruction = '\nProvide a step-by-step explanation with clear details.';
      } else if (selectedMode === 'exam') {
        modeInstruction = '\nFormat as practice exam question style.';
      }

      const fullSystemInstruction = `${baseSystemInstruction}${modeInstruction}`;

      // Build multimodal parts for the current user turn: text + image 1 + image 2 + image 3...
      const userParts: any[] = [];
      currentImages.forEach((imgUrl) => {
        let mimeType = 'image/jpeg';
        let base64Data = imgUrl;
        const dataUrlMatch = imgUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (dataUrlMatch) {
          mimeType = dataUrlMatch[1];
          base64Data = dataUrlMatch[2];
        } else if (imgUrl.startsWith('data:')) {
          const parts = imgUrl.split(',');
          base64Data = parts[1] || '';
          const mimeMatch = parts[0].match(/:(.*?);/);
          if (mimeMatch) mimeType = mimeMatch[1];
        }
        userParts.push({
          inlineData: {
            mimeType,
            data: base64Data,
          },
        });
      });
      userParts.push({ text: promptText });

      const baseMessagesForHistory = options?.customHistory !== undefined ? options.customHistory : messages;
      const historyContents = baseMessagesForHistory
        .filter((m) => (m.text && m.text.trim()) || m.image_url || (m.attachments && m.attachments.length > 0))
        // Keep last 6 messages for context — smaller window = faster API calls
        .slice(-6)
        .map((m) => {
          const parts: any[] = [];
          // ⚡ SPEED: Strip base64 image data from older history messages to reduce payload size.
          // We only include image data in the CURRENT user turn (appended below), not in history.
          if (m.text && m.text.trim()) {
            parts.push({ text: m.text });
          } else if (m.image_url || (m.attachments && m.attachments.length > 0)) {
            // Placeholder for messages that only had images (keep them in history as text)
            parts.push({ text: '[Image]' });
          }
          return {
            role: (m.sender === 'user' && !isAiMessage(m)) ? 'user' : 'assistant',
            parts,
          };
        });

      historyContents.push({
        role: 'user',
        parts: userParts,
      });

      const shouldSearch = aiCapabilities.browse;
      const searchQuery = shouldSearch ? cleanSearchQuery(promptText) : '';

      const aiParams = {
        model: aiModel,
        contents: historyContents,
        signal: currentAbort.signal,
        config: {
          systemInstruction: fullSystemInstruction,
          temperature: selectedMode === 'fast' ? 0.3 : 0.5,
          signal: currentAbort.signal,
          webSearch: shouldSearch,
        },
      };

      let responseText = '';
      let reasoningText = '';
      let fromCache = false;
      let usageAcc: AiUsageMetadata = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

      if (!ai) {
        addToast('Avelut AI is not configured in settings.', 'error');
        setMessages((prev) => prev.filter((m) => m.id !== aiMsgId));
        return;
      }

      let browsingPart: MessagePart | null = shouldSearch ? {
        type: 'tool-invocation',
        toolInvocation: {
          toolName: 'web_search',
          state: 'input-streaming',
          args: { query: searchQuery || promptText },
          result: null,
        },
      } : null;

      // Show pulsing blue dot or browsing widget immediately for this bot message
      const initialParts: MessagePart[] = browsingPart ? [browsingPart] : [];
      updateOrAppendAiMessage('', '', initialParts.length > 0 ? initialParts : undefined);
      if (browsingPart && stickToBottomRef.current) {
        requestAnimationFrame(() => scrollContainerToBottom(messagesScrollRef.current, 'smooth'));
      }

      try {
        const responseStream = await ai.models.generateContentStream(aiParams);

        for await (const chunk of responseStream) {
          if (currentAbort.signal.aborted) {
            break;
          }
          usageAcc = accumulateUsageMetadata(usageAcc, chunk);
          const chunkText = getResponseText(chunk);
          const chunkReasoning = getResponseReasoningText(chunk);
          if (chunkReasoning) {
            reasoningText += chunkReasoning;
          }
          if (chunkText) {
            responseText += chunkText;
          }

          if (browsingPart) {
            const searchInfo = (chunk as any)?.searchInfo;
            const searchResults = searchInfo?.search_results || searchInfo?.results;
            const extractedUrls = responseText.match(/https?:\/\/[^\s\)\],>"']+/g) || [];

            const results = (searchResults && Array.isArray(searchResults) && searchResults.length > 0)
              ? searchResults.map((r: any) => ({ title: r.title || r.name, url: r.url || r.link }))
              : extractedUrls.map((url: string) => {
                  let hostname = url;
                  try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch {}
                  return { title: hostname, url };
                });

            if (responseText || results.length > 0) {
              browsingPart = {
                type: 'tool-invocation',
                toolInvocation: {
                  toolName: 'web_search',
                  state: 'output-available',
                  args: { query: searchQuery || promptText },
                  result: results,
                },
              };
            }
          }

          const currentParts: MessagePart[] = [];
          if (browsingPart) currentParts.push(browsingPart);
          if (responseText) currentParts.push({ type: 'text', text: responseText });

          updateOrAppendAiMessage(responseText, reasoningText, currentParts.length > 0 ? currentParts : undefined);
        }
      } catch (streamErr: any) {
        if (currentAbort.signal.aborted) {
          console.log('[Chat] Generation aborted by user during stream');
        } else {
          const isOffline = streamErr?.message?.includes('NETWORK_OFFLINE') ||
            streamErr?.message?.includes('Failed to fetch') ||
            (typeof navigator !== 'undefined' && !navigator.onLine);
          if (isOffline) {
            throw new Error('NETWORK_OFFLINE: Network connection lost. Please check your internet connection and try again.');
          }

          console.warn('Streaming failed or not supported, falling back to generateContent:', streamErr);
          const aiResult = await attemptApiCall(async () => {
            if (currentAbort.signal.aborted) return '';
            const result = await ai.models.generateContent(aiParams);
            usageAcc = accumulateUsageMetadata(usageAcc, result);
            const resText = getResponseText(result);
            if (!resText) throw new Error('Avelut AI returned an empty response.');
            return resText;
          });

          if (!currentAbort.signal.aborted) {
            if (!aiResult.success) {
              addToast(aiResult.message, 'error');
              setMessages((prev) => prev.filter((m) => m.id !== aiMsgId));
              return;
            }

            responseText = (aiResult.data || '').trim();
            if (browsingPart) {
              const extractedUrls = responseText.match(/https?:\/\/[^\s\)\],>"']+/g) || [];
              const results = extractedUrls.map((url: string) => {
                let hostname = url;
                try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch {}
                return { title: hostname, url };
              });
              browsingPart = {
                type: 'tool-invocation',
                toolInvocation: {
                  toolName: 'web_search',
                  state: 'output-available',
                  args: { query: searchQuery || promptText },
                  result: results,
                },
              };
            }
            const currentParts: MessagePart[] = [];
            if (browsingPart) currentParts.push(browsingPart);
            if (responseText) currentParts.push({ type: 'text', text: responseText });
            updateOrAppendAiMessage(responseText, reasoningText, currentParts.length > 0 ? currentParts : undefined);
          }
        }
      }

      // Safeguard against HTML index fallback being treated as chat response
      const isHtmlText = (str: string) => {
        const t = str.trim().toLowerCase();
        return t.startsWith('<!doctype') || t.startsWith('<html') || t.includes('<head>') || t.includes('id="root"');
      };

      if (isHtmlText(responseText)) {
        console.warn('[Chat] Detected HTML document in responseText. Rejecting index.html content.');
        setMessages((prev) => prev.filter((m) => m.id !== aiMsgId));
        addToast('Network connection lost. Please check your internet connection and try again.', 'error');
        return;
      }

      if (currentAbort.signal.aborted && !responseText.trim()) {
        responseText = 'Response aborted by user.';
        const currentParts: MessagePart[] = [{ type: 'text', text: responseText }];
        updateOrAppendAiMessage(responseText, reasoningText, currentParts);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId ? { ...m, status: 'interrupted' as const, text: responseText, parts: currentParts } : m
          )
        );
        void saveLocalMessage({
          id: aiMsgId,
          conversation_id: currentConvoId,
          user_id: userProfile.uid,
          sender: 'assistant',
          text: responseText,
          timestamp: Date.now(),
        });
        return;
      }

      if (responseText && currentImages.length === 0 && !currentAbort.signal.aborted) {
        void setCachedAIResponse(promptText, aiModel, selectedMode, responseText);
      }

      if (!currentAbort.signal.aborted) {
        // Trigger background title generation after primary chat response is successfully generated
        triggerBackgroundTitleGen();
      }

      if (!responseText.trim() && !currentAbort.signal.aborted) {
        responseText = 'I apologize, but I could not generate a response. Please try again.';
        const currentParts: MessagePart[] = [];
        if (browsingPart) currentParts.push(browsingPart);
        currentParts.push({ type: 'text', text: responseText });
        updateOrAppendAiMessage(responseText, reasoningText, currentParts);
      }

      if (responseText.trim()) {
        void saveLocalMessage({
          id: aiMsgId,
          conversation_id: currentConvoId,
          user_id: userProfile.uid,
          sender: 'assistant',
          text: responseText,
          timestamp: Date.now(),
        });

        void deductAICredits(userProfile.uid, cost, 'AI Chat Assistant', appSettings, {
          promptTokens: usageAcc.promptTokens,
          completionTokens: usageAcc.completionTokens,
          totalTokens: usageAcc.totalTokens,
          model: aiModel,
          metadata: { path: 'chat', from_cache: fromCache, mode: selectedMode },
        });
      }
    } catch (err: any) {
      if (currentAbort.signal.aborted || err?.name === 'AbortError') {
        console.log('[Chat] Generation stopped by user.');
        const finalText = responseText.trim() ? responseText : 'Response aborted by user.';
        const currentParts: MessagePart[] = [{ type: 'text', text: finalText }];
        updateOrAppendAiMessage(finalText, reasoningText, currentParts);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId ? { ...m, status: 'interrupted' as const, text: finalText, parts: currentParts } : m
          )
        );
        void saveLocalMessage({
          id: aiMsgId,
          conversation_id: currentConvoId,
          user_id: userProfile.uid,
          sender: 'assistant',
          text: finalText,
          timestamp: Date.now(),
        });
        return;
      }
      console.error('[Chat] Error in chat:', err);

      const rawErrMsg = err?.message || String(err || '');
      const isNetworkOffline =
        rawErrMsg.includes('NETWORK_OFFLINE') ||
        rawErrMsg.includes('Network connection lost') ||
        rawErrMsg.includes('Failed to fetch') ||
        (typeof navigator !== 'undefined' && !navigator.onLine);

      if (isNetworkOffline) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsgId
              ? {
                  ...m,
                  status: 'network_error' as const,
                  text: '',
                }
              : m
          )
        );
        addToast('Network connection lost. Please check your internet connection and try again.', 'error');
      } else {
        // Clean up empty bot placeholder if streaming failed
        setMessages((prev) => prev.filter((m) => m.id !== aiMsgId || (m.text && m.text.trim().length > 0)));

        // Restore attached images if sending failed so user can easily retry
        if (currentImages.length > 0) {
          setAttachedImages((prev) => (prev.length === 0 ? currentImages : prev));
        }

        if (rawErrMsg.includes("temporarily busy") || rawErrMsg.includes("429") || rawErrMsg.includes("RATE_LIMIT") || rawErrMsg.includes("overloaded")) {
          addToast("Avelut's AI provider is temporarily busy. Please try again in a moment.", "error");
        } else {
          addToast(rawErrMsg || 'An error occurred while sending your message.', 'error');
        }
      }
    } finally {
      activeRequestIdRef.current = null;
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  };

  const [likedMessages, setLikedMessages] = useState<Record<string, 'up' | 'down'>>({});

  const handleToggleLike = (msgId: string, rating: 'up' | 'down') => {
    setLikedMessages((prev) => {
      const current = prev[msgId];
      if (current === rating) {
        const next = { ...prev };
        delete next[msgId];
        return next;
      }
      return { ...prev, [msgId]: rating };
    });
    addToast(rating === 'up' ? 'Feedback submitted (Thumbs up)' : 'Feedback submitted (Thumbs down)', 'info');
  };

  const handleCopyMessage = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      addToast('Copied to clipboard', 'success');
    }).catch(() => {
      addToast('Failed to copy text', 'error');
    });
  };

  const handleShareMessage = async (text: string) => {
    if (!text) return;
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({
          title: 'Avelut AI',
          text: text,
          dialogTitle: 'Share response',
        });
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: 'Avelut AI',
          text: text,
        });
        return;
      }
    } catch (e: any) {
      if (e?.name === 'AbortError' || e?.message?.includes('canceled') || e?.message?.includes('cancelled')) {
        return;
      }
    }
    // Fallback to copying if sharing is not supported on this platform
    handleCopyMessage(text);
  };

  const handleRegenerateMessage = (msgIndex: number) => {
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].sender === 'user' && !isAiMessage(messages[i])) {
        void handleSendMessage(messages[i].text);
        break;
      }
    }
  };

  const handleToggleTTS = useCallback((msgId: string, rawText: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      addToast('Speech playback is not supported on this device.', 'info');
      return;
    }
    if (speakingMsgId === msgId) {
      window.speechSynthesis.cancel();
      setSpeakingMsgId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const cleanSpeechText = rawText
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[#*_~>]/g, '')
      .replace(/↳\s.*$/gm, '')
      .trim();

    if (!cleanSpeechText) return;

    const utterance = new SpeechSynthesisUtterance(cleanSpeechText);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onend = () => setSpeakingMsgId(null);
    utterance.onerror = () => setSpeakingMsgId(null);
    setSpeakingMsgId(msgId);
    window.speechSynthesis.speak(utterance);
  }, [speakingMsgId, addToast]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);


  return (
    <div className="flex-1 flex flex-col h-full w-full bg-white dark:bg-black overflow-hidden text-neutral-900 dark:text-white">
      {/* MESSAGES / EMPTY STATE AREA */}
      <div
        ref={messagesScrollRef}
        onScroll={handleMessagesScroll}
        className="flex-1 overflow-y-auto px-4 pt-3 sm:pt-4 pb-6 space-y-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden overscroll-contain"
      >
        {isSwitchingChat ? (
          <div className="w-full max-w-3xl mx-auto py-10 space-y-6 animate-in fade-in duration-300">
            {/* Soft, beautiful chat skeleton loader */}
            <div className="flex justify-end animate-pulse">
              <div className="w-48 sm:w-64 h-12 bg-neutral-200/80 dark:bg-[#252528] rounded-[22px] rounded-br-xs shadow-2xs" />
            </div>
            <div className="flex justify-start space-y-3 flex-col max-w-[85%] sm:max-w-[75%] animate-pulse">
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-full bg-blue-600/20 dark:bg-blue-400/20 flex items-center justify-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-600 dark:bg-blue-400" />
                </div>
                <div className="w-20 h-3.5 bg-neutral-200 dark:bg-[#252528] rounded-full" />
              </div>
              <div className="space-y-2.5 pl-8">
                <div className="w-full h-4 bg-neutral-200/70 dark:bg-[#252528]/80 rounded-lg" />
                <div className="w-5/6 h-4 bg-neutral-200/70 dark:bg-[#252528]/80 rounded-lg" />
                <div className="w-3/5 h-4 bg-neutral-200/50 dark:bg-[#252528]/50 rounded-lg" />
              </div>
            </div>
            <div className="flex justify-end animate-pulse pt-2">
              <div className="w-36 sm:w-52 h-10 bg-neutral-200/60 dark:bg-[#252528]/60 rounded-[22px] rounded-br-xs" />
            </div>
          </div>
        ) : messages.length === 0 && !isLoading ? (
          <div className="flex-1 h-full min-h-[40vh]" />
        ) : (
          <div className="w-full max-w-3xl mx-auto space-y-8">
            {messages.map((msg, index) => {
              const isUser = msg.sender === 'user' && !isAiMessage(msg);
              return (
                <div
                  key={msg.id}
                  style={{ contentVisibility: 'auto', containIntrinsicSize: '0 80px' }}
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'} gpu-accelerated animate-in fade-in slide-in-from-bottom-2 duration-200 ease-out`}
                >
                  {isUser ? (
                    <div className="group relative max-w-[85%] sm:max-w-[75%] flex flex-col items-end">
                      {msg.attachments && msg.attachments.length > 0 ? (
                        <ImageGridRenderer images={msg.attachments.map((a) => a.dataUrl)} />
                      ) : msg.image_url ? (
                        <ImageGridRenderer images={[msg.image_url]} />
                      ) : null}

                      {editingMessageId === msg.id ? (
                        <div className="w-full min-w-[260px] sm:min-w-[340px] max-w-full bg-[#f0f0f0] dark:bg-[#2f2f2f] rounded-[22px] p-3.5 text-neutral-900 dark:text-white shadow-sm border border-neutral-300 dark:border-white/10 animate-in fade-in zoom-in-95 duration-150">
                          <textarea
                            value={editingMessageText}
                            onChange={(e) => setEditingMessageText(e.target.value)}
                            className="w-full bg-transparent resize-none outline-none text-[15px] sm:text-[16px] leading-relaxed [scrollbar-width:none] [&::-webkit-scrollbar]:hidden min-h-[72px]"
                            rows={Math.min(8, Math.max(2, editingMessageText.split('\n').length))}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                void handleSaveEdit(msg.id, editingMessageText);
                              } else if (e.key === 'Escape') {
                                setEditingMessageId(null);
                              }
                            }}
                          />
                          <div className="flex items-center justify-end gap-2 mt-2 pt-2 border-t border-neutral-200/60 dark:border-white/5">
                            <button
                              type="button"
                              onClick={() => setEditingMessageId(null)}
                              className="px-3 py-1 rounded-full text-xs font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-200/60 dark:hover:bg-white/10 transition-colors cursor-pointer"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              disabled={!editingMessageText.trim() || isLoading}
                              onClick={() => void handleSaveEdit(msg.id, editingMessageText)}
                              className="px-3.5 py-1 rounded-full text-xs font-medium bg-black dark:bg-white text-white dark:text-black hover:opacity-90 disabled:opacity-40 transition-all shadow-sm active:scale-95 cursor-pointer"
                            >
                              Save & Submit
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div
                            onClick={() => {
                              setActiveUserBubbleMenuId((prev) => (prev === msg.id ? null : msg.id));
                            }}
                            className="cursor-pointer"
                          >
                            {msg.text ? <CollapsibleUserMessage text={msg.text} /> : null}
                          </div>

                          {/* Action icons below sent user prompt: Pen (Edit) and Copy */}
                          <div
                            className={`flex items-center justify-end gap-1.5 mt-1 pr-1 text-neutral-400 dark:text-neutral-500 transition-opacity duration-200 ${
                              activeUserBubbleMenuId === msg.id
                                ? 'opacity-100'
                                : 'opacity-0 sm:group-hover:opacity-100'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingMessageId(msg.id);
                                setEditingMessageText(msg.text || '');
                              }}
                              className="p-1 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
                              title="Edit prompt"
                              aria-label="Edit prompt"
                            >
                              <Pencil className="w-3.5 h-3.5" strokeWidth={1.8} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyMessage(msg.text || '');
                              }}
                              className="p-1 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
                              title="Copy prompt"
                              aria-label="Copy prompt"
                            >
                              <Copy className="w-3.5 h-3.5" strokeWidth={1.8} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                  <div className="w-full bg-transparent border-0 shadow-none p-0 min-w-0">
                    <div className="w-full min-w-0">
                      {msg.status === 'network_error' ? (
                        <div className="w-full max-w-md rounded-2xl border border-red-200/80 dark:border-red-900/40 bg-red-50/70 dark:bg-red-950/20 p-4 text-red-900 dark:text-red-200 flex flex-col gap-3 shadow-xs">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center shrink-0 text-red-600 dark:text-red-400">
                              <WifiOff className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-neutral-900 dark:text-white">
                                Network connection lost
                              </div>
                              <div className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">
                                Please check your internet connection and try again.
                              </div>
                            </div>
                          </div>
                          <div className="flex justify-end pt-1">
                            <button
                              type="button"
                              onClick={() => handleRegenerateMessage(index)}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-sm transition-all active:scale-95 cursor-pointer"
                            >
                              <RefreshCcw className="w-3.5 h-3.5" />
                              <span>Retry</span>
                            </button>
                          </div>
                        </div>
                      ) : (!msg.text && (!msg.parts || msg.parts.length === 0)) ? (
                        <div className="py-1">
                          <ThinkingTypingIndicator
                            label="thinking"
                            reasoningText={msg.reasoningText}
                            isStreaming={isLoading}
                          />
                        </div>
                      ) : (
                        (() => {
                          const { cleanedText, followUps } = parseFollowUpsAndContent(msg.text || '');
                          return (
                            <div className="min-w-0">
                              {/* Message Parts with Tool Status Rendering */}
                              {msg.parts && msg.parts.length > 0 ? (
                                <div className="space-y-2">
                                  {msg.parts.map((part, pIdx) => {
                                    if (
                                      part.type === 'tool-invocation' &&
                                      part.toolInvocation &&
                                      part.toolInvocation.toolName === 'web_search'
                                    ) {
                                      return (
                                        <ToolStatus
                                          key={pIdx}
                                          toolName={part.toolInvocation.toolName}
                                          state={part.toolInvocation.state}
                                          args={part.toolInvocation.args}
                                          result={part.toolInvocation.result}
                                          isStreaming={isLoading}
                                        />
                                      );
                                    }
                                    if (part.type === 'text' && part.text) {
                                      const partCleaned = parseFollowUpsAndContent(part.text).cleanedText || part.text;
                                      return <MarkdownContent key={pIdx} content={partCleaned} />;
                                    }
                                    return null;
                                  })}
                                </div>
                              ) : (
                                <MarkdownContent content={cleanedText || msg.text || ''} />
                              )}

                              {/* Interrupted / Aborted State UI */}
                              {(msg.status === 'interrupted' ||
                                (msg.parts &&
                                  msg.parts.some((p) => p.type === 'text' && p.text?.length === 0))) && (
                                <div className="flex flex-col gap-3 mt-3 p-3 rounded-lg bg-neutral-100 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700/60">
                                  <span className="text-base font-medium text-neutral-600 dark:text-neutral-400">
                                    Response interrupted
                                  </span>
                                  <div className="flex gap-4 text-neutral-500 dark:text-neutral-400">
                                    <button
                                      type="button"
                                      onClick={() => handleShareMessage(cleanedText || msg.text || '')}
                                      className="hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
                                      title="Share"
                                    >
                                      <Share2 className="w-5 h-5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleToggleLike(msg.id, 'up')}
                                      className="hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
                                      title="Thumbs up"
                                    >
                                      <ThumbsUp className="w-5 h-5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleToggleLike(msg.id, 'down')}
                                      className="hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
                                      title="Thumbs down"
                                    >
                                      <ThumbsDown className="w-5 h-5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleRegenerateMessage(index)}
                                      className="hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
                                      title="Regenerate"
                                    >
                                      <RefreshCcw className="w-5 h-5" />
                                    </button>
                                  </div>
                                </div>
                              )}
                              {isLoading && index === messages.length - 1 && (
                                <span aria-hidden="true" className="inline-block w-2.5 h-2.5 ml-1.5 bg-blue-600 dark:bg-blue-400 rounded-full animate-dot-breathe align-middle" />
                              )}

                              {/* Interactive Suggested Follow-Up Prompts (matching user screenshot) */}
                              {followUps.length > 0 && (!isLoading || index < messages.length - 1) && (
                                <div className="flex flex-col items-start gap-2.5 mt-5 mb-2 pl-0.5">
                                  {followUps.map((prompt, pIdx) => (
                                    <button
                                      key={pIdx}
                                      type="button"
                                      onClick={() => {
                                        void handleSendMessage(prompt);
                                      }}
                                      className="group flex items-start sm:items-center gap-2.5 text-left text-[14px] sm:text-[15px] text-neutral-800 dark:text-neutral-200 hover:text-black dark:hover:text-white transition-colors cursor-pointer"
                                    >
                                      <span className="text-neutral-500 dark:text-neutral-400 group-hover:text-black dark:group-hover:text-white text-base leading-none select-none font-sans">↳</span>
                                      <span className="underline underline-offset-[5px] decoration-neutral-400 dark:decoration-neutral-600 group-hover:decoration-black dark:group-hover:decoration-white font-medium dark:font-normal transition-colors">
                                        {prompt}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}

                              {/* Exact Action Row Matching Screenshot: Copy, Thumbs Up, Thumbs Down, Speaker, Share, More */}
                              <div className="pt-2">
                                <div className="flex items-center gap-4 text-neutral-600 dark:text-neutral-400 select-none">
                                  {/* Copy button */}
                                  <button
                                    type="button"
                                    onClick={() => handleCopyMessage(cleanedText || msg.text)}
                                    className="p-1 rounded-md text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white transition-colors cursor-pointer"
                                    title="Copy text"
                                    aria-label="Copy text"
                                  >
                                    <Copy className="w-4 h-4" strokeWidth={1.8} />
                                  </button>

                                  {/* Thumbs up button */}
                                  <button
                                    type="button"
                                    onClick={() => handleToggleLike(msg.id, 'up')}
                                    className={`p-1 rounded-md transition-colors cursor-pointer ${
                                      likedMessages[msg.id] === 'up' ? 'text-blue-600 fill-blue-500/20' : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                                    }`}
                                    title="Good response"
                                    aria-label="Good response"
                                  >
                                    <ThumbsUp className="w-4 h-4" strokeWidth={1.8} />
                                  </button>

                                  {/* Thumbs down button */}
                                  <button
                                    type="button"
                                    onClick={() => handleToggleLike(msg.id, 'down')}
                                    className={`p-1 rounded-md transition-colors cursor-pointer ${
                                      likedMessages[msg.id] === 'down' ? 'text-red-500 fill-red-500/20' : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                                    }`}
                                    title="Bad response"
                                    aria-label="Bad response"
                                  >
                                    <ThumbsDown className="w-4 h-4" strokeWidth={1.8} />
                                  </button>

                                  {/* Speaker (Read aloud TTS) button */}
                                  <button
                                    type="button"
                                    onClick={() => handleToggleTTS(msg.id, cleanedText || msg.text)}
                                    className={`p-1 rounded-md transition-colors cursor-pointer ${
                                      speakingMsgId === msg.id ? 'text-blue-500 animate-pulse' : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white'
                                    }`}
                                    title={speakingMsgId === msg.id ? 'Stop reading' : 'Read aloud'}
                                    aria-label={speakingMsgId === msg.id ? 'Stop reading' : 'Read aloud'}
                                  >
                                    <Volume2 className="w-4 h-4" strokeWidth={1.8} />
                                  </button>

                                  {/* Share button */}
                                  <button
                                    type="button"
                                    onClick={() => handleShareMessage(cleanedText || msg.text)}
                                    className="p-1 rounded-md text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white transition-colors cursor-pointer"
                                    title="Share response"
                                    aria-label="Share response"
                                  >
                                    <Share2 className="w-4 h-4" strokeWidth={1.8} />
                                  </button>

                                  {/* More button (vertical 3-dots) with popover dropdown */}
                                  <div className="relative">
                                    <button
                                      type="button"
                                      onClick={() => setMoreMenuMsgId((prev) => (prev === msg.id ? null : msg.id))}
                                      className="p-1 rounded-md text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white transition-colors cursor-pointer"
                                      title="More options"
                                      aria-label="More options"
                                    >
                                      <MoreVertical className="w-4 h-4" strokeWidth={1.8} />
                                    </button>

                                    {moreMenuMsgId === msg.id && (
                                      <div className="absolute left-0 bottom-full mb-2 w-40 bg-white dark:bg-[#18181b] border border-neutral-200/80 dark:border-neutral-800 rounded-xl shadow-xl py-1 z-30 animate-in fade-in zoom-in-95 duration-150">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setMoreMenuMsgId(null);
                                            handleRegenerateMessage(index);
                                          }}
                                          className="w-full text-left px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2"
                                        >
                                          <RotateCw className="w-3.5 h-3.5" strokeWidth={1.8} />
                                          Regenerate
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setMoreMenuMsgId(null);
                                            addToast('Thank you for reporting. Our team will review this response.', 'info');
                                          }}
                                          className="w-full text-left px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2"
                                        >
                                          <AlertCircle className="w-3.5 h-3.5" strokeWidth={1.8} />
                                          Report issue
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {/* Subtle horizontal separator line under the action row as in the screenshot */}
                                <div className="w-full border-b border-neutral-200 dark:border-neutral-800/80 mt-3" />
                              </div>
                            </div>
                          );
                        })()
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
            <div ref={messagesEndRef} className="h-2" />
          </div>
        )}
      </div>

      {/* LIMIT REACHED BANNER */}
      {showLimitBanner && (
        <div className="px-3 sm:px-6 pb-2 w-full">
          <ChatLimitBanner
            title="Free tier limit reached"
            subtitle="Try again later or upgrade to Pro for much higher limits and premium features."
            actionText="Upgrade to Pro"
            onNavigate={onNavigate}
          />
        </div>
      )}

      {/* INPUT BAR */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) {
            const selected = Array.from(files);
            if (selected.length + attachedImages.length > MAX_CHAT_IMAGES) {
              addToast(`You can attach a maximum of ${MAX_CHAT_IMAGES} images.`, 'warning');
            }
            selected.slice(0, MAX_CHAT_IMAGES - attachedImages.length).forEach((file) => {
              const reader = new FileReader();
              reader.onload = (ev) => {
                const res = ev.target?.result as string;
                if (res) {
                  void addOptimizedImage(res);
                }
              };
              reader.readAsDataURL(file);
            });
          }
          if (fileInputRef.current) fileInputRef.current.value = '';
        }}
      />
      <input
        ref={docFileInputRef}
        type="file"
        accept="image/*,.pdf,.doc,.docx,.txt"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) {
            const selected = Array.from(files);
            selected.forEach((file) => {
              if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                  const res = ev.target?.result as string;
                  if (res) void addOptimizedImage(res);
                };
                reader.readAsDataURL(file);
              } else {
                const reader = new FileReader();
                reader.onload = (ev) => {
                  const res = ev.target?.result as string;
                  if (res) {
                    setInput((prev) => (prev ? `${prev}\n\n[Attached File: ${file.name}]\n${res.slice(0, 4000)}` : `[Attached File: ${file.name}]\n${res.slice(0, 4000)}`));
                  }
                };
                reader.readAsText(file);
              }
            });
          }
          if (docFileInputRef.current) docFileInputRef.current.value = '';
        }}
      />
      <GrokChatComposer
        input={input}
        setInput={setInput}
        isLoading={isLoading}
        selectedMode={selectedMode}
        onSelectMode={setSelectedMode}
        voiceStatus={voiceStatus}
        onToggleVoice={toggleVoice}
        attachedImages={attachedImages}
        onRemoveImage={(idx) => setAttachedImages((prev) => prev.filter((_, i) => i !== idx))}
        onAttachImage={(img) => void addOptimizedImage(img)}
        onOpenGallery={() => fileInputRef.current?.click()}
        onOpenCamera={() => setIsCameraOpen(true)}
        onOpenFile={() => docFileInputRef.current?.click()}
        capabilities={aiCapabilities}
        onToggleCapability={handleToggleCapability}
        onSend={() => handleSendMessage()}
        onStop={handleStopGenerating}
        autoFocus={true}
      />

      {isCameraOpen && (
        <CameraCaptureView
          onClose={() => setIsCameraOpen(false)}
          onConfirm={(base64Img) => {
            void addOptimizedImage(base64Img);
            setIsCameraOpen(false);
          }}
        />
      )}

      <LimitExceededModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        userProfile={userProfile}
        appSettings={appSettings}
        cost={getFeatureCost('chat_interaction', appSettings)}
        balance={userProfile?.ai_credits_balance ?? 0}
        addToast={addToast}
      />

      <ConfirmationModal
        {...modalState}
        onCancel={() => setModalState((s) => ({ ...s, isOpen: false }))}
        isConfirming={isDeleting}
      />
    </div>
  );
};
