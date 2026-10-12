import { useRef, useState, useCallback } from 'react';
import { usePlaybackStore } from '@/stores/playbackStore';
import { usePlayerStore } from '@/stores/playerStore';
import { formatDuration } from '@/utils/time';

/** Elapsed time label; re-renders on its own once per second instead of re-rendering its parent. */
export const ElapsedTime = ({ className }: { className?: string }) => {
  const seconds = usePlaybackStore((s) => Math.floor(s.progress));
  return <span className={className}>{formatDuration(seconds)}</span>;
};

export const TotalTime = ({ className }: { className?: string }) => {
  const duration = usePlaybackStore((s) => Math.floor(s.duration));
  return <span className={className}>{formatDuration(duration)}</span>;
};

interface ProgressScrubberProps {
  /** 'touch' uses a taller hit area and an always-visible thumb (mobile now-playing screen). */
  variant?: 'desktop' | 'touch';
}

/**
 * Seek bar. Uses pointer events (mouse, touch and pen), previews the position while
 * dragging and seeks once on release — seeking on every move makes audio stutter.
 */
export const ProgressScrubber = ({ variant = 'desktop' }: ProgressScrubberProps) => {
  const progress = usePlaybackStore((s) => s.progress);
  const duration = usePlaybackStore((s) => s.duration);
  const seek = usePlayerStore((s) => s.seek);
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [dragPct, setDragPct] = useState<number | null>(null);
  const isTouch = variant === 'touch';

  const getPctFromX = useCallback((clientX: number): number => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const commit = (pct: number) => {
    if (duration > 0) seek((pct / 100) * duration);
  };

  const isDragging = dragPct !== null;
  const progressPct = isDragging ? dragPct : duration ? (progress / duration) * 100 : 0;
  const previewPct = dragPct ?? hoverPct;
  const isActive = isTouch || previewPct !== null;
  const previewTime = previewPct !== null ? (previewPct / 100) * duration : null;

  const tooltipLeft = previewPct !== null ? `clamp(18px, ${previewPct}%, calc(100% - 18px))` : '0';

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration) || 0}
      aria-valuenow={Math.round(progress)}
      aria-valuetext={`${formatDuration(progress)} of ${formatDuration(duration)}`}
      className="relative flex items-center cursor-pointer select-none outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded"
      style={{ height: isTouch ? '28px' : '20px', touchAction: 'none' }}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHoverPct(getPctFromX(e.clientX)); }}
      onPointerLeave={() => { if (!isDragging) setHoverPct(null); }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragPct(getPctFromX(e.clientX));
      }}
      onPointerMove={(e) => {
        const pct = getPctFromX(e.clientX);
        if (isDragging) setDragPct(pct);
        else if (e.pointerType === 'mouse') setHoverPct(pct);
      }}
      onPointerUp={(e) => {
        if (!isDragging) return;
        commit(getPctFromX(e.clientX));
        setDragPct(null);
        if (e.pointerType !== 'mouse') setHoverPct(null);
      }}
      onPointerCancel={() => setDragPct(null)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 30 : 5;
        if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); seek(Math.min(duration, progress + step)); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); seek(Math.max(0, progress - step)); }
      }}
    >
      {/* Time tooltip — appears above the pointer while hovering/dragging */}
      <div
        className="absolute bottom-full mb-2 -translate-x-1/2 pointer-events-none z-10"
        style={{
          left: tooltipLeft,
          opacity: previewPct !== null ? 1 : 0,
          transform: `translateX(-50%) translateY(${previewPct !== null ? '0px' : '4px'})`,
          transition: 'opacity 120ms ease-out, transform 120ms ease-out',
        }}
      >
        <div className="bg-zinc-900 border border-zinc-700/50 text-white text-[11px] font-medium px-2 py-[3px] rounded-md tabular-nums shadow-2xl leading-none whitespace-nowrap">
          {formatDuration(previewTime ?? progress)}
        </div>
      </div>

      {/* Track bar */}
      <div
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full overflow-hidden"
        style={{
          height: isTouch ? '4px' : isActive ? '3px' : '2px',
          backgroundColor: 'rgb(39 39 42)',
          transition: 'height 150ms ease-out',
        }}
      >
        {hoverPct !== null && !isDragging && (
          <div
            className="absolute left-0 top-0 h-full"
            style={{ width: `${hoverPct}%`, backgroundColor: 'rgba(255,255,255,0.18)' }}
          />
        )}
        <div
          className="absolute left-0 top-0 h-full bg-white origin-left"
          style={{ width: '100%', transform: `scaleX(${progressPct / 100})` }}
        />
      </div>

      {/* Thumb */}
      <div
        className="absolute top-1/2 rounded-full bg-white pointer-events-none"
        style={{
          left: `${progressPct}%`,
          width: '13px',
          height: '13px',
          opacity: isActive ? 1 : 0,
          transform: `translateX(-50%) translateY(-50%) scale(${isActive ? 1 : 0.5})`,
          transition: 'opacity 150ms ease-out, transform 150ms ease-out',
          boxShadow: '0 0 0 2.5px rgba(255,255,255,0.12), 0 0 14px rgba(255,255,255,0.45)',
        }}
      />
    </div>
  );
};

export default ProgressScrubber;
