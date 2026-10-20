/**
 * Placement helper for context menus anchored to a message bubble.
 *
 * The menu is kept inside the visual viewport, flipped above the anchor when
 * there is not enough room below, and constrained to the safe-area insets.
 */

export interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
  bottom: number;
}

export interface MenuSize {
  width: number;
  height: number;
}

export interface ViewportRect {
  width: number;
  height: number;
  offsetTop?: number;
}

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MenuPosition {
  left: number;
  top: number;
  placement: 'above' | 'below';
  maxHeight: number;
}

export const MENU_MARGIN_PX = 8;
export const MENU_GAP_PX = 8;
export const DEFAULT_MENU_WIDTH = 288;
export const DEFAULT_MENU_HEIGHT = 420;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

export function computeActionMenuPosition(params: {
  anchor: AnchorRect;
  menu?: MenuSize;
  viewport: ViewportRect;
  safeArea?: Partial<SafeAreaInsets>;
}): MenuPosition {
  const { anchor, viewport } = params;
  const menu = params.menu ?? { width: DEFAULT_MENU_WIDTH, height: DEFAULT_MENU_HEIGHT };
  const safeArea = {
    top: Math.max(0, params.safeArea?.top ?? 0),
    bottom: Math.max(0, params.safeArea?.bottom ?? 0),
    left: Math.max(0, params.safeArea?.left ?? 0),
    right: Math.max(0, params.safeArea?.right ?? 0),
  };

  const viewportHeight = Math.max(0, viewport.height);
  const margin = MENU_MARGIN_PX;

  const width = Math.min(Math.max(200, menu.width), Math.max(200, viewport.width - margin * 2 - safeArea.left - safeArea.right));
  const availableTop = safeArea.top + margin;
  const availableBottom = viewportHeight - safeArea.bottom - margin;
  const maxHeight = Math.max(160, availableBottom - availableTop);

  const desiredHeight = Math.min(Math.max(0, menu.height), maxHeight);
  const spaceBelow = availableBottom - anchor.bottom;
  const spaceAbove = anchor.top - availableTop;
  const placeAbove = spaceBelow < desiredHeight + MENU_GAP_PX && spaceAbove > spaceBelow;

  const top = placeAbove
    ? Math.max(availableTop, anchor.top - desiredHeight - MENU_GAP_PX)
    : Math.min(anchor.bottom + MENU_GAP_PX, availableBottom - desiredHeight);

  const left = clamp(
    anchor.left + anchor.width / 2 - width / 2,
    safeArea.left + margin,
    viewport.width - safeArea.right - width - margin
  );

  return {
    left: Math.round(left),
    top: Math.round(Math.max(availableTop, top)),
    placement: placeAbove ? 'above' : 'below',
    maxHeight: Math.round(maxHeight),
  };
}

/** Convert a DOMRect into the plain shape the placement helper expects. */
export function toAnchorRect(rect: DOMRect | { top: number; left: number; width: number; height: number; bottom?: number }): AnchorRect {
  return {
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    bottom: 'bottom' in rect && typeof rect.bottom === 'number' ? rect.bottom : rect.top + rect.height,
  };
}
