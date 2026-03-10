import { useState, useEffect } from 'react';
import { isTauri, isAndroid as checkIsAndroid } from '@/utils/tauri';

export function usePlatform() {
  // Default false — non-Tauri contexts are always desktop
  const [android, setAndroid] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    checkIsAndroid().then(setAndroid);
  }, []);

  return { isAndroid: android };
}
