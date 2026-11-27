import React, { useId } from 'react';
import {
  BookOpen,
  Calculator,
  Compass,
  FlaskConical,
  GraduationCap,
  Lightbulb,
  NotebookPen,
  Pencil,
  Pi,
  Ruler,
  Sigma,
  Triangle,
} from 'lucide-react';

const PATTERN_ICONS = [
  Pencil, Ruler, Compass, Calculator, Lightbulb, Triangle,
  Sigma, GraduationCap, FlaskConical, NotebookPen, Pi, BookOpen,
];

/** Scattered positions inside one repeating 240 x 240 tile. */
const PLACEMENTS: Array<[number, number, number, number]> = [
  [14, 18, 0.30, -12],
  [66, 44, 0.26, 18],
  [132, 14, 0.32, -6],
  [198, 38, 0.27, 22],
  [36, 90, 0.28, 14],
  [104, 82, 0.31, -20],
  [172, 96, 0.26, 8],
  [226, 78, 0.29, -14],
  [12, 150, 0.31, 20],
  [78, 142, 0.27, -8],
  [144, 158, 0.30, 16],
  [212, 148, 0.26, -24],
  [40, 210, 0.28, 10],
  [106, 220, 0.31, -16],
  [176, 206, 0.27, 24],
  [228, 224, 0.29, -10],
];

/**
 * Very small, low-contrast learning/math icons repeated as a wallpaper.
 * Gray on light backgrounds, white on dark backgrounds. Decorative only.
 */
export const LearningPatternBackground: React.FC<{ className?: string }> = ({ className = '' }) => {
  const patternId = `learning-icons-${useId().replace(/:/g, '')}`;

  return (
    <svg
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full text-neutral-300 dark:text-white/[0.14] ${className}`}
    >
      <defs>
        <pattern id={patternId} width="240" height="240" patternUnits="userSpaceOnUse">
          {PLACEMENTS.map(([x, y, scale, rotate], index) => {
            const Icon = PATTERN_ICONS[index % PATTERN_ICONS.length];
            return (
              <g key={index} transform={`translate(${x} ${y}) rotate(${rotate}) scale(${scale})`}>
                <Icon width={24} height={24} strokeWidth={2.4} />
              </g>
            );
          })}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
};
