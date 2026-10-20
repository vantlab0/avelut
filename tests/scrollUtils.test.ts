import { describe, expect, it, vi } from 'vitest';
import {
  BOTTOM_THRESHOLD_PX,
  canScroll,
  getDistanceFromBottom,
  isNearBottom,
  scrollContainerToBottom,
} from '../utils/scrollUtils';

describe('scroll helpers', () => {
  it('computes distance from the bottom and clamps overscroll', () => {
    expect(getDistanceFromBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 300 })).toBe(100);
    expect(getDistanceFromBottom({ scrollHeight: 1000, scrollTop: 900, clientHeight: 300 })).toBe(0);
  });

  it('treats invalid metrics as infinitely far from the bottom', () => {
    expect(
      getDistanceFromBottom({ scrollHeight: Number.NaN, scrollTop: 0, clientHeight: 300 })
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it('uses proximity, not a sticky flag, for auto-scroll decisions', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 300 })).toBe(true);
    expect(
      isNearBottom({
        scrollHeight: 1000,
        scrollTop: 600 - BOTTOM_THRESHOLD_PX,
        clientHeight: 300,
      })
    ).toBe(false);
    expect(
      isNearBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 300 }, 0)
    ).toBe(true);
  });

  it('scrolls via scrollTo when available', () => {
    const scrollTo = vi.fn();
    scrollContainerToBottom(
      { scrollHeight: 1200, scrollTop: 0, clientHeight: 300, scrollTo },
      'auto'
    );
    expect(scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'auto' });
  });

  it('falls back to scrollTop when scrollTo is unavailable', () => {
    const element = { scrollHeight: 1200, scrollTop: 0, clientHeight: 300 };
    scrollContainerToBottom(element, 'smooth');
    expect(element.scrollTop).toBe(1200);
  });

  it('does nothing for null containers and detects scrollability', () => {
    expect(() => scrollContainerToBottom(null)).not.toThrow();
    expect(canScroll(null)).toBe(false);
    expect(canScroll({ scrollHeight: 500, scrollTop: 0, clientHeight: 400 })).toBe(true);
    expect(canScroll({ scrollHeight: 400, scrollTop: 0, clientHeight: 400 })).toBe(false);
  });
});
