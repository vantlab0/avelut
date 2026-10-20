import { describe, expect, it } from 'vitest';
import {
  MENU_GAP_PX,
  MENU_MARGIN_PX,
  computeActionMenuPosition,
  toAnchorRect,
  type AnchorRect,
} from '../utils/actionMenuPosition';

const viewport = { width: 390, height: 844 };

const anchor = (top: number, left: number, width: number, height: number): AnchorRect => ({
  top,
  left,
  width,
  height,
  bottom: top + height,
});

describe('computeActionMenuPosition', () => {
  it('places the menu below the bubble when there is room', () => {
    const position = computeActionMenuPosition({
      anchor: anchor(300, 20, 350, 40),
      menu: { width: 320, height: 200 },
      viewport,
    });

    expect(position.placement).toBe('below');
    expect(position.top).toBe(300 + 40 + MENU_GAP_PX);
    expect(position.left).toBe(35);
    expect(position.maxHeight).toBeGreaterThan(200);
  });

  it('flips above the bubble when there is not enough room below', () => {
    const position = computeActionMenuPosition({
      anchor: anchor(700, 20, 350, 40),
      menu: { width: 320, height: 300 },
      viewport,
    });

    expect(position.placement).toBe('above');
    expect(position.top).toBe(700 - 300 - MENU_GAP_PX);
    expect(position.top + 300).toBeLessThan(700);
  });

  it('clamps the menu horizontally on both edges', () => {
    const leftEdge = computeActionMenuPosition({
      anchor: anchor(300, 0, 40, 40),
      menu: { width: 320, height: 200 },
      viewport,
    });
    expect(leftEdge.left).toBe(MENU_MARGIN_PX);

    const rightEdge = computeActionMenuPosition({
      anchor: anchor(300, 380, 10, 40),
      menu: { width: 320, height: 200 },
      viewport,
    });
    expect(rightEdge.left).toBe(viewport.width - 320 - MENU_MARGIN_PX);
  });

  it('keeps the menu inside safe-area insets', () => {
    const position = computeActionMenuPosition({
      anchor: anchor(100, 20, 350, 40),
      menu: { width: 320, height: 200 },
      viewport,
      safeArea: { top: 44, bottom: 34, left: 10, right: 10 },
    });

    expect(position.top).toBeGreaterThanOrEqual(44 + MENU_MARGIN_PX);
    expect(position.left).toBeGreaterThanOrEqual(10 + MENU_MARGIN_PX);
    expect(position.left + 320).toBeLessThanOrEqual(viewport.width - 10 - MENU_MARGIN_PX);
    expect(position.maxHeight).toBe(844 - 34 - MENU_MARGIN_PX - (44 + MENU_MARGIN_PX));
  });

  it('shrinks narrow menus to fit tiny viewports', () => {
    const position = computeActionMenuPosition({
      anchor: anchor(100, 0, 100, 40),
      menu: { width: 500, height: 200 },
      viewport: { width: 240, height: 500 },
    });

    expect(position.left).toBe(MENU_MARGIN_PX);
    expect(position.left + 200).toBeLessThanOrEqual(240);
  });

  it('falls back to conservative defaults when menu dimensions are unknown', () => {
    const position = computeActionMenuPosition({
      anchor: anchor(300, 20, 350, 40),
      viewport,
    });
    expect(Number.isFinite(position.top)).toBe(true);
    expect(Number.isFinite(position.left)).toBe(true);
    expect(position.maxHeight).toBeGreaterThanOrEqual(160);
  });
});

describe('toAnchorRect', () => {
  it('uses the supplied bottom when available', () => {
    const rect = { top: 10, left: 20, width: 100, height: 40, bottom: 50 };
    expect(toAnchorRect(rect)).toEqual({ top: 10, left: 20, width: 100, height: 40, bottom: 50 });
  });

  it('derives bottom from top plus height', () => {
    const rect = { top: 10, left: 20, width: 100, height: 40 };
    expect(toAnchorRect(rect).bottom).toBe(50);
  });
});
