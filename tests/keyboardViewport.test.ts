import { describe, expect, it, vi } from 'vitest';
import {
  KEYBOARD_MAX_RATIO,
  KEYBOARD_MIN_HEIGHT_PX,
  computeKeyboardHeight,
  createViewportScheduler,
  isEditableElement,
  readViewportMetrics,
} from '../utils/keyboardViewport';

describe('computeKeyboardHeight', () => {
  it('returns the visual-viewport delta when the keyboard is open', () => {
    expect(
      computeKeyboardHeight({ layoutHeight: 800, visualHeight: 500, visualOffsetTop: 0 })
    ).toBe(300);
  });

  it('subtracts a panned visual viewport offset', () => {
    expect(
      computeKeyboardHeight({ layoutHeight: 800, visualHeight: 500, visualOffsetTop: 40 })
    ).toBe(260);
  });

  it('ignores sub-threshold viewport noise', () => {
    expect(
      computeKeyboardHeight({
        layoutHeight: 800,
        visualHeight: 800 - (KEYBOARD_MIN_HEIGHT_PX - 1),
        visualOffsetTop: 0,
      })
    ).toBe(0);
  });

  it('clamps implausible keyboard heights to the configured ratio', () => {
    const result = computeKeyboardHeight({
      layoutHeight: 1000,
      visualHeight: 100,
      visualOffsetTop: 0,
    });
    expect(result).toBe(Math.round(1000 * KEYBOARD_MAX_RATIO));
  });

  it('returns 0 for missing, negative, or non-finite metrics', () => {
    expect(
      computeKeyboardHeight({ layoutHeight: Number.NaN, visualHeight: 400, visualOffsetTop: 0 })
    ).toBe(0);
    expect(computeKeyboardHeight({ layoutHeight: 800, visualHeight: -1, visualOffsetTop: 0 })).toBe(0);
    expect(computeKeyboardHeight({ layoutHeight: 0, visualHeight: 0, visualOffsetTop: 0 })).toBe(0);
  });

  it('handles a negative offset defensively', () => {
    expect(
      computeKeyboardHeight({ layoutHeight: 800, visualHeight: 500, visualOffsetTop: -20 })
    ).toBe(300);
  });
});

describe('readViewportMetrics', () => {
  it('returns zeroed metrics when no window is available', () => {
    expect(readViewportMetrics(null)).toEqual({
      layoutHeight: 0,
      visualHeight: 0,
      visualOffsetTop: 0,
      layoutWidth: 0,
    });
  });

  it('reads the visual viewport when present', () => {
    const win = {
      innerHeight: 800,
      innerWidth: 390,
      visualViewport: { height: 480, offsetTop: 12 },
    } as unknown as Window;
    expect(readViewportMetrics(win)).toEqual({
      layoutHeight: 800,
      visualHeight: 480,
      visualOffsetTop: 12,
      layoutWidth: 390,
    });
  });

  it('falls back to innerHeight when visualViewport is unavailable', () => {
    const win = { innerHeight: 720, innerWidth: 360 } as unknown as Window;
    expect(readViewportMetrics(win)).toMatchObject({
      layoutHeight: 720,
      visualHeight: 720,
      visualOffsetTop: 0,
    });
  });
});

describe('isEditableElement', () => {
  const element = (tagName: string, extra: Record<string, unknown> = {}) =>
    ({ tagName, getAttribute: () => null, ...extra }) as unknown as Element;

  it('accepts text inputs, textareas, selects, and contenteditable elements', () => {
    expect(isEditableElement(element('INPUT', { type: 'text' }))).toBe(true);
    expect(isEditableElement(element('TEXTAREA'))).toBe(true);
    expect(isEditableElement(element('SELECT'))).toBe(true);
    expect(isEditableElement(element('DIV', { isContentEditable: true }))).toBe(true);
  });

  it('rejects buttons, files, checkboxes, and non-editable elements', () => {
    expect(isEditableElement(element('INPUT', { type: 'button' }))).toBe(false);
    expect(isEditableElement(element('INPUT', { type: 'file' }))).toBe(false);
    expect(isEditableElement(element('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isEditableElement(element('DIV'))).toBe(false);
    expect(isEditableElement(null)).toBe(false);
  });

  it('accepts ARIA textboxes', () => {
    const ariaTextbox = {
      tagName: 'DIV',
      isContentEditable: false,
      getAttribute: (name: string) => (name === 'role' ? 'textbox' : null),
    } as unknown as Element;
    expect(isEditableElement(ariaTextbox)).toBe(true);
  });
});

describe('createViewportScheduler', () => {
  it('coalesces multiple schedules into one frame', () => {
    let queued: FrameRequestCallback | null = null;
    const requestFrame = vi.fn((cb: FrameRequestCallback) => {
      queued = cb;
      return 1;
    });
    const cancelFrame = vi.fn();
    const callback = vi.fn();
    const scheduler = createViewportScheduler(callback, requestFrame, cancelFrame);

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();

    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();

    (queued as FrameRequestCallback)(0);
    expect(callback).toHaveBeenCalledTimes(1);

    scheduler.schedule();
    expect(requestFrame).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending frame and ignores later schedules', () => {
    let queued: FrameRequestCallback | null = null;
    const requestFrame = vi.fn((cb: FrameRequestCallback) => {
      queued = cb;
      return 7;
    });
    const cancelFrame = vi.fn();
    const callback = vi.fn();
    const scheduler = createViewportScheduler(callback, requestFrame, cancelFrame);

    scheduler.schedule();
    scheduler.cancel();
    expect(cancelFrame).toHaveBeenCalledWith(7);

    scheduler.schedule();
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();
  });
});
