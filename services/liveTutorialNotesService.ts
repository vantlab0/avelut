/**
 * services/liveTutorialNotesService.ts
 *
 * Automatically saves live classroom whiteboard drawings, formulas, and
 * teacher speech transcript into a structured Notebook inside "My Notebooks".
 */

import { saveNotebook, type Notebook } from './notebookStorageService';
import type { UserProfile } from '../types';

export interface SaveLiveSessionNotebookParams {
  userProfile?: UserProfile | null;
  topicTitle: string;
  courseName?: string;
  durationMinutes: number;
  elements: any[];
  activeFormula?: string | null;
  fullTranscript?: string;
  learningPath?: string[];
}

/**
 * Extracts and cleans text, labels, and mathematical formulas from Excalidraw board elements.
 */
export function extractNotesFromBoardElements(elements: any[]): {
  textNotes: string[];
  formulas: string[];
  diagramLabels: string[];
} {
  const textNotes: string[] = [];
  const formulas: string[] = [];
  const diagramLabels: string[] = [];
  const seen = new Set<string>();

  for (const el of elements || []) {
    // 1. Text elements
    if (el.type === 'text' && typeof el.text === 'string') {
      const cleanText = el.text.trim();
      if (cleanText && !seen.has(cleanText)) {
        seen.add(cleanText);
        // Detect formulas
        if (/=|\+|-|\*|\/|√|λ|π|Ω|Δ|θ|∫|∑|\^/.test(cleanText) && cleanText.length < 120) {
          formulas.push(cleanText);
        } else {
          textNotes.push(cleanText);
        }
      }
    }

    // 2. Shape / diagram labels
    const labelText = typeof el.label === 'string' ? el.label : el.label?.text;
    if (typeof labelText === 'string') {
      const cleanLabel = labelText.trim();
      if (cleanLabel && !seen.has(cleanLabel)) {
        seen.add(cleanLabel);
        diagramLabels.push(cleanLabel);
      }
    }
  }

  return { textNotes, formulas, diagramLabels };
}

/**
 * Generates and saves a full Notebook from a completed live tutorial session.
 */
export async function autoSaveLiveTutorialSessionAsNotebook(
  params: SaveLiveSessionNotebookParams
): Promise<Notebook | null> {
  const {
    userProfile,
    topicTitle,
    courseName = 'Live Academic Tutorial',
    durationMinutes = 15,
    elements = [],
    activeFormula,
    fullTranscript = '',
    learningPath = [],
  } = params;

  if (!userProfile?.uid) {
    console.warn('[LiveTutorialNotes] No userProfile.uid available; skipping auto-save.');
    return null;
  }

  try {
    const { textNotes, formulas, diagramLabels } = extractNotesFromBoardElements(elements);

    // If activeFormula exists and not already captured, add it
    if (activeFormula && !formulas.includes(activeFormula)) {
      formulas.unshift(activeFormula);
    }

    // Build Chapter 1: Whiteboard & Visual Notes
    const whiteboardContent = [
      `# ${topicTitle} — Live Whiteboard Notes`,
      `**Course**: ${courseName} | **Session Duration**: ${durationMinutes} Minutes`,
      `**Date**: ${new Date().toLocaleDateString(undefined, { dateStyle: 'full' })}`,
      '',
      '## Key Visual Points & Concept Notes',
      textNotes.length > 0
        ? textNotes.map((note) => `• ${note}`).join('\n\n')
        : '• Interactive conceptual breakdown covered on the live board.',
      '',
      diagramLabels.length > 0
        ? `## Visual Diagrams & Illustrated Components\n${diagramLabels.map((lbl) => `• [Diagram Component] ${lbl}`).join('\n')}\n`
        : '',
    ].filter(Boolean).join('\n');

    // Build Chapter 2: Key Formulas & Derivations
    const formulasContent = [
      `# Formulas & Derivations for ${topicTitle}`,
      '',
      formulas.length > 0
        ? formulas.map((f, i) => `### Equation ${i + 1}\n\`\`\`text\n${f}\n\`\`\``).join('\n\n')
        : 'No specific formulas were rendered on the board during this session.',
      '',
      '### Application Summary',
      `These expressions govern the foundational mechanics of **${topicTitle}**. Review each variable definition and dimensional units prior to problem solving.`,
    ].join('\n');

    // Build Chapter 3: Lecture Transcript & Explanations
    const transcriptContent = [
      `# AI Teacher Lecture Transcript`,
      '',
      fullTranscript.trim()
        ? fullTranscript.trim()
        : `The AI teacher provided interactive real-time explanations, guiding through ${learningPath.length > 0 ? learningPath.join(' → ') : topicTitle} on the interactive whiteboard canvas.`,
    ].join('\n');

    // Build Chapter 4: Key Takeaways & Exam Checklist
    const takeawaysContent = [
      `# Exam Review & Key Takeaways: ${topicTitle}`,
      '',
      '## Syllabus Learning Path Covered',
      learningPath.length > 0
        ? learningPath.map((step, idx) => `${idx + 1}. **${step}**`).join('\n')
        : `1. Core principles of ${topicTitle}\n2. Practical examples and whiteboard illustrations\n3. Real-time Q&A verification`,
      '',
      '## Self-Check Questions for Practice',
      `1. Explain the fundamental definition of ${topicTitle} in your own words.`,
      `2. How do the primary principles and formulas apply to real-world exam questions?`,
      `3. Identify common student pitfalls or tricky scenarios when solving problems in this topic.`,
    ].join('\n');

    // Package chapters
    const chapters = [
      {
        id: `ch_wb_${Date.now()}`,
        title: 'Whiteboard & Visual Notes',
        startPage: 1,
        endPage: 1,
        content: whiteboardContent,
        wordCount: whiteboardContent.split(/\s+/).length,
      },
      {
        id: `ch_form_${Date.now()}`,
        title: 'Formulas & Derivations',
        startPage: 2,
        endPage: 2,
        content: formulasContent,
        wordCount: formulasContent.split(/\s+/).length,
      },
      {
        id: `ch_trans_${Date.now()}`,
        title: 'Lecture Explanation',
        startPage: 3,
        endPage: 3,
        content: transcriptContent,
        wordCount: transcriptContent.split(/\s+/).length,
      },
      {
        id: `ch_rev_${Date.now()}`,
        title: 'Exam Review Checklist',
        startPage: 4,
        endPage: 4,
        content: takeawaysContent,
        wordCount: takeawaysContent.split(/\s+/).length,
      },
    ];

    const pages = [
      { pageNumber: 1, text: whiteboardContent, wordCount: whiteboardContent.split(/\s+/).length },
      { pageNumber: 2, text: formulasContent, wordCount: formulasContent.split(/\s+/).length },
      { pageNumber: 3, text: transcriptContent, wordCount: transcriptContent.split(/\s+/).length },
      { pageNumber: 4, text: takeawaysContent, wordCount: takeawaysContent.split(/\s+/).length },
    ];

    const totalWordCount = pages.reduce((acc, p) => acc + p.wordCount, 0);

    const notebookTitle = `Live Tutorial: ${topicTitle}`;
    const fileName = `${topicTitle.replace(/[^a-zA-Z0-9_-]/g, '_')}_Live_Session.pdf`;

    const savedNotebook = await saveNotebook(userProfile.uid, {
      title: notebookTitle,
      fileName,
      fileSize: totalWordCount * 7,
      totalPages: 4,
      chapters,
      pages,
    });

    console.log('[LiveTutorialNotes] Successfully auto-saved session notebook:', savedNotebook.id);
    return savedNotebook;
  } catch (err) {
    console.error('[LiveTutorialNotes] Failed to auto-save session notebook:', err);
    return null;
  }
}
