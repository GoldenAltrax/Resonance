import { useRef, useEffect, useState } from 'react';

interface Options {
  onRefresh: () => Promise<void>;
  threshold?: number; // px to pull before triggering (default 64)
  disabled?: boolean;
}

export function usePullToRefresh({ onRefresh, threshold = 64, disabled = false }: Options) {
  const [isPulling, setIsPulling] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);

  const startYRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (disabled) return;

    const handleTouchStart = (e: TouchEvent) => {
      const el = containerRef.current;
      // Only trigger when at top of scroll container
      if (el && el.scrollTop > 0) return;
      startYRef.current = e.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null || isRefreshing) return;
      const currentY = e.touches[0]?.clientY ?? 0;
      const delta = currentY - startYRef.current;
      if (delta > 0) {
        setIsPulling(true);
        // Apply resistance: pull distance is sqrt-scaled for feel
        setPullDistance(Math.min(delta * 0.5, threshold * 1.5));
      }
    };

    const handleTouchEnd = async () => {
      if (startYRef.current === null) return;
      startYRef.current = null;

      if (pullDistance >= threshold && !isRefreshing) {
        setIsRefreshing(true);
        setIsPulling(false);
        setPullDistance(0);
        try {
          await onRefresh();
        } finally {
          setIsRefreshing(false);
        }
      } else {
        setIsPulling(false);
        setPullDistance(0);
      }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: true });
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [disabled, isRefreshing, pullDistance, threshold, onRefresh]);

  return { containerRef, isPulling, isRefreshing, pullDistance };
}
