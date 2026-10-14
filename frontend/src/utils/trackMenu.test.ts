import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Track } from '@/services/api';
import { trackMenuProps } from '@/utils/trackMenu';
import { useTrackMenuStore } from '@/stores/trackMenuStore';

const track = { id: 't1', title: 'Song' } as Track;
const touch = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y }] }) as unknown as React.TouchEvent;
const click = () => {
  const e = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
  return { e: e as unknown as React.MouseEvent, swallowed: () => e.stopPropagation.mock.calls.length > 0 };
};

beforeEach(() => {
  vi.useFakeTimers();
  useTrackMenuStore.getState().close();
});
afterEach(() => vi.useRealTimers());

describe('trackMenuProps', () => {
  it('opens on right-click at the cursor', () => {
    const preventDefault = vi.fn();
    trackMenuProps(track).onContextMenu({ preventDefault, clientX: 40, clientY: 60, nativeEvent: {} } as unknown as React.MouseEvent);
    expect(preventDefault).toHaveBeenCalled();
    expect(useTrackMenuStore.getState()).toMatchObject({ track, x: 40, y: 60, byTouch: false });
  });

  it('opens on long-press and swallows the click that ends it', () => {
    const props = trackMenuProps(track);
    props.onTouchStart(touch(10, 20));
    vi.advanceTimersByTime(500);
    expect(useTrackMenuStore.getState()).toMatchObject({ track, x: 10, y: 20, byTouch: true });
    props.onTouchEnd();
    const c = click();
    props.onClickCapture(c.e);
    expect(c.swallowed()).toBe(true);
  });

  it('does not swallow a later tap when no click followed the long-press (Android)', () => {
    const props = trackMenuProps(track);
    props.onTouchStart(touch(10, 20));
    vi.advanceTimersByTime(500);
    props.onTouchEnd();
    vi.advanceTimersByTime(1000);
    const c = click();
    props.onClickCapture(c.e);
    expect(c.swallowed()).toBe(false);
  });

  it('ignores short taps and drags', () => {
    const props = trackMenuProps(track);
    props.onTouchStart(touch(10, 20));
    vi.advanceTimersByTime(200);
    props.onTouchEnd();
    vi.advanceTimersByTime(500);

    props.onTouchStart(touch(10, 20));
    props.onTouchMove(touch(10, 60)); // scrolling the list
    vi.advanceTimersByTime(600);

    expect(useTrackMenuStore.getState().track).toBeNull();
    const c = click();
    props.onClickCapture(c.e);
    expect(c.swallowed()).toBe(false);
  });

  it('passes the row context to the menu', () => {
    const onRemove = vi.fn();
    trackMenuProps(track, { playlistId: 'p1', onRemove }).onContextMenu({ preventDefault() {}, clientX: 0, clientY: 0, nativeEvent: {} } as unknown as React.MouseEvent);
    expect(useTrackMenuStore.getState().context).toEqual({ playlistId: 'p1', onRemove });
  });
});
