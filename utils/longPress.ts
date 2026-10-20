/**
 * Framework-agnostic long-press controller used by messenger rows and bubbles.
 *
 * A long press only fires when the pointer stays within `moveThreshold` CSS
 * pixels for `delay` ms. Scrolling therefore cancels the timer naturally, and
 * the controller can be shared by every row because it tracks a single active
 * pointer target at a time.
 */

export interface LongPressControllerOptions {
  delay?: number;
  moveThreshold?: number;
  onLongPress: (id: string) => void;
}

export interface LongPressController {
  start: (id: string, clientX: number, clientY: number) => void;
  move: (clientX: number, clientY: number) => void;
  end: () => void;
  cancel: () => void;
  /** True when the last gesture fired a long press; resets after read. */
  consumeFired: () => boolean;
  isActive: () => boolean;
}

export const LONG_PRESS_DELAY_MS = 500;
export const LONG_PRESS_MOVE_THRESHOLD_PX = 10;

export function createLongPressController({
  delay = LONG_PRESS_DELAY_MS,
  moveThreshold = LONG_PRESS_MOVE_THRESHOLD_PX,
  onLongPress,
}: LongPressControllerOptions): LongPressController {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let activeId: string | null = null;
  let startX = 0;
  let startY = 0;
  let fired = false;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const cancel = () => {
    clearTimer();
    activeId = null;
  };

  const start = (id: string, clientX: number, clientY: number) => {
    clearTimer();
    activeId = id;
    startX = clientX;
    startY = clientY;
    fired = false;
    timer = setTimeout(() => {
      timer = null;
      if (activeId !== id) return;
      fired = true;
      activeId = null;
      onLongPress(id);
    }, Math.max(200, delay));
  };

  const move = (clientX: number, clientY: number) => {
    if (activeId === null || timer === null) return;
    const dx = clientX - startX;
    const dy = clientY - startY;
    if (Math.abs(dx) > moveThreshold || Math.abs(dy) > moveThreshold) {
      cancel();
    }
  };

  const end = () => {
    clearTimer();
    activeId = null;
  };

  return {
    start,
    move,
    end,
    cancel,
    consumeFired: () => {
      const value = fired;
      fired = false;
      return value;
    },
    isActive: () => activeId !== null || timer !== null,
  };
}
