import { useRef, useState, useCallback, useEffect } from 'react';
import { formatTime } from '@/hooks/useAudioPlayer';

interface ProgressScrubberProps {
  progress: number;
  duration: number;
  onSeek: (time: number) => void;
}

export const ProgressScrubber = ({ progress, duration, onSeek }: ProgressScrubberProps) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverPct, setHoverPct] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const getPctFromX = useCallback((clientX: number): number => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  // Attach document-level listeners while dragging so the scrubber
  // keeps tracking even if the cursor leaves the element.
  useEffect(() => {
    if (!isDragging) return;

    const onMove = (e: MouseEvent) => {
      const pct = getPctFromX(e.clientX);
      setHoverPct(pct);
      onSeek((pct / 100) * (duration || 0));
    };

    const onUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, getPctFromX, duration, onSeek]);

  const progressPct = duration ? (progress / duration) * 100 : 0;
  const isActive = hoverPct !== null || isDragging;
  const hoverTime = hoverPct !== null ? (hoverPct / 100) * (duration || 0) : null;

  // Clamp tooltip so it never overflows the track edges
  const tooltipLeft =
    hoverPct !== null
      ? `clamp(18px, ${hoverPct}%, calc(100% - 18px))`
      : '0';

  return (
    <div
      ref={trackRef}
      role="slider"
      aria-label="Track progress"
      aria-valuemin={0}
      aria-valuemax={duration || 100}
      aria-valuenow={progress}
      className="relative flex items-center cursor-pointer select-none"
      style={{ height: '20px' }}
      onMouseEnter={(e) => setHoverPct(getPctFromX(e.clientX))}
      onMouseMove={(e) => { if (!isDragging) setHoverPct(getPctFromX(e.clientX)); }}
      onMouseLeave={() => { if (!isDragging) setHoverPct(null); }}
      onMouseDown={(e) => {
        e.preventDefault();
        const pct = getPctFromX(e.clientX);
        setHoverPct(pct);
        setIsDragging(true);
        onSeek((pct / 100) * (duration || 0));
      }}
    >
      {/* Time tooltip — appears above cursor while hovering/dragging */}
      <div
        className="absolute bottom-full mb-2 -translate-x-1/2 pointer-events-none z-10"
        style={{
          left: tooltipLeft,
          opacity: isActive ? 1 : 0,
          transform: `translateX(-50%) translateY(${isActive ? '0px' : '4px'})`,
          transition: 'opacity 120ms ease-out, transform 120ms ease-out',
        }}
      >
        <div className="bg-zinc-900 border border-zinc-700/50 text-white text-[11px] font-medium px-2 py-[3px] rounded-md tabular-nums shadow-2xl leading-none whitespace-nowrap">
          {hoverTime !== null ? formatTime(hoverTime) : formatTime(progress)}
        </div>
      </div>

      {/* Track bar — expands from 2 → 3 px on hover */}
      <div
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full overflow-hidden"
        style={{
          height: isActive ? '3px' : '2px',
          backgroundColor: 'rgb(39 39 42)',
          transition: 'height 150ms ease-out',
        }}
      >
        {/* Lookahead region — dim preview of where you're scrubbing to */}
        {hoverPct !== null && (
          <div
            className="absolute left-0 top-0 h-full"
            style={{
              width: `${hoverPct}%`,
              backgroundColor: 'rgba(255,255,255,0.18)',
            }}
          />
        )}
        {/* Played fill */}
        <div
          className="absolute left-0 top-0 h-full bg-white"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Thumb dot — glows in, scales in on hover */}
      <div
        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white pointer-events-none"
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
