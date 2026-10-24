import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createAvelutAI, getResponseText, getResponseReasoningText, accumulateUsageMetadata, type AiUsageMetadata } from '../utils/inference';
import { checkAICredits, deductAICredits, getFeatureCost, getFeatureModel, hasLiveTutorialAccess } from '../utils/usage';
import { readCachedJson, writeCachedJson } from '../utils/cache';
import { LimitExceededModal } from './LimitExceededModal';
import { useAppSettings } from '../hooks/useAppSettings';
import { useToast } from '../hooks/useToast';
import { useApiLimiter } from '../hooks/useApiLimiter';
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
  saveTopicStructureProgress,
  type TopicStructureData,
} from '../services/topicStructureService';
import { isAiMessage } from '../utils/chatMessageNormalizer';
import type { Course, Topic, UserProfile } from '../types';

export interface CourseChatTutorMessage {
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

export interface CourseChatTutorProps {
  course: Course;
  topic: Topic;
  userProfile: UserProfile;
  onBack: () => void;
  onOpenVoiceTutorial: () => void;
  setCustomHeaderConfig?: (config: any) => void;
}

const MAX_CHAT_IMAGES = 6;

export const CourseChatTutor: React.FC<CourseChatTutorProps> = ({
  course,
  topic,
  userProfile,
  onBack,
  onOpenVoiceTutorial,
  setCustomHeaderConfig,
}) => {
  const { settings: appSettings } = useAppSettings();
  const { addToast } = useToast();
  const { attemptApiCall } = useApiLimiter();

  const cacheKey = `avelut_course_chat_${userProfile?.uid || 'anon'}_${course.course_id}_${topic.topic_id}`;

  const [messages, setMessages] = useState<CourseChatTutorMessage[]>(() => {
    return readCachedJson<CourseChatTutorMessage[]>(cacheKey, []);
  });

  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [showLimitBanner, setShowLimitBanner] = useState(false);
  const [limitCost, setLimitCost] = useState(1);
  const [topicStructure, setTopicStructure] = useState<TopicStructureData | null>(null);
  const [selectedMode, setSelectedMode] = useState<ChatMode>('deep');
  const [voiceStatus, setVoiceStatus] = useState<'idle' | 'listening' | 'processing'>('idle');
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [likedMessages, setLikedMessages] = useState<Record<string, 'up' | 'down'>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any>(null);

  // Check live tutorial access
  const liveAccess = hasLiveTutorialAccess(userProfile);

  const handleTriggerLiveTutorial = useCallback(() => {
    if (!liveAccess.allowed) {
      setLimitCost(450);
      setShowLimitModal(true);
      return;
    }

    const syllabusRoadmap = topicStructure?.steps && topicStructure.steps.length > 0
      ? topicStructure.steps.map((s, idx) => `Step ${idx + 1}: ${s.title} (${s.objective})`).join('\n')
      : (topic.topic_context || `Course: ${course.course_name}`);

    writeCachedJson('avelut_active_voice_tutorial', {
      course,
      topic,
      syllabusContext: syllabusRoadmap,
    });

    onOpenVoiceTutorial();
  }, [liveAccess.allowed, onOpenVoiceTutorial, course, topic, topicStructure]);

  // Load topic structure
  useEffect(() => {
    let isMounted = true;
    getOrGenerateTopicStructure({
      topicKey: topic.topic_id || topic.topic_name,
      topicTitle: topic.topic_name,
      courseTitle: course.course_name,
      context: topic.topic_context || topic.start_point,
      userProfile,
      appSettings,
    }).then((struct) => {
      if (isMounted && struct) {
        setTopicStructure(struct);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [topic.topic_id, topic.topic_name, topic.topic_context, topic.start_point, course.course_name, userProfile, appSettings]);

  // Configure Custom Header for Study Guide Chat
  useEffect(() => {
    if (setCustomHeaderConfig) {
      setCustomHeaderConfig({
        hideBottomNav: true,
        hideTitle: true,
        hideDefaultRightActions: true,
        leftActions: (
          <div className="flex items-center gap-2.5 min-w-0 max-w-[calc(100vw-130px)] sm:max-w-none">
            <button
              onClick={onBack}
              className="w-10 h-10 rounded-full bg-white dark:bg-[#1A1A1A] hover:bg-neutral-100 dark:hover:bg-[#252528] border border-neutral-200 dark:border-neutral-800 flex items-center justify-center text-neutral-800 dark:text-white transition-all cursor-pointer shrink-0 shadow-2xs active:scale-95"
              aria-label="Back"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[14px] sm:text-[15px] font-semibold text-neutral-900 dark:text-white truncate">
                  {topic.topic_name}
                </span>
                <span className="px-1.5 py-0.2 rounded-md bg-neutral-100 dark:bg-neutral-800 text-[10px] font-semibold tracking-wider text-neutral-600 dark:text-neutral-400 uppercase shrink-0">
                  Study Guide
                </span>
              </div>
              <span className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
                {course.course_code || course.course_name}
              </span>
            </div>
          </div>
        ),
        rightActions: (
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleTriggerLiveTutorial}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all shadow-xs cursor-pointer active:scale-95 border ${
                liveAccess.allowed
                  ? 'bg-neutral-900 dark:bg-white text-white dark:text-neutral-950 border-neutral-900 dark:border-white'
                  : 'bg-white dark:bg-[#1A1A1A] text-neutral-800 dark:text-neutral-200 border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-[#222]'
              }`}
              title="Launch Live Voice Tutor"
            >
              <svg className="w-3.5 h-3.5 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.757 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
              <span>Live Voice</span>
            </button>
          </div>
        ),
        className: 'bg-white/95 dark:bg-black/95 border-b border-neutral-200/80 dark:border-neutral-800/80 backdrop-blur-md',
      });
    }
    return () => {
      if (setCustomHeaderConfig) {
        setCustomHeaderConfig(null);
      }
    };
  }, [setCustomHeaderConfig, onBack, handleTriggerLiveTutorial, course, topic, liveAccess.allowed]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => scrollToBottom('instant'), 50);
    return () => clearTimeout(timer);
  }, [scrollToBottom]);

  useEffect(() => {
    scrollToBottom('smooth');
  }, [messages.length, scrollToBottom]);

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

  // Voice dictation toggle
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

  // System prompt that forces generating a structured Study Plan first before teaching in bytes
  const buildSocraticSystemPrompt = useCallback(() => {
    return [
      `You are AVELUT Socratic Course Tutor for "${course.course_name}" (${course.course_code || ''}).`,
      `TOPIC: "${topic.topic_name}"`,
      topic.topic_context ? `CURRICULUM CONTEXT: ${topic.topic_context}` : '',
      '',
      'CRITICAL TEACHING WORKFLOW (Strictly Follow):',
      '1. FIRST, CREATE AND PRESENT A STRUCTURED STUDY PLAN:',
      '   Whenever starting a new topic session or when no study plan has been shown yet, you MUST begin your message with the Master Study Plan outlining the progressive bytes required to master this topic:',
      '   ### 📋 Master Study Plan: ' + topic.topic_name,
      '   1. **Byte 1: Foundational Intuition & Core Concept** — Everyday real-world Nigerian analogy and big-picture explanation.',
      '   2. **Byte 2: Underlying Mechanics & Principles** — How the concepts work systematically behind the scenes.',
      '   3. **Byte 3: Formulas, Math & Theoretical Rules** — Key equations with LaTeX notation and breakdown of variables.',
      '   4. **Byte 4: Step-by-Step Worked Problems & Code** — Practical calculation examples and methods.',
      '   5. **Byte 5: Tricky Exam Traps & Misconceptions** — What examiners look for and pitfalls to avoid.',
      '   6. **Byte 6: Final Synthesis & Knowledge Check** — Rapid recall questions and mastery check.',
      '',
      '2. IMMEDIATELY TEACH BYTE 1:',
      '   Right below the study plan, begin Byte 1 immediately:',
      '   ### Byte 1: The Intuition & Big Picture',
      '   - Explain the concept with a vivid, relatable everyday Nigerian analogy (e.g. POS service charges, NEPA light vs generator, traffic at Ojuelegba, bargaining at the market).',
      '   - Keep this opening byte bite-sized (90-130 words). Never dump giant multi-paragraph lectures.',
      '   - Conclude with ONE simple, engaging check question to test the student\'s understanding before Byte 2.',
      '   - Always append 2 interactive follow-up suggestions starting with ↳ written strictly from the student\'s first-person perspective (e.g. "↳ Ready for Byte 2: Mechanics", "↳ Give me another everyday example", "↳ Quiz me on this byte"). Never phrase as "Would you like..." or "Do you want...".',
      '',
      '3. SUBSEQUENT BYTE PROGRESSION:',
      '   - Assess the student\'s answer warmly and accurately.',
      '   - If correct, praise briefly and smoothly proceed to deliver the NEXT BYTE from the study plan.',
      '   - If confused, break it down simply with clearer intuition before advancing.',
      '   - Keep every turn strictly bite-sized (90-130 words). Teach ONE concept at a time.',
      '   - End every turn with ONE check question and 2 follow-ups starting with ↳.',
      '',
      '4. TYPOGRAPHIC HIERARCHY:',
      '   - Use ### for Byte / Section headings.',
      '   - Use **bold** for essential definitions and key terms.',
      '   - Highlight critical takeaways with ==this== or <mark>this</mark>.',
      '   - Format all equations and symbols with LaTeX ($...$ inline or $$...$$ block).',
      '   - Use code fences with syntax highlighting for code.',
      '   - No robotic greetings or emojis.',
    ].filter(Boolean).join('\n');
  }, [course, topic]);

  // Auto-initiate study plan & Byte 1 if chat is empty
  useEffect(() => {
    if (messages.length === 0 && !isSending) {
      void initFirstBiteSizedStep();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicStructure]);

  const initFirstBiteSizedStep = async () => {
    const ai = createAvelutAI(appSettings, userProfile, {
      endpointPreference: 'openai_compatible_first',
      feature: 'study_guide_chat',
    });
    if (!ai) return;

    setIsSending(true);
    const starterAiMsgId = `msg_ai_${Date.now()}`;
    const initialPlaceholder: CourseChatTutorMessage = {
      id: starterAiMsgId,
      sender: 'assistant',
      text: '',
      timestamp: Date.now(),
    };
    setMessages([initialPlaceholder]);

    const socraticPrompt = buildSocraticSystemPrompt();
    const chatModel = getFeatureModel('chat_interaction', appSettings) || 'qwen3.5-omni-flash';

    const aiParams = {
      model: chatModel,
      contents: [
        {
          role: 'user',
          parts: [{ text: `Hello! Please create our study plan for "${topic.topic_name}" and start teaching me byte by byte.` }],
        },
      ],
      config: {
        systemInstruction: socraticPrompt,
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
      console.warn('[CourseChatTutor] Starter stream error, falling back:', err);
      const fallbackResult = await attemptApiCall(async () => {
        const res = await ai.models.generateContent(aiParams);
        return getResponseText(res);
      });
      if (fallbackResult.success && fallbackResult.data) {
        streamedText = fallbackResult.data.trim();
      }
    }

    if (!streamedText.trim()) {
      streamedText = `### 📋 Master Study Plan: ${topic.topic_name}\n1. **Byte 1: Intuition & Big Picture**\n2. **Byte 2: Underlying Mechanics**\n3. **Byte 3: Formulas & Mathematics**\n4. **Byte 4: Practical Examples**\n5. **Byte 5: Exam Traps**\n\n---\n\n### Byte 1: The Intuition & Big Picture\nWelcome to **${topic.topic_name}**! Let's break this down step-by-step so you master every essential concept. Are you ready to dive into the core intuition?\n\n↳ Yes, let's begin Byte 1\n↳ Can you summarize the goals?`;
    }

    setMessages((prev) => {
      const updated = prev.map((m) => (m.id === starterAiMsgId ? { ...m, text: streamedText } : m));
      writeCachedJson(cacheKey, updated, userProfile?.uid);
      return updated;
    });
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

    const userMessage: CourseChatTutorMessage = {
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

    const aiPlaceholderMsg: CourseChatTutorMessage = {
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

    const socraticPrompt = buildSocraticSystemPrompt();
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
      latestUserParts.push({ text: '(Student provided image for tutorial review)' });
    }

    historyContents.push({
      role: 'user',
      parts: latestUserParts,
    });

    const aiParams = {
      model: chatModel,
      contents: historyContents,
      config: {
        systemInstruction: socraticPrompt,
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
        console.warn('[CourseChatTutor] Stream error, trying fallback:', err);
        const fallbackRes = await attemptApiCall(async () => {
          const res = await ai.models.generateContent(aiParams);
          return getResponseText(res);
        });
        if (fallbackRes.success && fallbackRes.data) {
          streamedText = fallbackRes.data.trim();
        }
      }
    }

    if (!streamedText.trim() && !abortController.signal.aborted) {
      streamedText = 'I encountered a brief network delay. Could you please rephrase or continue with our study plan?';
    }

    const finalMessages = nextMessages.map((m) =>
      m.id === aiMsgId ? { ...m, text: streamedText, reasoningText: streamedReasoning } : m
    );

    setMessages(finalMessages);
    writeCachedJson(cacheKey, finalMessages, userProfile?.uid);

    if (userProfile?.uid && !abortController.signal.aborted) {
      void deductAICredits(userProfile.uid, cost, 'Study Guide Chat Tutor', appSettings, {
        promptTokens: usageAcc.promptTokens,
        completionTokens: usageAcc.completionTokens,
        totalTokens: usageAcc.totalTokens,
        model: chatModel,
        metadata: { path: 'study_guide_chat', course_id: course.course_id, topic_id: topic.topic_id },
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
          title: `${topic.topic_name} - Avelut Study Guide`,
          text: text,
          dialogTitle: 'Share tutorial byte',
        });
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({
          title: `${topic.topic_name} - Avelut Study Guide`,
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
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsSending(false);

    let userPromptText = '';
    let userMsgIdx = -1;
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].sender === 'user') {
        userPromptText = messages[i].text;
        userMsgIdx = i;
        break;
      }
    }

    if (userMsgIdx === -1) return;

    // Truncate messages up to userMsgIdx so target AI message is removed
    const truncated = messages.slice(0, userMsgIdx + 1);
    setMessages(truncated);
    writeCachedJson(cacheKey, truncated, userProfile?.uid);

    void handleSendMessage(userPromptText);
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
                          label="structuring byte..."
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

                                <button
                                  type="button"
                                  onClick={() => handleRegenerateMessage(index)}
                                  className="p-1 rounded-md text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white transition-colors cursor-pointer"
                                  title="Regenerate response"
                                  aria-label="Regenerate response"
                                >
                                  <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                  </svg>
                                </button>
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
            subtitle="Upgrade to Pro for higher limits and unlimited study guide tutoring."
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

export default CourseChatTutor;
