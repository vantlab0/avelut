import { db, get, off, onValue, push, ref as dbRef, remove, serverTimestamp, set, update } from '@/lib/backend';
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createAvelutAI, getResponseText, getResponseReasoningText, accumulateUsageMetadata, type AiUsageMetadata } from '../utils/inference';
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
} from '../services/chatStorageService';
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
import { RefreshCcw, ThumbsUp, ThumbsDown, Share2 } from 'lucide-react';
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
  onSend,
  onStop,
  autoFocus,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  // Close attach menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    };
    if (showAttachMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
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
      className="w-full max-w-3xl mx-auto px-3 sm:px-4 pb-[calc(max(0.75rem,env(safe-area-inset-bottom)))] pt-2 relative z-20 bg-white/95 dark:bg-black/95 backdrop-blur-md shrink-0"
      onPaste={handlePaste}
    >
      <div className="relative flex flex-col bg-[#f4f4f5] dark:bg-[#212124] rounded-[28px] border border-neutral-200/70 dark:border-white/5 transition-all focus-within:ring-1 focus-within:ring-black/10 dark:focus-within:ring-white/10 shadow-sm">
        
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
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-neutral-900 text-white flex items-center justify-center shadow-md hover:bg-neutral-800 transition-colors cursor-pointer"
                  aria-label="Remove image"
                >
                  <i className="bi bi-x text-xs" />
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
            className="w-full bg-transparent border-0 outline-none focus:outline-none focus:ring-0 text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-neutral-500 text-[15px] sm:text-base resize-none max-h-36 py-0 leading-relaxed [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          />
        </div>

        {/* Bottom Row */}
        <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
          {/* Left Actions: + (plus) button AND Memory Card quick button */}
          <div className="flex items-center gap-2">
            <div className="relative" ref={attachMenuRef}>
              <button
                type="button"
                onClick={handleAttachClick}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                  showAttachMenu
                    ? 'bg-neutral-200 dark:bg-white/20 text-neutral-900 dark:text-white'
                    : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white hover:bg-neutral-200/50 dark:hover:bg-white/10'
                }`}
                title="Attach file"
                aria-label="Attach file"
              >
                <svg className={`w-5 h-5 transition-transform ${showAttachMenu ? 'rotate-45' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>

              {/* Popup Menu — Gallery / Camera (Clean, neutral monochrome design) */}
              {showAttachMenu && (
                <div className="absolute bottom-full left-0 mb-2.5 w-48 sm:w-52 bg-white dark:bg-[#18181b] rounded-2xl shadow-xl border border-neutral-200 dark:border-neutral-800 p-1.5 z-50 animate-in slide-in-from-bottom-2 fade-in duration-150">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAttachMenu(false);
                      onOpenGallery();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 transition-colors cursor-pointer text-left no-underline select-none group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0 text-neutral-700 dark:text-neutral-300 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <polyline points="21 15 16 10 5 21" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <span className="block font-semibold text-xs sm:text-sm text-neutral-900 dark:text-white no-underline">Gallery</span>
                      <span className="block text-[11px] text-neutral-500 dark:text-neutral-400 font-normal no-underline">Upload photos</span>
                    </div>
                  </button>

                  <div className="h-[1px] bg-neutral-100 dark:bg-neutral-800/60 my-1 mx-2" />

                  <button
                    type="button"
                    onClick={() => {
                      setShowAttachMenu(false);
                      onOpenCamera();
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800/80 transition-colors cursor-pointer text-left no-underline select-none group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0 text-neutral-700 dark:text-neutral-300 group-hover:text-neutral-900 dark:group-hover:text-white transition-colors">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2-2h6l2 2h4a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <span className="block font-semibold text-xs sm:text-sm text-neutral-900 dark:text-white no-underline">Camera</span>
                      <span className="block text-[11px] text-neutral-500 dark:text-neutral-400 font-normal no-underline">Snap a photo</span>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Right: Pill-shaped Action Button for Speaker and Send states */}
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
              className={`h-11 sm:h-12 px-5 sm:px-6 rounded-full flex items-center justify-center gap-2 shrink-0 shadow-md transition-all duration-200 active:scale-95 font-bold text-sm select-none ${
                isLoading
                  ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-500/30 cursor-pointer animate-in fade-in duration-150'
                  : voiceStatus === 'listening'
                  ? 'bg-red-500 hover:bg-red-600 text-white animate-pulse shadow-red-500/25'
                  : hasText
                  ? 'bg-black dark:bg-white hover:bg-neutral-800 dark:hover:bg-neutral-100 text-white dark:text-black shadow-black/20 dark:shadow-white/20'
                  : 'bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900'
              }`}
              title={isLoading ? 'Stop generating' : voiceStatus === 'listening' ? 'Stop listening' : hasText ? 'Send message' : 'Speak to dictate'}
              aria-label={isLoading ? 'Stop generating' : voiceStatus === 'listening' ? 'Stop listening' : hasText ? 'Send message' : 'Speak to dictate'}
            >
              {isLoading ? (
                <>
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="5" y="5" width="14" height="14" rx="2.5" />
                  </svg>
                  <span>Stop</span>
                </>
              ) : voiceStatus === 'listening' ? (
                <>
                  <span className="flex items-center gap-0.5 h-4">
                    <span className="w-1 h-3 bg-white rounded-full animate-pulse" style={{animationDelay:'0ms'}} />
                    <span className="w-1 h-5 bg-white rounded-full animate-pulse" style={{animationDelay:'150ms'}} />
                    <span className="w-1 h-2 bg-white rounded-full animate-pulse" style={{animationDelay:'300ms'}} />
                  </span>
                  <span>Listening...</span>
                </>
              ) : hasText ? (
                <>
                  <span>Send</span>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.757 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
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
      return chatMessagesMemoryCache.get(propActiveConversationId)!;
    }
    return [];
  });
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
  const switchingConvoIdRef = useRef<string | null>(null);
  const newlyCreatedConvoIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
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
      if (lastMsg && lastMsg.sender === 'bot') {
        return prev.map((m, idx) =>
          idx === prev.length - 1 ? { ...m, status: 'interrupted' as const } : m
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
          const sorted = data.sort((a, b) => a.timestamp - b.timestamp);
          setMessages((current) => {
            const dbTexts = new Set(sorted.map((m: any) => `${m.sender === 'user' ? 'user' : 'bot'}:${m.text}`));
            const dbIds = new Set(sorted.map((m: any) => m.id));
            const inFlight = current.filter(
              (m) => !dbIds.has(m.id) && !dbTexts.has(`${m.sender}:${m.text}`)
            );
            const inFlightUsers = inFlight.filter((m) => m.sender === 'user');
            const inFlightBots = inFlight.filter((m) => m.sender !== 'user');
            const merged = [...sorted, ...inFlightUsers].sort((a, b) => a.timestamp - b.timestamp);
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
      setMessages(chatMessagesMemoryCache.get(activeConversationId)!);
      setIsSwitchingChat(false);
    } else if (!isLoadingRef.current) {
      setIsSwitchingChat(true);
    }

    const loadLocal = () => {
      getLocalMessages(activeConversationId).then((localMsgs) => {
        if (isMounted && switchingConvoIdRef.current === activeConversationId) {
          const localFormatted: Message[] = localMsgs.map((m) => {
            let attachments: any[] | undefined = undefined;
            if (m.attachments_json) {
              try {
                attachments = JSON.parse(m.attachments_json);
              } catch {}
            }
            return {
              id: m.id,
              text: m.text,
              image_url: m.image_url || undefined,
              attachments,
              sender: (m.sender === 'user' ? 'user' : 'bot') as 'user' | 'bot',
              timestamp: m.timestamp,
            };
          });
          const sorted = localFormatted.sort((a, b) => a.timestamp - b.timestamp);
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

  // Only scroll down when a conversation loads or a new message is sent.
  // DO NOT auto-scroll on every streaming chunk of text so user can read from line 1 while streaming.
  const prevMsgCountRef = useRef(messages.length);
  const activeConvoRef = useRef(activeConversationId);
  useEffect(() => {
    const isConvoSwitched = activeConvoRef.current !== activeConversationId;
    activeConvoRef.current = activeConversationId;

    if (isConvoSwitched || messages.length > prevMsgCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length, activeConversationId]);

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

  const handleSendMessage = async (customText?: string) => {
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
    const userMsgId = generateLocalId('msg');
    const aiMsgId = generateLocalId('msg');

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

    setMessages((prev) => [...prev.filter((m) => m.id !== aiMsgId && m.id !== userMsgId), optimisticUserMsg, optimisticAiMsg]);
    const currentAbort = new AbortController();
    abortControllerRef.current = currentAbort;

    setInput('');
    setAttachedImages([]);
    setIsLoading(true);

    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });

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

      const updateOrAppendAiMessage = (text: string, reasoningText?: string) => {
        setMessages((prev) => {
          const exists = prev.some((m) => m.id === aiMsgId);
          if (exists) {
            return prev.map((m) => (m.id === aiMsgId ? { ...m, text, reasoningText } : m));
          } else {
            return [...prev, { id: aiMsgId, text, reasoningText, sender: 'bot', timestamp: Date.now() + 999999 }];
          }
        });
      };

      const baseSystemInstruction = [
        'You are Avelut, an intelligent, helpful, and versatile AI assistant and study companion.',
        'Guidelines:',
        '- You have web search capabilities enabled via web_search. Whenever asked for current events, real-time facts, news, latest statistics, live data, or web search, NEVER state "I cannot search the internet" or "I do not have internet access". ALWAYS use web search or answer using live tools.',
        '- Treat users naturally, warmly, and directly as a helpful general-purpose assistant. When greeted with casual greetings like "hello", "hi", "hey", or "good morning", respond concisely and friendly without assuming any specialized topic, course, or engineering major (e.g., "Hello! How can I help you today?").',
        '- For substantive questions, study topics, homework, or tasks, provide elite, clear, structured explanations with rich visual tools.',
        '- Be concise, clear, and structured. Do not include excessive background fluff or wordy preambles.',
        '- When formatting math or equations, use standard LaTeX ($...$ for inline, $$...$$ for blocks).',
        '- When explaining concepts:',
        '  * Use ## and ### headings for sections',
        '  * Use **bold** for key terms and *italics* for emphasis',
        '  * Use bullet lists and numbered steps for readability',
        '  * Use code fences with syntax highlighting for code/examples',
        '- INTERACTIVE TESTING & CBT EXAMS: When a student asks you to test them, quiz them, practice exam questions, or create a mock exam on any topic, output an interactive CBT action card block:',
        '```action:cbt',
        '{',
        '  "title": "Topic Quiz Title",',
        '  "topic": "Subject/Topic",',
        '  "durationMinutes": 10,',
        '  "questions": [',
        '    {',
        '      "id": "q1",',
        '      "question": "Clear multiple choice question?",',
        '      "options": ["Option A", "Option B", "Option C", "Option D"],',
        '      "correctAnswer": 0,',
        '      "explanation": "Brief explanation of why this answer is correct."',
        '    }',
        '  ]',
        '}',
        '```',
        '- FLASHCARDS CREATION: When a student asks to generate flashcards or summarize concepts for revision, output an interactive flashcard action card block:',
        '```action:flashcards',
        '{',
        '  "title": "Topic Flashcards Deck",',
        '  "topic": "Subject/Topic",',
        '  "cards": [',
        '    {',
        '      "front": "Front concept, term, or question",',
        '      "back": "Clear concise definition or explanation"',
        '    }',
        '  ]',
        '}',
        '```',
        '- VISUAL SVG DIAGRAMS: When explaining workflows, structures, architectures, biological/chemical systems, algorithms, geometric layouts, or flowcharts, output a complete, responsive SVG visual diagram inside a ```svg code fence. Always include xmlns="http://www.w3.org/2000/svg", a viewBox (e.g. viewBox="0 0 600 350"), clean labels, and contrasting modern colors (#3b82f6, #10b981, #8b5cf6, #f59e0b, #ffffff, #94a3b8). NEVER just talk about a diagram—render it!',
        '- VISUAL IMAGES & ILLUSTRATIONS: When explaining physical objects, science, nature, anatomy, history, or real-world concepts, embed an educational visual using markdown: `![Caption description](https://image.pollinations.ai/prompt/detailed%20educational%20illustration%20of%20SUBJECT?width=800&height=500&nologo=true)` where SUBJECT is the specific topic. This guarantees real, high-resolution visuals.',
        '- SUGGESTED NEXT STEPS / FOLLOW-UPS: For substantive or educational answers (but NOT on simple greetings like "hi" or "hello"), provide 2 to 3 relevant follow-up actions or questions that the user can tap. Prefix EACH follow-up on its own line with "↳ ", for example:',
        '↳ Test me on this concept with 5 CBT questions',
        '↳ Generate flashcards for key definitions',
        '↳ Explain this with an interactive visual SVG diagram',
      ].join('\n');

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

      const historyContents = messages
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
            role: m.sender === 'user' ? 'user' : 'assistant',
            parts,
          };
        });

      historyContents.push({
        role: 'user',
        parts: userParts,
      });

      const aiParams = {
        model: aiModel,
        contents: historyContents,
        signal: currentAbort.signal,
        config: {
          systemInstruction: fullSystemInstruction,
          temperature: selectedMode === 'fast' ? 0.3 : 0.5,
          signal: currentAbort.signal,
          // Lower temperature = faster, more deterministic responses
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

      // Show pulsing blue dot indicator immediately for this bot message
      updateOrAppendAiMessage('', '');

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
          updateOrAppendAiMessage(responseText, reasoningText);
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
            updateOrAppendAiMessage(responseText, reasoningText);
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
        // User aborted before any text was received
        setMessages((prev) => prev.filter((m) => m.id !== aiMsgId));
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
        updateOrAppendAiMessage(responseText);
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
        return;
      }
      console.error('[Chat] Error in chat:', err);
      // Clean up empty bot placeholder if streaming failed
      setMessages((prev) => prev.filter((m) => m.id !== aiMsgId || m.text.trim().length > 0));

      // Restore attached images if sending failed so user can easily retry
      if (currentImages.length > 0) {
        setAttachedImages((prev) => (prev.length === 0 ? currentImages : prev));
      }

      const rawErrMsg = err?.message || String(err || '');
      if (
        rawErrMsg.includes('NETWORK_OFFLINE') ||
        rawErrMsg.includes('Network connection lost') ||
        rawErrMsg.includes('Failed to fetch') ||
        (typeof navigator !== 'undefined' && !navigator.onLine)
      ) {
        addToast('Network connection lost. Please check your internet connection and try again.', 'error');
      } else if (rawErrMsg.includes("temporarily busy") || rawErrMsg.includes("429") || rawErrMsg.includes("RATE_LIMIT") || rawErrMsg.includes("overloaded")) {
        addToast("Avelut's AI provider is temporarily busy. Please try again in a moment.", "error");
      } else {
        addToast(rawErrMsg || 'An error occurred while sending your message.', 'error');
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
      if (messages[i].sender === 'user') {
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
      <div className="flex-1 overflow-y-auto px-4 pt-3 sm:pt-4 pb-6 space-y-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
            {messages.map((msg, index) => (
              <div
                key={msg.id}
                style={{ contentVisibility: 'auto', containIntrinsicSize: '0 80px' }}
                className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'} gpu-accelerated animate-in fade-in slide-in-from-bottom-2 duration-200 ease-out`}
              >
                {msg.sender === 'user' ? (
                  <div className="max-w-[85%] sm:max-w-[75%] flex flex-col items-end">
                    {msg.attachments && msg.attachments.length > 0 ? (
                      <ImageGridRenderer images={msg.attachments.map((a) => a.dataUrl)} />
                    ) : msg.image_url ? (
                      <ImageGridRenderer images={[msg.image_url]} />
                    ) : null}
                    {msg.text ? <CollapsibleUserMessage text={msg.text} /> : null}
                  </div>
                ) : (
                  <div className="w-full bg-transparent border-0 shadow-none p-0 min-w-0">
                    <div className="w-full min-w-0">
                      {!msg.text ? (
                        <div className="py-1">
                          <ThinkingTypingIndicator
                            label="thinking"
                            reasoningText={msg.reasoningText}
                            isStreaming={isLoading}
                          />
                        </div>
                      ) : (
                        (() => {
                          const { cleanedText, followUps } = parseFollowUpsAndContent(msg.text);
                          return (
                            <div className="min-w-0">
                              {/* Message Parts with Tool Status Rendering */}
                              {msg.parts && msg.parts.length > 0 ? (
                                msg.parts.map((part, pIdx) => {
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
                                      />
                                    );
                                  }
                                  if (part.type === 'text' && part.text) {
                                    return <MarkdownContent key={pIdx} content={part.text} />;
                                  }
                                  return null;
                                })
                              ) : (
                                <MarkdownContent content={cleanedText || msg.text} />
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
                                    className="p-1 rounded-md hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
                                    title="Copy text"
                                    aria-label="Copy text"
                                  >
                                    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                    </svg>
                                  </button>

                                  {/* Thumbs up button */}
                                  <button
                                    type="button"
                                    onClick={() => handleToggleLike(msg.id, 'up')}
                                    className={`p-1 rounded-md transition-colors cursor-pointer ${
                                      likedMessages[msg.id] === 'up' ? 'text-blue-600 fill-blue-500/20' : 'hover:text-neutral-900 dark:hover:text-white'
                                    }`}
                                    title="Good response"
                                    aria-label="Good response"
                                  >
                                    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                                    </svg>
                                  </button>

                                  {/* Thumbs down button */}
                                  <button
                                    type="button"
                                    onClick={() => handleToggleLike(msg.id, 'down')}
                                    className={`p-1 rounded-md transition-colors cursor-pointer ${
                                      likedMessages[msg.id] === 'down' ? 'text-red-500 fill-red-500/20' : 'hover:text-neutral-900 dark:hover:text-white'
                                    }`}
                                    title="Bad response"
                                    aria-label="Bad response"
                                  >
                                    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
                                    </svg>
                                  </button>

                                  {/* Speaker (Read aloud TTS) button */}
                                  <button
                                    type="button"
                                    onClick={() => handleToggleTTS(msg.id, cleanedText || msg.text)}
                                    className={`p-1 rounded-md transition-colors cursor-pointer ${
                                      speakingMsgId === msg.id ? 'text-blue-500 animate-pulse' : 'hover:text-neutral-900 dark:hover:text-white'
                                    }`}
                                    title={speakingMsgId === msg.id ? 'Stop reading' : 'Read aloud'}
                                    aria-label={speakingMsgId === msg.id ? 'Stop reading' : 'Read aloud'}
                                  >
                                    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                                    </svg>
                                  </button>

                                  {/* Share button */}
                                  <button
                                    type="button"
                                    onClick={() => handleShareMessage(cleanedText || msg.text)}
                                    className="p-1 rounded-md hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
                                    title="Share response"
                                    aria-label="Share response"
                                  >
                                    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                      <circle cx="18" cy="5" r="3" />
                                      <circle cx="6" cy="12" r="3" />
                                      <circle cx="18" cy="19" r="3" />
                                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                                      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                                    </svg>
                                  </button>

                                  {/* More button (vertical 3-dots) with popover dropdown */}
                                  <div className="relative">
                                    <button
                                      type="button"
                                      onClick={() => setMoreMenuMsgId((prev) => (prev === msg.id ? null : msg.id))}
                                      className="p-1 rounded-md hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
                                      title="More options"
                                      aria-label="More options"
                                    >
                                      <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor">
                                        <circle cx="12" cy="5" r="1.75" />
                                        <circle cx="12" cy="12" r="1.75" />
                                        <circle cx="12" cy="19" r="1.75" />
                                      </svg>
                                    </button>

                                    {moreMenuMsgId === msg.id && (
                                      <div className="absolute left-0 bottom-full mb-2 w-40 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-xl shadow-xl py-1 z-30 animate-in fade-in zoom-in-95 duration-150">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setMoreMenuMsgId(null);
                                            handleRegenerateMessage(index);
                                          }}
                                          className="w-full text-left px-3 py-2 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors flex items-center gap-2"
                                        >
                                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                          </svg>
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
                                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                          </svg>
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
            ))}
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
