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
  const isRefreshingRef = useRef(false);
  const pullDistanceRef = useRef(0);
  // Store onRefresh in a ref so the effect never needs to re-run when it changes
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  useEffect(() => {
    if (disabled) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Only trigger when at the top of the page
      if (window.scrollY > 0) return;
      startYRef.current = e.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (startYRef.current === null || isRefreshingRef.current) return;
      const currentY = e.touches[0]?.clientY ?? 0;
      const delta = currentY - startYRef.current;
      if (delta > 0) {
        const distance = Math.min(delta * 0.5, threshold * 1.5);
        pullDistanceRef.current = distance;
        setIsPulling(true);
        setPullDistance(distance);
      }
    };

    const handleTouchEnd = async () => {
      if (startYRef.current === null) return;
      startYRef.current = null;

      if (pullDistanceRef.current >= threshold && !isRefreshingRef.current) {
        isRefreshingRef.current = true;
        setIsRefreshing(true);
        setIsPulling(false);
        setPullDistance(0);
        pullDistanceRef.current = 0;
        try {
          await onRefreshRef.current();
        } finally {
          isRefreshingRef.current = false;
          setIsRefreshing(false);
        }
      } else {
        setIsPulling(false);
        setPullDistance(0);
        pullDistanceRef.current = 0;
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
  }, [disabled, threshold]); // onRefresh intentionally excluded — accessed via ref

  return { isPulling, isRefreshing, pullDistance };
}
