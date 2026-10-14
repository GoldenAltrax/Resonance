import type { Track } from '@/services/api';
import { useTrackMenuStore, type TrackMenuContext } from '@/stores/trackMenuStore';

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;

// Long-press state is module-level: there is only ever one touch to track, and it lets
// rows rendered inline in a .map() use these helpers without a per-row hook.
let timer: ReturnType<typeof setTimeout> | null = null;
let start: { x: number; y: number } | null = null;
let longPressed = false;
// A click arriving before this time is the tail of a long-press. Time-boxed, because
// Android sends no click after a long-press and a stale flag would eat the next real tap.
let suppressClickUntil = 0;

function cancelTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
  start = null;
}

function endTouch() {
  cancelTimer();
  if (longPressed) suppressClickUntil = Date.now() + 400;
  longPressed = false;
}

/**
 * Props for a track row that open the shared track menu on right-click, or on long-press
 * on touch screens. Android fires `contextmenu` on long-press by itself; iOS does not,
 * hence the timer. The click that ends a long-press is swallowed so it doesn't play the track.
 */
export function trackMenuProps(track: Track, context?: TrackMenuContext) {
  const open = (x: number, y: number, byTouch: boolean) => useTrackMenuStore.getState().open(track, x, y, context, byTouch);
  return {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      // Android long-press arrives here as a touch-sourced contextmenu
      const native = e.nativeEvent as Partial<PointerEvent>;
      open(e.clientX, e.clientY, native.pointerType === 'touch');
    },
    onTouchStart: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      cancelTimer();
      if (!touch || e.touches.length > 1) return;
      const point = { x: touch.clientX, y: touch.clientY };
      start = point;
      timer = setTimeout(() => {
        timer = null;
        longPressed = true;
        open(point.x, point.y, true);
      }, LONG_PRESS_MS);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!start || !touch) return;
      if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > MOVE_TOLERANCE_PX) cancelTimer();
    },
    onTouchEnd: endTouch,
    onTouchCancel: endTouch,
    onClickCapture: (e: React.MouseEvent) => {
      if (Date.now() >= suppressClickUntil) return;
      suppressClickUntil = 0;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}

/** onClick for a row's "more" button: opens the menu below the button's right edge. */
export function openTrackMenuFromButton(e: React.MouseEvent<HTMLElement>, track: Track, context?: TrackMenuContext) {
  e.stopPropagation();
  const rect = e.currentTarget.getBoundingClientRect();
  useTrackMenuStore.getState().open(track, rect.right, rect.bottom, context);
}

/** Classes for rows with long-press: no text selection or iOS callout under the finger. */
export const TRACK_ROW_TOUCH_CLASSES = 'select-none [-webkit-touch-callout:none]';
