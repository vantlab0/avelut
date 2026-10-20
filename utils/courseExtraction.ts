/**
 * Course/topic extraction helpers for the admin Upload Center.
 *
 * Model output is untrusted: every field is validated before it can reach the
 * course database. Parsing failures are surfaced with actionable codes instead
 * of an opaque "Extraction failed" toast.
 */

import { cleanAndParseJson } from './jsonUtils';
import type { Topic } from '../types';

export const MAX_EXTRACTION_PDF_BYTES = 50 * 1024 * 1024;
export const MAX_EXTRACTION_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_SYLLABUS_TOPICS = 200;
export const MAX_PAST_QUESTIONS = 300;
export const MAX_COURSE_ROWS = 200;
export const MAX_PROMPT_TEXT_CHARS = 90_000;
export const MIN_USABLE_PDF_TEXT_CHARS = 120;

export const VALID_COURSE_LEVELS = ['100lvl', '200lvl', '300lvl', '400lvl', '500lvl'] as const;
export type ValidCourseLevel = (typeof VALID_COURSE_LEVELS)[number];

export type ExtractionErrorCode =
  | 'UNSUPPORTED_FILE'
  | 'FILE_TOO_LARGE'
  | 'EMPTY_FILE'
  | 'FILE_READ_FAILED'
  | 'EMPTY_DOCUMENT'
  | 'INVALID_RESPONSE'
  | 'UNRELATED_DOCUMENT'
  | 'NO_TOPICS'
  | 'NO_QUESTIONS'
  | 'NO_COURSES'
  | 'MISSING_METADATA'
  | 'UNSUPPORTED_MODEL'
  | 'SAVE_FAILED';

export class CourseExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  readonly retryable: boolean;

  constructor(code: ExtractionErrorCode, message: string, retryable = false) {
    super(message);
    this.name = 'CourseExtractionError';
    this.code = code;
    this.retryable = retryable;
  }
}

export interface ExtractionFileInfo {
  kind: 'pdf' | 'image';
  mimeType: string;
}

const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|bmp|gif|heic|heif|svg|tiff?)$/i;
const SUPPORTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/bmp', 'image/gif'] as const;

/** Validate a file selected for course-form extraction (PDF or image). */
export function inspectExtractionFile(file: File): ExtractionFileInfo {
  if (!file || !file.size) {
    throw new CourseExtractionError('EMPTY_FILE', 'That file is empty. Choose another document.');
  }

  const name = file.name || 'document';
  const isPdf = file.type === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
  const looksLikeImage = file.type.startsWith('image/') || IMAGE_EXTENSIONS.test(name);

  if (isPdf) {
    if (file.size > MAX_EXTRACTION_PDF_BYTES) {
      throw new CourseExtractionError('FILE_TOO_LARGE', 'PDF is too large. The maximum size is 50 MB.');
    }
    return { kind: 'pdf', mimeType: 'application/pdf' };
  }

  if (looksLikeImage) {
    if (file.size > MAX_EXTRACTION_IMAGE_BYTES) {
      throw new CourseExtractionError('FILE_TOO_LARGE', 'Image is too large. The maximum size is 12 MB.');
    }
    const declared = (file.type || '').toLowerCase();
    const mimeType = declared.startsWith('image/')
      ? declared
      : /\.png$/i.test(name)
        ? 'image/png'
        : /\.webp$/i.test(name)
          ? 'image/webp'
          : /\.bmp$/i.test(name)
            ? 'image/bmp'
            : /\.gif$/i.test(name)
              ? 'image/gif'
              : '';

    if (mimeType === 'image/heic' || mimeType === 'image/heif' || /\.(heic|heif)$/i.test(name)) {
      throw new CourseExtractionError(
        'UNSUPPORTED_FILE',
        'HEIC/HEIF photos are not supported by the AI reader. Export the photo as JPG or PNG and try again.'
      );
    }
    if (!mimeType || !(SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) {
      throw new CourseExtractionError(
        'UNSUPPORTED_FILE',
        'Unsupported image format. Use a JPG, PNG, WebP, BMP, or GIF image.'
      );
    }
    return { kind: 'image', mimeType };
  }

  throw new CourseExtractionError('UNSUPPORTED_FILE', 'Choose a PDF or a JPG/PNG/WebP image of the course form.');
}

/** Validate a textbook / past-question PDF before any upload happens. */
export function inspectPdfFile(file: File): void {
  if (!file || !file.size) {
    throw new CourseExtractionError('EMPTY_FILE', 'That file is empty. Choose another PDF.');
  }
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) {
    throw new CourseExtractionError('UNSUPPORTED_FILE', 'Only PDF files can be uploaded here.');
  }
  if (file.size > MAX_EXTRACTION_PDF_BYTES) {
    throw new CourseExtractionError('FILE_TOO_LARGE', 'PDF is too large. The maximum size is 50 MB.');
  }
}

/** Check metadata required by the actual course database path/schema. */
export function validateCourseUploadMetadata(params: {
  course: { course_id?: string; course_name?: string; level?: string; semester?: string } | null | undefined;
  deptPath: string;
  courseKey: string;
  fallbackSemester?: string;
  year?: string;
}): string[] {
  const errors: string[] = [];
  const { course, deptPath, courseKey } = params;

  if (!deptPath || !deptPath.includes('/colleges/') || !deptPath.includes('/departments/')) {
    errors.push('Select a school, college, and department before uploading.');
  }
  if (!courseKey.trim()) {
    errors.push('The course key is missing. Reload the catalog and try again.');
  }
  if (!course?.course_id?.trim()) {
    errors.push('The course ID is missing.');
  }
  if (!course?.course_name?.trim()) {
    errors.push('The course name is missing.');
  }

  const level = (course?.level || '').toString().trim().toLowerCase();
  if (!level) {
    errors.push('The course level is missing.');
  } else if (!(VALID_COURSE_LEVELS as readonly string[]).includes(level)) {
    errors.push(`Unsupported course level "${course?.level}". Expected one of ${VALID_COURSE_LEVELS.join(', ')}.`);
  }

  const semester = (course?.semester || params.fallbackSemester || '').toString().trim().toLowerCase();
  if (!semester) {
    errors.push('The course semester is missing.');
  } else if (semester !== 'first' && semester !== 'second') {
    errors.push('The course semester must be "first" or "second".');
  }

  if (params.year !== undefined && !/^\d{4}$/.test(params.year.trim())) {
    errors.push('Enter a valid four-digit exam year.');
  }

  return errors;
}

/** Reject PDF text that is mostly binary noise from a failed extraction. */
export function isUsablePdfText(text: string): boolean {
  const trimmed = (text || '').trim();
  if (trimmed.length < MIN_USABLE_PDF_TEXT_CHARS) return false;
  const printable = trimmed.replace(/[^\x20-\x7E\n\r\t]/g, '');
  const letters = printable.replace(/[^A-Za-z0-9]/g, '');
  return letters.length >= MIN_USABLE_PDF_TEXT_CHARS && printable.length / trimmed.length >= 0.75;
}

/** Truncate prompt text with a diagnostic marker so the model knows it is partial. */
export function capPromptText(text: string, maxChars: number = MAX_PROMPT_TEXT_CHARS): { text: string; truncated: boolean } {
  const normalized = (text || '').replace(/\u0000/g, '').trim();
  if (normalized.length <= maxChars) return { text: normalized, truncated: false };
  return {
    text: `${normalized.slice(0, maxChars)}\n\n[Document truncated after ${maxChars} characters due to size limits.]`,
    truncated: true,
  };
}

function toCleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueTopicId(base: string, used: Set<string>): string {
  let candidate = base;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function normalizeTopicId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export interface SyllabusExtraction {
  topics: Topic[];
  unrelatedReason?: string;
}

/**
 * Parse and validate the model's syllabus JSON.
 *
 * Empty topic names are dropped rather than replaced with fabricated
 * "Topic N" entries. Duplicate ids are made unique and the list is capped.
 */
export function parseSyllabusResponse(rawText: string): SyllabusExtraction {
  if (!rawText || !rawText.trim()) {
    throw new CourseExtractionError('INVALID_RESPONSE', 'The model returned an empty response.', true);
  }

  let data: unknown;
  try {
    data = cleanAndParseJson<unknown>(rawText);
  } catch (error) {
    throw new CourseExtractionError(
      'INVALID_RESPONSE',
      `The model returned malformed JSON: ${(error as Error).message}`,
      true
    );
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new CourseExtractionError('INVALID_RESPONSE', 'The model response was not a JSON object.', true);
  }

  const record = data as Record<string, unknown>;
  if (record.is_related === false) {
    const reason = toCleanString(record.unrelated_reason);
    throw new CourseExtractionError(
      'UNRELATED_DOCUMENT',
      `Upload rejected: ${reason || 'the document is not related to this course.'}`
    );
  }

  const rawTopics = Array.isArray(record.syllabus)
    ? record.syllabus
    : Array.isArray(record.topics)
      ? record.topics
      : null;

  if (!rawTopics) {
    throw new CourseExtractionError('INVALID_RESPONSE', 'The model response did not contain a syllabus array.', true);
  }

  const topics: Topic[] = [];
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();

  for (const rawTopic of rawTopics.slice(0, MAX_SYLLABUS_TOPICS)) {
    if (!rawTopic || typeof rawTopic !== 'object') continue;
    const topic = rawTopic as Record<string, unknown>;
    const name = toCleanString(topic.topic_name || topic.name);
    if (!name) continue; // Never fabricate a topic name.
    const nameKey = name.toLowerCase();
    if (usedNames.has(nameKey)) continue;

    const rawId = toCleanString(topic.topic_id);
    const baseId = normalizeTopicId(rawId || name) || `topic_${topics.length + 1}`;
    usedNames.add(nameKey);
    topics.push({
      topic_name: name.slice(0, 200),
      topic_id: uniqueTopicId(baseId, usedIds),
      topic_context: toCleanString(topic.topic_context || topic.context).slice(0, 2000),
      start_point: toCleanString(topic.start_point || topic.start).slice(0, 200),
      end_point: toCleanString(topic.end_point || topic.end).slice(0, 200),
      is_complete: Boolean(topic.is_complete),
    });
  }

  if (!topics.length) {
    throw new CourseExtractionError(
      'NO_TOPICS',
      'No valid topics were found in this document. Check that it contains readable syllabus content.',
      true
    );
  }

  return { topics };
}

export interface ExtractedQuestion {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
}

export function parsePastQuestionsResponse(rawText: string): ExtractedQuestion[] {
  if (!rawText || !rawText.trim()) {
    throw new CourseExtractionError('INVALID_RESPONSE', 'The model returned an empty response.', true);
  }

  let data: unknown;
  try {
    data = cleanAndParseJson<unknown>(rawText);
  } catch (error) {
    throw new CourseExtractionError(
      'INVALID_RESPONSE',
      `The model returned malformed JSON: ${(error as Error).message}`,
      true
    );
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new CourseExtractionError('INVALID_RESPONSE', 'The model response was not a JSON object.', true);
  }

  const record = data as Record<string, unknown>;
  if (record.is_related === false) {
    const reason = toCleanString(record.unrelated_reason);
    throw new CourseExtractionError(
      'UNRELATED_DOCUMENT',
      `Upload rejected: ${reason || 'the document is not related to this course.'}`
    );
  }

  if (!Array.isArray(record.questions)) {
    throw new CourseExtractionError('INVALID_RESPONSE', 'The model response did not contain a questions array.', true);
  }

  const questions: ExtractedQuestion[] = [];
  const used = new Set<string>();
  for (const rawQuestion of record.questions.slice(0, MAX_PAST_QUESTIONS)) {
    if (!rawQuestion || typeof rawQuestion !== 'object') continue;
    const item = rawQuestion as Record<string, unknown>;
    const question = toCleanString(item.question);
    if (!question) continue;
    const key = question.toLowerCase();
    if (used.has(key)) continue;
    used.add(key);
    const options = Array.isArray(item.options)
      ? item.options.map(toCleanString).filter(Boolean).slice(0, 10)
      : [];
    questions.push({
      question,
      options,
      correctAnswer: toCleanString(item.correctAnswer),
      explanation: toCleanString(item.explanation),
    });
  }

  if (!questions.length) {
    throw new CourseExtractionError('NO_QUESTIONS', 'No valid questions were found in this PDF.', true);
  }

  return questions;
}

export interface ExtractedCourse {
  course_name: string;
  course_code: string;
  selected: boolean;
  type: 'private' | 'general';
  level?: string;
  semester?: 'first' | 'second';
}

/** Validate course rows extracted from a registration slip / timetable image. */
export function parseCoursesResponse(rawText: string): ExtractedCourse[] {
  if (!rawText || !rawText.trim()) {
    throw new CourseExtractionError('INVALID_RESPONSE', 'The model returned an empty response.', true);
  }

  let data: unknown;
  try {
    data = cleanAndParseJson<unknown>(rawText);
  } catch (error) {
    throw new CourseExtractionError(
      'INVALID_RESPONSE',
      `The model returned malformed JSON: ${(error as Error).message}`,
      true
    );
  }

  const record = data as { courses?: unknown } | null;
  if (!record || !Array.isArray(record.courses)) {
    throw new CourseExtractionError('INVALID_RESPONSE', 'The model response did not contain a courses array.', true);
  }

  const courses: ExtractedCourse[] = [];
  const usedCodes = new Set<string>();
  for (const rawCourse of record.courses.slice(0, MAX_COURSE_ROWS)) {
    if (!rawCourse || typeof rawCourse !== 'object') continue;
    const item = rawCourse as Record<string, unknown>;
    const name = toCleanString(item.course_name || item.name);
    const code = toCleanString(item.course_code || item.code).toUpperCase();
    if (!name || !code) continue;
    const key = code.replace(/\s+/g, '');
    if (!key || usedCodes.has(key)) continue;
    usedCodes.add(key);

    const levelValue = toCleanString(item.level).toLowerCase().replace(/\s+/g, '');
    const levelMatch = levelValue.match(/\d{3}/);
    const level = levelMatch && (VALID_COURSE_LEVELS as readonly string[]).includes(`${levelMatch[0]}lvl`)
      ? `${levelMatch[0]}lvl`
      : undefined;

    const semesterValue = toCleanString(item.semester).toLowerCase();
    const semester = semesterValue === '2'
      ? 'second'
      : semesterValue === '1'
        ? 'first'
        : /second|2nd|rain|omega|spring/.test(semesterValue)
          ? 'second'
          : /first|1st|harmattan/.test(semesterValue)
            ? 'first'
            : undefined;

    courses.push({
      course_name: name,
      course_code: code,
      selected: true,
      type: 'private',
      level,
      semester,
    });
  }

  if (!courses.length) {
    throw new CourseExtractionError(
      'NO_COURSES',
      'No valid courses could be identified. Make sure the document has clear course titles and codes.',
      true
    );
  }

  return courses;
}
