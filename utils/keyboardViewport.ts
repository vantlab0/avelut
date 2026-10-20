/**
 * Keyboard / visual viewport geometry helpers.
 *
 * Capacitor is configured with `Keyboard.resize: "none"` on Android, which means
 * the native WebView keeps its layout viewport at full height and only the
 * visual viewport shrinks when the soft keyboard opens. JavaScript is therefore
 * the single authority that translates the visual-viewport delta into the
 * `--keyboard-height` CSS variable. Native resize and JS padding must never be
 * applied at the same time, otherwise the composer receives the offset twice.
 */

export interface ViewportMetrics {
  /** `window.innerHeight` — the layout viewport height. */
  layoutHeight: number;
  /** `visualViewport.height` — the visible area above the keyboard. */
  visualHeight: number;
  /** `visualViewport.offsetTop` — offset of the visual viewport. */
  visualOffsetTop: number;
  /** `window.innerWidth` — used to detect orientation changes. */
  layoutWidth?: number;
}

/**
 * Ignore tiny visual-viewport changes. Mobile browsers resize the visual
 * viewport by a few pixels while scrolling, which must not move the composer.
 */
export const KEYBOARD_MIN_HEIGHT_PX = 60;

/** Never treat more than 60% of the screen as keyboard (guards bogus metrics). */
export const KEYBOARD_MAX_RATIO = 0.6;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Compute the CSS keyboard offset from viewport metrics.
 *
 * The visual viewport may be scrolled (offsetTop > 0) on iOS; subtracting it
 * avoids over-compensating the composer by the amount the page was panned.
 */
export function computeKeyboardHeight(
  metrics: ViewportMetrics,
  minHeight: number = KEYBOARD_MIN_HEIGHT_PX,
  maxRatio: number = KEYBOARD_MAX_RATIO
): number {
  const { layoutHeight, visualHeight, visualOffsetTop } = metrics;
  if (!isFiniteNumber(layoutHeight) || !isFiniteNumber(visualHeight)) return 0;
  if (layoutHeight <= 0 || visualHeight < 0) return 0;

  const offset = isFiniteNumber(visualOffsetTop) ? Math.max(0, visualOffsetTop) : 0;
  const raw = layoutHeight - visualHeight - offset;
  if (raw < minHeight) return 0;

  const max = Math.max(minHeight, Math.round(layoutHeight * maxRatio));
  return Math.min(Math.round(raw), max);
}

/** Read metrics from a DOM window, tolerating browsers without visualViewport. */
export function readViewportMetrics(win: Window | null | undefined): ViewportMetrics {
  if (!win) {
    return { layoutHeight: 0, visualHeight: 0, visualOffsetTop: 0, layoutWidth: 0 };
  }
  const viewport = win.visualViewport;
  return {
    layoutHeight: win.innerHeight || 0,
    visualHeight: viewport?.height ?? win.innerHeight ?? 0,
    visualOffsetTop: viewport?.offsetTop ?? 0,
    layoutWidth: win.innerWidth || 0,
  };
}

/**
 * True when the focused element can summon a soft keyboard. The offset is only
 * applied while such an element is focused so unrelated visual-viewport resize
 * events (browser chrome, pinch zoom) cannot move the chat layout.
 */
export function isEditableElement(element: Element | null | undefined): boolean {
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = (element as HTMLInputElement).type?.toLowerCase();
    return type !== 'button' && type !== 'checkbox' && type !== 'radio' && type !== 'submit' && type !== 'file' && type !== 'range';
  }
  const htmlElement = element as HTMLElement;
  return Boolean(htmlElement.isContentEditable) || element.getAttribute?.('role') === 'textbox';
}

/**
 * requestAnimationFrame coalescer. Rapid visual-viewport events are collapsed
 * into a single layout write per frame, and `cancel()` prevents late callbacks
 * from touching the DOM after the component unmounts.
 */
export function createViewportScheduler(
  callback: () => void,
  requestFrame: (cb: FrameRequestCallback) => number = (cb) => requestAnimationFrame(cb),
  cancelFrame: (handle: number) => void = (handle) => cancelAnimationFrame(handle)
): { schedule: () => void; cancel: () => void } {
  let frame: number | null = null;
  let cancelled = false;

  const schedule = () => {
    if (cancelled || frame !== null) return;
    frame = requestFrame(() => {
      frame = null;
      if (cancelled) return;
      callback();
    });
  };

  const cancel = () => {
    cancelled = true;
    if (frame !== null) {
      cancelFrame(frame);
      frame = null;
    }
  };

  return { schedule, cancel };
}
