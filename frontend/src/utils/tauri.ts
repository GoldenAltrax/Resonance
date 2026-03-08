/**
 * Tauri environment detection utilities.
 * Safe to call in browser (non-Tauri) context — all functions return false.
 */

export const isTauri = (): boolean => '__TAURI_INTERNALS__' in window;

export const isAndroid = async (): Promise<boolean> => {
  if (!isTauri()) return false;
  try {
    const { platform } = await import('@tauri-apps/plugin-os');
    return (await platform()) === 'android';
  } catch {
    return false;
  }
};

export const isMacOS = async (): Promise<boolean> => {
  if (!isTauri()) return false;
  try {
    const { platform } = await import('@tauri-apps/plugin-os');
    return (await platform()) === 'macos';
  } catch {
    return false;
  }
};
