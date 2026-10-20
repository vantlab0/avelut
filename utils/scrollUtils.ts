/**
 * Scroll helpers shared by chat surfaces.
 *
 * "Stick to bottom" is based on the user's proximity to the bottom, not on a
 * one-off flag that can get stuck. A user who scrolls up to read history is
 * never pulled back down; a user at the bottom keeps following new messages.
 */

export const BOTTOM_THRESHOLD_PX = 120;

export interface ScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export function getDistanceFromBottom(metrics: ScrollMetrics): number {
  const { scrollHeight, scrollTop, clientHeight } = metrics;
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(scrollTop) || !Number.isFinite(clientHeight)) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, scrollHeight - scrollTop - clientHeight);
}

export function isNearBottom(
  metrics: ScrollMetrics,
  threshold: number = BOTTOM_THRESHOLD_PX
): boolean {
  return getDistanceFromBottom(metrics) <= Math.max(0, threshold);
}

export type ScrollContainer = Pick<HTMLElement, 'scrollHeight' | 'scrollTop' | 'clientHeight'> & {
  scrollTo?: HTMLElement['scrollTo'];
};

/** Scroll an element to its bottom, guarding for environments without scrollTo. */
export function scrollContainerToBottom(
  element: ScrollContainer | null | undefined,
  behavior: ScrollBehavior = 'smooth'
): void {
  if (!element) return;
  if (typeof element.scrollTo === 'function') {
    element.scrollTo({ top: element.scrollHeight, behavior });
  } else {
    element.scrollTop = element.scrollHeight;
  }
}

/** True when the element can currently be scrolled to reveal new content. */
export function canScroll(element: ScrollContainer | null | undefined): boolean {
  return Boolean(element && element.scrollHeight > element.clientHeight);
}
