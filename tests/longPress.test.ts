import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_PRESS_DELAY_MS, createLongPressController } from '../utils/longPress';

describe('createLongPressController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires after the delay when the pointer stays still', () => {
    const onLongPress = vi.fn();
    const controller = createLongPressController({ onLongPress });

    controller.start('chat-1', 100, 100);
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS - 1);
    expect(onLongPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledWith('chat-1');
    expect(controller.consumeFired()).toBe(true);
    expect(controller.consumeFired()).toBe(false);
  });

  it('cancels when the pointer moves beyond the threshold (scroll gesture)', () => {
    const onLongPress = vi.fn();
    const controller = createLongPressController({ onLongPress, moveThreshold: 10 });

    controller.start('bubble-1', 100, 100);
    controller.move(100, 115);
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
    expect(onLongPress).not.toHaveBeenCalled();

    controller.start('bubble-1', 100, 100);
    controller.move(111, 100);
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cancels when the pointer is released before the delay', () => {
    const onLongPress = vi.fn();
    const controller = createLongPressController({ onLongPress });

    controller.start('bubble-2', 10, 10);
    controller.end();
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS * 2);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(controller.isActive()).toBe(false);
  });

  it('restarts the timer for a new gesture', () => {
    const onLongPress = vi.fn();
    const controller = createLongPressController({ onLongPress });

    controller.start('first', 10, 10);
    vi.advanceTimersByTime(300);
    controller.start('second', 20, 20);
    vi.advanceTimersByTime(300);

    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onLongPress).toHaveBeenCalledWith('second');
  });

  it('does not fire after an explicit cancel', () => {
    const onLongPress = vi.fn();
    const controller = createLongPressController({ onLongPress });

    controller.start('bubble-3', 10, 10);
    controller.cancel();
    vi.advanceTimersByTime(LONG_PRESS_DELAY_MS * 2);

    expect(onLongPress).not.toHaveBeenCalled();
    expect(controller.isActive()).toBe(false);
  });
});
