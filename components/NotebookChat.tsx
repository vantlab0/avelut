import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createAvelutAI, getResponseText, getResponseReasoningText, accumulateUsageMetadata, type AiUsageMetadata } from '../utils/inference';
import { checkAICredits, deductAICredits, getFeatureCost, getFeatureModel } from '../utils/usage';
import { getChapterGeneration, saveChapterGeneration, deleteChapterGeneration, getChapterContent } from '../services/notebookStorageService';
import { LimitExceededModal } from './LimitExceededModal';
import { useAppSettings } from '../hooks/useAppSettings';
import { useToast } from '../hooks/useToast';
import { MarkdownContent } from './MarkdownContent';
import { ThinkingTypingIndicator } from './ThinkingTypingIndicator';
import { ChatLimitBanner } from './ChatLimitBanner';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { compressBase64Image } from '../utils/mediaUpload';
import {
  GrokChatComposer,
  CollapsibleUserMessage,
  CameraCaptureView,
  ImageGridRenderer,
  parseFollowUpsAndContent,
  type ChatMode,
} from './Chat';
import {
  getOrGenerateTopicStructure,
  type TopicStructureData,
} from '../services/topicStructureService';
import { isAiMessage } from '../utils/chatMessageNormalizer';
import type { UserProfile } from '../types';
import type { Notebook, NotebookChapter } from '../services/notebookStorageService';

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: number;
  reasoningText?: string;
  attachments?: Array<{
    id: string;
    name: string;
    url: string;
    isImage: boolean;
  }>;
}

interface NotebookChatProps {
  notebook: Notebook;
  chapter: NotebookChapter;
  chapterContent: string;
  userProfile: UserProfile;
  onBack: () => void;
  setCustomHeaderConfig?: (config: any) => void;
}

const MAX_CHAT_IMAGES = 6;

export const NotebookChat: React.FC<NotebookChatProps> = ({
  notebook,
  chapter,
  chapterContent,
  userProfile,
  onBack,
  setCustomHeaderConfig,
}) => {
  const { settings: appSettings } = useAppSettings();
  const { addToast } = useToast();

  const [activeContent, setActiveContent] = useState<string>(chapterContent || '');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [showLimitBanner, setShowLimitBanner] = useState(false);
  const [limitCost, setLimitCost] = useState(1);
  const [chapterStructure, setChapterStructure] = useState<TopicStructureData | null>(null);
  const [selectedMode, setSelectedMode] = useState<ChatMode>('deep');
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'listening' | 'processing'>('idle');
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [likedMessages, setLikedMessages] = useState<Record<string, 'up' | 'down'>>({});
  const [moreMenuMsgId, setMoreMenuMsgId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any>(null);

  // Load or generate chapter structure JSON stored on device
  useEffect(() => {
    let isMounted = true;
    getOrGenerateTopicStructure({
      topicKey: `nb_${notebook.id}_ch_${chapter.id}`,
      topicTitle: chapter.title,
      courseTitle: notebook.title,
      context: activeContent.slice(0, 500),
      userProfile,
      appSettings,
    }).then((struct) => {
      if (isMounted && struct) {
        setChapterStructure(struct);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [notebook.id, chapter.id, chapter.title, notebook.title, activeContent, userProfile, appSettings]);

  // Self-load chapter content if missing
  useEffect(() => {
    if (chapterContent && chapterContent.trim().length > 0) {
      setActiveContent(chapterContent);
    } else {
      getChapterContent(notebook.id, chapter.id, { startPage: chapter.startPage, endPage: chapter.endPage })
        .then((content) => {
          if (content && content.trim().length > 0) {
            setActiveContent(content);
          }
        })
        .catch((err) => console.warn('[NotebookChat] Error loading chapter content:', err));
    }
  }, [notebook.id, chapter.id, chapter.startPage, chapter.endPage, chapterContent]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  // Restore existing chat messages from storage
  useEffect(() => {
    let isMounted = true;
    getChapterGeneration<ChatMessage[]>(notebook.id, chapter.id, userProfile?.uid || 'local', 'chat')
      .then((saved) => {
        if (isMounted && saved && Array.isArray(saved) && saved.length > 0) {
          setMessages(saved);
          setTimeout(() => scrollToBottom('instant'), 50);
        }
      })
      .catch((err) => console.warn('[NotebookChat] Error restoring chat history:', err));
    return () => {
      isMounted = false;
    };
  }, [notebook.id, chapter.id, userProfile?.uid, scrollToBottom]);

  useEffect(() => {
    scrollToBottom('smooth');
  }, [messages.length, scrollToBottom]);

  const handleClearHistory = useCallback(async () => {
    if (window.confirm('Clear conversation history for this chapter?')) {
      setMessages([]);
      await deleteChapterGeneration(notebook.id, chapter.id, 'chat');
      addToast('Conversation history cleared.', 'info');
    }
  }, [notebook.id, chapter.id, addToast]);

  // Configure Main App Header for Notebook Chat
  useEffect(() => {
    if (setCustomHeaderConfig) {
      setCustomHeaderConfig({
        hideBottomNav: true,
        hideTitle: true,
        hideDefaultRightActions: true,
        leftActions: (
          <div className="flex items-center gap-2.5 min-w-0 max-w-[calc(100vw-110px)] sm:max-w-none">
            <button
              onClick={onBack}
              className="w-10 h-10 rounded-full bg-white dark:bg-[#1A1A1A] hover:bg-neutral-100 dark:hover:bg-[#252528] border border-neutral-200 dark:border-neutral-800 flex items-center justify-center text-neutral-800 dark:text-white transition-all cursor-pointer shrink-0 shadow-2xs active:scale-95"
              aria-label="Back to chapters"
              title="Back"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="min-w-0 flex flex-col justify-center">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[14px] sm:text-[15px] font-semibold text-neutral-900 dark:text-white truncate">
                  {chapter.title}
                </span>
                <span className="px-1.5 py-0.2 rounded-md bg-neutral-100 dark:bg-neutral-800 text-[10px] font-semibold tracking-wider text-neutral-600 dark:text-neutral-400 uppercase shrink-0">
                  Notebook
                </span>
              </div>
              <span className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                {notebook.title}
              </span>
            </div>
          </div>
        ),
        rightActions: messages.length > 0 ? (
          <button
            type="button"
            onClick={handleClearHistory}
            className="w-9 h-9 rounded-full bg-white dark:bg-[#1A1A1A] hover:bg-neutral-100 dark:hover:bg-[#252528] border border-neutral-200 dark:border-neutral-800 flex items-center justify-center text-neutral-500 hover:text-red-500 dark:text-neutral-400 dark:hover:text-red-400 transition-all cursor-pointer shadow-2xs"
            title="Clear Chat History"
            aria-label="Clear Chat History"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        ) : null,
        className: 'bg-white/95 dark:bg-black/95 border-b border-neutral-200/80 dark:border-neutral-800/80 backdrop-blur-md',
      });
    }

    return () => {
      if (setCustomHeaderConfig) {
        setCustomHeaderConfig(null);
      }
    };
  }, [setCustomHeaderConfig, onBack, handleClearHistory, messages.length, chapter.title, notebook.title]);

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
      setAttachedImages((prev) => (prev.length < MAX_CHAT_IMAGES ? [...prev, base64Img] : prev));
    }
  }, [addToast]);

  const handleStopGenerating = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsSending(false);
  }, []);

  const toggleVoice = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addToast('Voice input is not supported in this browser.', 'info');
      return;
    }

    if (voiceStatus === 'listening') {
      recognitionRef.current?.stop();
      setVoiceStatus('idle');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'en-US';
      recognition.interimResults = true;
      recognition.continuous = false;

      recognition.onstart = () => {
        setVoiceStatus('listening');
      };

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((res: any) => res[0].transcript)
          .join('');
        setInputValue(transcript);
      };

      recognition.onerror = () => {
        setVoiceStatus('idle');
      };

      recognition.onend = () => {
        setVoiceStatus('idle');
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      setVoiceStatus('idle');
    }
  }, [voiceStatus, addToast]);

  const buildNotebookSystemPrompt = useCallback(() => {
    let excerpt = (activeContent || chapterContent || '').trim();
    const isGroundingAvailable = excerpt.length > 0;
    const focusedExcerpt = isGroundingAvailable ? excerpt.slice(0, 3000) : '';

    return [
      `You are an expert, encouraging academic tutor helping a student deeply master their textbook chapter: "${chapter.title}" from "${notebook.title}".`,
      isGroundingAvailable ? `GROUNDING CONTEXT FROM CHAPTER:\n${focusedExcerpt}` : '',
      '',
      'CRITICAL TEACHING WORKFLOW (Strictly Follow):',
      '1. FIRST, CREATE AND PRESENT A STRUCTURED CHAPTER STUDY PLAN:',
      '   Whenever starting a new chapter tutorial session or if no study plan has been shown yet, you MUST begin your message with the Master Chapter Study Plan outlining the progressive bytes:',
      '   ### 📋 Chapter Study Plan: ' + chapter.title,
      '   1. **Byte 1: Core Concept & Foundation** — What this chapter introduces, why it matters, and the big-picture intuition.',
      '   2. **Byte 2: Key Terminology & Definitions** — Critical terms directly from the text.',
      '   3. **Byte 3: Step-by-Step Mechanics** — How the concepts operate systematically.',
      '   4. **Byte 4: Formulas, Proofs & Practical Examples** — Concrete mathematics, code, or scenarios from the material.',
      '   5. **Byte 5: Exam Questions & Common Pitfalls** — Typical exam problems and traps to avoid.',
      '   6. **Byte 6: Final Synthesis & Recall Check** — Mastery verification.',
      '',
      '2. IMMEDIATELY DELIVER BYTE 1:',
      '   Right below the study plan, begin Byte 1 immediately:',
      '   ### Byte 1: The Core Concept & Foundation',
      '   - Teach the foundation clearly and concisely (90-130 words). Strictly ground your explanation in the chapter notes.',
      '   - Conclude with ONE simple check question to test the student\'s understanding before Byte 2.',
      '   - Always append 2 interactive follow-up suggestions starting with ↳ written strictly from the student\'s first-person perspective (e.g. "↳ Ready for Byte 2: Key Terms", "↳ Give me a real-world example", "↳ Quiz me on this byte"). Never phrase as "Would you like..." or "Do you want...".',
      '',
      '3. SUBSEQUENT BYTE PROGRESSION:',
      '   - Assess the student\'s answer warmly and accurately.',
      '   - If correct, praise briefly and smoothly proceed to deliver the NEXT BYTE from the study plan.',
      '   - Keep every turn strictly bite-sized (90-130 words). Never output giant walls of text.',
      '   - End every turn with ONE check question and 2 follow-ups starting with ↳.',
      '',
      '4. TYPOGRAPHIC HIERARCHY:',
      '   - Use ### for Byte / Section headings.',
      '   - Use **bold** for key terms and core definitions.',
      '   - Highlight critical takeaways with ==this== or <mark>this</mark>.',
      '   - Format all equations and symbols with LaTeX ($...$ inline or $$...$$ block).',
      '   - Use code fences with syntax highlighting for code.',
    ].filter(Boolean).join('\n');
  }, [activeContent, chapterContent, chapter.title, notebook.title]);

  // Auto-initiate chapter study plan & Byte 1 if chat is empty
  useEffect(() => {
    if (messages.length === 0 && !isSending && (activeContent || chapterContent)) {
      void initFirstChapterByte();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContent, chapterContent]);

  const initFirstChapterByte = async () => {
    const ai = createAvelutAI(appSettings, userProfile, {
      endpointPreference: 'openai_compatible_first',
      feature: 'study_guide_chat',
    });
    if (!ai) return;

    setIsSending(true);
    const starterAiMsgId = `msg_ai_${Date.now()}`;
    const initialPlaceholder: ChatMessage = {
      id: starterAiMsgId,
      sender: 'assistant',
      text: '',
      timestamp: Date.now(),
    };
    setMessages([initialPlaceholder]);

    const systemPrompt = buildNotebookSystemPrompt();
    const chatModel = getFeatureModel('chat_interaction', appSettings) || 'qwen3.5-omni-flash';

    const aiParams = {
      model: chatModel,
      contents: [
        {
          role: 'user',
          parts: [{ text: `Hello! Please create our study plan for "${chapter.title}" from "${notebook.title}" and start teaching me byte by byte.` }],
        },
      ],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.35,
        maxOutputTokens: 600,
      },
    };

    let streamedText = '';
    let streamedReasoning = '';
    try {
      const responseStream = await ai.models.generateContentStream(aiParams);
      for await (const chunk of responseStream) {
        const chunkText = getResponseText(chunk);
        const chunkReasoning = getResponseReasoningText(chunk);
        if (chunkReasoning) streamedReasoning += chunkReasoning;
        if (chunkText) {
          streamedText += chunkText;
          setMessages((prev) =>
            prev.map((m) => (m.id === starterAiMsgId ? { ...m, text: streamedText, reasoningText: streamedReasoning } : m))
          );
        }
      }
    } catch (err) {
      console.warn('[NotebookChat] Starter stream error:', err);
    }

    if (!streamedText.trim()) {
      streamedText = `### 📋 Chapter Study Plan: ${chapter.title}\n1. **Byte 1: Core Concept & Foundation**\n2. **Byte 2: Key Terminology & Definitions**\n3. **Byte 3: Step-by-Step Mechanics**\n4. **Byte 4: Formulas & Worked Examples**\n5. **Byte 5: Exam Traps**\n\n---\n\n### Byte 1: The Core Concept\nWelcome to your chapter tutorial on **${chapter.title}**! Let's break this chapter down byte-by-byte so you master it thoroughly. Ready to start with the foundational intuition?\n\n↳ Ready for Byte 1\n↳ Give me an overview of the chapter`;
    }

    const finalMessages = [
      {
        id: starterAiMsgId,
        sender: 'assistant' as const,
        text: streamedText,
        reasoningText: streamedReasoning,
        timestamp: Date.now(),
      },
    ];

    setMessages(finalMessages);
    void saveChapterGeneration(notebook.id, chapter.id, userProfile?.uid || 'local', 'chat', finalMessages);
    setIsSending(false);
  };

  const handleSendMessage = async (customText?: string) => {
    const textToSend = (customText || inputValue).trim();
    if (!textToSend && attachedImages.length === 0) return;
    if (isSending) return;

    const cost = getFeatureCost('chat_interaction', appSettings);
    setLimitCost(cost);
    const creditCheck = checkAICredits(userProfile, cost, appSettings);
    if (!creditCheck.allowed) {
      setShowLimitBanner(true);
      return;
    }

    const ai = createAvelutAI(appSettings, userProfile, {
      endpointPreference: 'openai_compatible_first',
      feature: 'study_guide_chat',
    });
    if (!ai) {
      addToast('AI service is not configured.', 'error');
      return;
    }

    const currentImages = [...attachedImages];
    const inlineParts: any[] = [];
    currentImages.forEach((dataUrl) => {
      const base64Data = dataUrl.split(',')[1];
      if (base64Data) {
        inlineParts.push({
          inlineData: {
            data: base64Data,
            mimeType: 'image/jpeg',
          },
        });
      }
    });

    const now = Date.now();
    const userMsgId = `msg_user_${now}`;
    const aiMsgId = `msg_ai_${now + 1}`;

    const userMessage: ChatMessage = {
      id: userMsgId,
      sender: 'user',
      text: textToSend,
      timestamp: now,
      attachments: currentImages.length > 0 ? currentImages.map((img, i) => ({
        id: `att_${now}_${i}`,
        name: `Image ${i + 1}`,
        url: img,
        isImage: true,
      })) : undefined,
    };

    const aiPlaceholderMsg: ChatMessage = {
      id: aiMsgId,
      sender: 'assistant',
      text: '',
      timestamp: now + 1,
    };

    const nextMessages = [...messages, userMessage, aiPlaceholderMsg];
    setMessages(nextMessages);
    setInputValue('');
    setAttachedImages([]);
    setIsSending(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const systemPrompt = buildNotebookSystemPrompt();
    const chatModel = getFeatureModel('chat_interaction', appSettings) || 'qwen3.8-omni-flash';

    const historyContents = messages
      .filter((m) => m.text && m.text.trim())
      .slice(-8)
      .map((m) => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        parts: [{ text: m.text }],
      }));

    const latestUserParts: any[] = [...inlineParts];
    if (textToSend) {
      latestUserParts.push({ text: textToSend });
    } else {
      latestUserParts.push({ text: '(Student shared an image for chapter reference)' });
    }

    historyContents.push({
      role: 'user',
      parts: latestUserParts,
    });

    const aiParams = {
      model: chatModel,
      contents: historyContents,
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.35,
        maxOutputTokens: 550,
      },
    };

    let streamedText = '';
    let streamedReasoning = '';
    let usageAcc: AiUsageMetadata = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    try {
      const responseStream = await ai.models.generateContentStream(aiParams);
      for await (const chunk of responseStream) {
        if (abortController.signal.aborted) break;
        usageAcc = accumulateUsageMetadata(usageAcc, chunk);
        const chunkText = getResponseText(chunk);
        const chunkReasoning = getResponseReasoningText(chunk);
        if (chunkReasoning) streamedReasoning += chunkReasoning;
        if (chunkText) {
          streamedText += chunkText;
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsgId ? { ...m, text: streamedText, reasoningText: streamedReasoning } : m))
          );
        }
      }
    } catch (err: any) {
      if (!abortController.signal.aborted) {
        console.warn('[NotebookChat] Stream error:', err);
      }
    }

    if (!streamedText.trim() && !abortController.signal.aborted) {
      streamedText = 'I encountered a brief connection issue. Could you please rephrase or continue with our study plan?';
    }

    const finalMessages = nextMessages.map((m) =>
      m.id === aiMsgId ? { ...m, text: streamedText, reasoningText: streamedReasoning } : m
    );

    setMessages(finalMessages);
    void saveChapterGeneration(notebook.id, chapter.id, userProfile?.uid || 'local', 'chat', finalMessages);

    if (userProfile?.uid && !abortController.signal.aborted) {
      void deductAICredits(userProfile.uid, cost, 'Notebook Chat Tutor', appSettings, {
        promptTokens: usageAcc.promptTokens,
        completionTokens: usageAcc.completionTokens,
        totalTokens: usageAcc.totalTokens,
        model: chatModel,
        metadata: { path: 'notebook_chat', notebook_id: notebook.id, chapter_id: chapter.id },
      });
    }

    setIsSending(false);
    abortControllerRef.current = null;
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
          title: `${chapter.title} - ${notebook.title}`,
          text: text,
          dialogTitle: 'Share chapter byte',
        });
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: `${chapter.title} - ${notebook.title}`,
          text: text,
        });
        return;
      }
    } catch (e: any) {
      if (e?.name === 'AbortError' || e?.message?.includes('canceled') || e?.message?.includes('cancelled')) {
        return;
      }
    }
    handleCopyMessage(text);
  };

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
    addToast(rating === 'up' ? 'Feedback submitted (Helpful byte)' : 'Feedback submitted (Needs improvement)', 'info');
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

  const handleRegenerateMessage = (msgIndex: number) => {
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].sender === 'user') {
        void handleSendMessage(messages[i].text);
        break;
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full w-full bg-white dark:bg-black overflow-hidden text-neutral-900 dark:text-white">
      {/* MESSAGES SCROLL CONTAINER */}
      <div className="flex-1 overflow-y-auto px-4 pt-3 sm:pt-4 pb-6 space-y-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="w-full max-w-3xl mx-auto space-y-8">
          {messages.map((msg, index) => {
            const isUser = msg.sender === 'user' && !isAiMessage(msg);
            return (
              <div
                key={msg.id}
                style={{ contentVisibility: 'auto', containIntrinsicSize: '0 80px' }}
                className={`flex ${isUser ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-200 ease-out`}
              >
                {isUser ? (
                  <div className="max-w-[85%] sm:max-w-[75%] flex flex-col items-end">
                    {msg.attachments && msg.attachments.length > 0 && (
                      <ImageGridRenderer images={msg.attachments.map((a) => a.url)} />
                    )}
                    {msg.text && <CollapsibleUserMessage text={msg.text} />}
                  </div>
                ) : (
                <div className="w-full bg-transparent border-0 shadow-none p-0 min-w-0">
                  <div className="w-full min-w-0">
                    {!msg.text ? (
                      <div className="py-1">
                        <ThinkingTypingIndicator
                          label="structuring chapter byte..."
                          reasoningText={msg.reasoningText}
                          isStreaming={isSending}
                        />
                      </div>
                    ) : (
                      (() => {
                        const { cleanedText, followUps } = parseFollowUpsAndContent(msg.text);
                        return (
                          <div className="min-w-0">
                            <MarkdownContent content={cleanedText || msg.text} />
                            {isSending && index === messages.length - 1 && (
                              <span aria-hidden="true" className="inline-block w-2.5 h-2.5 ml-1.5 bg-neutral-900 dark:bg-white rounded-full animate-dot-breathe align-middle" />
                            )}

                            {/* Interactive Suggested Follow-Up Prompts */}
                            {followUps.length > 0 && (!isSending || index < messages.length - 1) && (
                              <div className="flex flex-col items-start gap-2.5 mt-5 mb-2 pl-0.5">
                                {followUps.map((prompt, pIdx) => (
                                  <button
                                    key={pIdx}
                                    type="button"
                                    onClick={() => void handleSendMessage(prompt)}
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

                            {/* Exact Action Row: Copy, Thumbs Up, Thumbs Down, Speaker, Share, More */}
                            <div className="pt-2">
                              <div className="flex items-center gap-4 text-neutral-600 dark:text-neutral-400 select-none">
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

                                <button
                                  type="button"
                                  onClick={() => handleToggleLike(msg.id, 'up')}
                                  className={`p-1 rounded-md transition-colors cursor-pointer ${
                                    likedMessages[msg.id] === 'up' ? 'text-black dark:text-white' : 'hover:text-neutral-900 dark:hover:text-white'
                                  }`}
                                  title="Helpful byte"
                                  aria-label="Helpful byte"
                                >
                                  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                                  </svg>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleToggleLike(msg.id, 'down')}
                                  className={`p-1 rounded-md transition-colors cursor-pointer ${
                                    likedMessages[msg.id] === 'down' ? 'text-red-500' : 'hover:text-neutral-900 dark:hover:text-white'
                                  }`}
                                  title="Unclear explanation"
                                  aria-label="Unclear explanation"
                                >
                                  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3" />
                                  </svg>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleToggleTTS(msg.id, cleanedText || msg.text)}
                                  className={`p-1 rounded-md transition-colors cursor-pointer ${
                                    speakingMsgId === msg.id ? 'text-neutral-900 dark:text-white animate-pulse' : 'hover:text-neutral-900 dark:hover:text-white'
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
                                        Regenerate byte
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setMoreMenuMsgId(null);
                                          addToast('Thank you for your feedback.', 'info');
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
      </div>

      {/* LIMIT BANNER */}
      {showLimitBanner && (
        <div className="px-3 sm:px-6 pb-2 w-full">
          <ChatLimitBanner
            title="Free tier limit reached"
            subtitle="Upgrade to Pro for higher limits and unlimited textbook tutoring."
            actionText="Upgrade to Pro"
            onNavigate={() => {}}
          />
        </div>
      )}

      {/* HIDDEN FILE INPUT FOR GALLERY */}
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

      {/* AVELUT AI CHAT COMPOSER */}
      <GrokChatComposer
        input={inputValue}
        setInput={setInputValue}
        isLoading={isSending}
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

      {/* CAMERA CAPTURE VIEW */}
      {isCameraOpen && (
        <CameraCaptureView
          onClose={() => setIsCameraOpen(false)}
          onConfirm={(base64Img) => {
            void addOptimizedImage(base64Img);
            setIsCameraOpen(false);
          }}
        />
      )}

      {/* LIMIT EXCEEDED MODAL */}
      <LimitExceededModal
        isOpen={showLimitModal}
        onClose={() => setShowLimitModal(false)}
        userProfile={userProfile}
        appSettings={appSettings}
        cost={limitCost}
        balance={userProfile?.ai_credits_balance ?? 0}
        addToast={addToast}
      />
    </div>
  );
};

export default NotebookChat;
