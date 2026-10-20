import { describe, expect, it } from 'vitest';
import {
  CourseExtractionError,
  MAX_EXTRACTION_PDF_BYTES,
  capPromptText,
  inspectExtractionFile,
  inspectPdfFile,
  isUsablePdfText,
  parseCoursesResponse,
  parsePastQuestionsResponse,
  parseSyllabusResponse,
  validateCourseUploadMetadata,
} from '../utils/courseExtraction';

const fileWithSize = (name: string, type: string, size = 1024) => {
  const file = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

const expectCode = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CourseExtractionError);
    expect((error as CourseExtractionError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code} to be thrown.`);
};

describe('file validation', () => {
  it('accepts PDFs and supported images', () => {
    expect(inspectExtractionFile(fileWithSize('form.pdf', 'application/pdf')).kind).toBe('pdf');
    expect(inspectExtractionFile(fileWithSize('form.png', 'image/png'))).toEqual({
      kind: 'image',
      mimeType: 'image/png',
    });
    expect(inspectExtractionFile(fileWithSize('form.webp', '')).mimeType).toBe('image/webp');
  });

  it('rejects empty files, unsupported formats, and oversized uploads', () => {
    expectCode(() => inspectExtractionFile(fileWithSize('empty.pdf', 'application/pdf', 0)), 'EMPTY_FILE');
    expectCode(() => inspectExtractionFile(fileWithSize('vector.svg', 'image/svg+xml')), 'UNSUPPORTED_FILE');
    expectCode(() => inspectExtractionFile(fileWithSize('photo.heic', 'image/heic')), 'UNSUPPORTED_FILE');
    expectCode(
      () => inspectExtractionFile(fileWithSize('huge.pdf', 'application/pdf', MAX_EXTRACTION_PDF_BYTES + 1)),
      'FILE_TOO_LARGE'
    );
  });

  it('only allows PDFs for textbook extraction', () => {
    expectCode(() => inspectPdfFile(fileWithSize('notes.docx', 'application/msword')), 'UNSUPPORTED_FILE');
    expect(() => inspectPdfFile(fileWithSize('book.pdf', 'application/pdf'))).not.toThrow();
  });
});

describe('validateCourseUploadMetadata', () => {
  const deptPath = 'school/colleges/college/departments/dept';

  it('accepts a complete course record', () => {
    expect(
      validateCourseUploadMetadata({
        course: { course_id: 'CSC201', course_name: 'Computer Science', level: '200lvl' },
        deptPath,
        courseKey: 'csc201',
        fallbackSemester: 'second',
        year: '2024',
      })
    ).toEqual([]);
  });

  it('reports each missing or invalid field', () => {
    const errors = validateCourseUploadMetadata({
      course: { course_id: '', course_name: '', level: '3000lvl' },
      deptPath: '',
      courseKey: '',
      fallbackSemester: '',
    });
    expect(errors.some((error) => /department/i.test(error))).toBe(true);
    expect(errors.some((error) => /course ID/i.test(error))).toBe(true);
    expect(errors.some((error) => /course name/i.test(error))).toBe(true);
    expect(errors.some((error) => /course level/i.test(error))).toBe(true);
    expect(errors.some((error) => /semester/i.test(error))).toBe(true);
  });

  it('rejects malformed semesters and exam years', () => {
    const errors = validateCourseUploadMetadata({
      course: {
        course_id: 'CSC201',
        course_name: 'Computer Science',
        level: '200lvl',
        semester: 'harmattan',
      },
      deptPath,
      courseKey: 'csc201',
      year: '24',
    });
    expect(errors.some((error) => /semester/i.test(error))).toBe(true);
    expect(errors.some((error) => /four-digit/i.test(error))).toBe(true);
  });
});

describe('parseSyllabusResponse', () => {
  it('parses fenced JSON, drops unnamed entries, and de-duplicates ids', () => {
    const raw = `Here is the syllabus:
\`\`\`json
{
  "is_related": true,
  "syllabus": [
    { "topic_name": "Introduction", "topic_id": "intro", "topic_context": "Basics" },
    { "topic_name": "", "topic_id": "empty" },
    { "topic_name": "Arrays", "topic_id": "intro_2" },
    { "topic_name": "arrays", "topic_id": "duplicate-name" },
    { "name": "Linked Lists", "topic_id": "intro" }
  ]
}
\`\`\``;

    const result = parseSyllabusResponse(raw);
    expect(result.topics.map((topic) => topic.topic_name)).toEqual([
      'Introduction',
      'Arrays',
      'Linked Lists',
    ]);
    expect(result.topics.map((topic) => topic.topic_id)).toEqual(['intro', 'intro_2', 'intro_3']);
    expect(result.topics[0].topic_context).toBe('Basics');
    expect(result.topics[2].is_complete).toBe(false);
  });

  it('rejects unrelated documents with the model-provided reason', () => {
    expect(() =>
      parseSyllabusResponse(
        JSON.stringify({ is_related: false, unrelated_reason: 'This is a cookbook.' })
      )
    ).toThrow(/cookbook/i);
  });

  it('fails when no valid topics remain', () => {
    expectCode(
      () => parseSyllabusResponse(JSON.stringify({ is_related: true, syllabus: [{ topic_name: '' }] })),
      'NO_TOPICS'
    );
  });

  it('fails cleanly on malformed or structurally invalid responses', () => {
    expectCode(() => parseSyllabusResponse('not json at all'), 'INVALID_RESPONSE');
    expectCode(() => parseSyllabusResponse(JSON.stringify([{ topic_name: 'x' }])), 'INVALID_RESPONSE');
    expectCode(() => parseSyllabusResponse(JSON.stringify({ is_related: true })), 'INVALID_RESPONSE');
    expectCode(() => parseSyllabusResponse(''), 'INVALID_RESPONSE');
  });
});

describe('parsePastQuestionsResponse', () => {
  it('validates questions, options, and de-duplicates repeated prompts', () => {
    const result = parsePastQuestionsResponse(
      JSON.stringify({
        is_related: true,
        questions: [
          {
            question: 'What is 2 + 2?',
            options: ['3', '4', '5'],
            correctAnswer: '4',
            explanation: 'Basic addition.',
          },
          { question: 'What is 2 + 2?', options: ['4'] },
          { question: '', options: ['ignored'] },
          { question: 'Define gravity.', options: [], correctAnswer: '', explanation: '' },
        ],
      })
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      question: 'What is 2 + 2?',
      options: ['3', '4', '5'],
      correctAnswer: '4',
    });
    expect(result[1].question).toBe('Define gravity.');
    expect(result[1].options).toEqual([]);
  });

  it('fails when the document is unrelated or has no valid questions', () => {
    expectCode(
      () =>
        parsePastQuestionsResponse(
          JSON.stringify({ is_related: false, unrelated_reason: 'Not a past paper.' })
        ),
      'UNRELATED_DOCUMENT'
    );
    expectCode(
      () => parsePastQuestionsResponse(JSON.stringify({ is_related: true, questions: [] })),
      'NO_QUESTIONS'
    );
    expectCode(() => parsePastQuestionsResponse('{bad json'), 'INVALID_RESPONSE');
  });
});

describe('parseCoursesResponse', () => {
  it('extracts course rows from fenced prose and de-duplicates codes', () => {
    const result = parseCoursesResponse(`Extracted:
\`\`\`json
{"courses":[
  {"course_name":"Data Structures","course_code":"csc 201","level":"200 Level","semester":"Second Semester"},
  {"course_name":"Duplicate","course_code":"CSC201"},
  {"course_name":"","course_code":"MTH101"},
  {"course_name":"Calculus","course_code":"mth101"}
]}
\`\`\``);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      course_name: 'Data Structures',
      course_code: 'CSC 201',
      level: '200lvl',
      semester: 'second',
      selected: true,
      type: 'private',
    });
    expect(result[1].course_code).toBe('MTH101');
  });

  it('fails when the response has no usable courses', () => {
    expectCode(
      () => parseCoursesResponse(JSON.stringify({ courses: [{ course_name: '', course_code: '' }] })),
      'NO_COURSES'
    );
    expectCode(() => parseCoursesResponse(JSON.stringify({ courses: [] })), 'NO_COURSES');
    expectCode(() => parseCoursesResponse(JSON.stringify({ items: [] })), 'INVALID_RESPONSE');
  });
});

describe('PDF text helpers', () => {
  it('accepts readable text and rejects binary noise', () => {
    expect(
      isUsablePdfText(
        'This is a course outline for Computer Science 201. Topics include arrays, linked lists, trees, and graph traversal algorithms. Students will also study sorting algorithms, hashing, dynamic programming, and complexity analysis. The course covers recursion, stacks, queues, heaps, and balanced search trees in detail.'
      )
    ).toBe(true);
    expect(isUsablePdfText('short')).toBe(false);
    expect(isUsablePdfText('\u0000\u0001\u0002'.repeat(200))).toBe(false);
  });

  it('truncates oversized prompt text with an explicit marker', () => {
    const longText = 'a'.repeat(500);
    const capped = capPromptText(longText, 100);
    expect(capped.truncated).toBe(true);
    expect(capped.text.startsWith('a'.repeat(100))).toBe(true);
    expect(capped.text).toContain('[Document truncated');

    const untouched = capPromptText('short text', 100);
    expect(untouched).toEqual({ text: 'short text', truncated: false });
  });
});
