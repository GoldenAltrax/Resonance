import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { api } from '@/services/api';

// Preload threshold (percentage of track completion)
const PRELOAD_THRESHOLD = 0.75;

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadRef = useRef<HTMLAudioElement | null>(null);
  const preloadedTrackId = useRef<string | null>(null);
  const currentBlobUrl = useRef<string | null>(null);
  const preloadedBlobUrl = useRef<string | null>(null);

  const {
    currentTrack,
    isPlaying,
    volume,
    repeat,
    queue,
    queueIndex,
    shuffle,
    setAudioElement,
    setProgress,
    setDuration,
    next,
    pause,
  } = usePlayerStore();

  // Initialize audio element
  useEffect(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = volume;
      setAudioElement(audioRef.current);
    }

    const audio = audioRef.current;

    // Initialize preload audio element
    if (!preloadRef.current) {
      preloadRef.current = new Audio();
      preloadRef.current.preload = 'auto';
      preloadRef.current.volume = 0; // Silent preload
    }

    // Event handlers
    const handleTimeUpdate = () => {
      setProgress(audio.currentTime);

      // Check if we should preload the next track
      if (audio.duration && audio.currentTime / audio.duration >= PRELOAD_THRESHOLD) {
        preloadNextTrack();
      }
    };

    // Preload the next track in queue
    const preloadNextTrack = () => {
      if (!preloadRef.current || queue.length === 0) return;

      let nextIndex: number;
      if (shuffle) {
        // For shuffle mode, we can't predict the next track
        return;
      } else {
        nextIndex = queueIndex + 1;
        if (nextIndex >= queue.length) {
          if (repeat === 'all') {
            nextIndex = 0;
          } else {
            return; // No next track to preload
          }
        }
      }

      const nextTrack = queue[nextIndex];
      if (!nextTrack || preloadedTrackId.current === nextTrack.id) {
        return; // Already preloaded or no track
      }

      // Preload the next track using secure blob URL
      api.getSecureStreamUrl(nextTrack.id)
        .then((blobUrl) => {
          if (preloadRef.current && preloadedTrackId.current !== nextTrack.id) {
            // Revoke old preloaded blob URL if exists
            if (preloadedBlobUrl.current) {
              api.revokeStreamUrl(preloadedBlobUrl.current);
            }
            preloadRef.current.src = blobUrl;
            preloadRef.current.load();
            preloadedTrackId.current = nextTrack.id;
            preloadedBlobUrl.current = blobUrl;
          } else {
            // Component unmounted or track changed, revoke the blob
            api.revokeStreamUrl(blobUrl);
          }
        })
        .catch((err) => {
          console.warn('Failed to preload next track:', err);
        });
    };

    const handleLoadedMetadata = () => {
      setDuration(audio.duration);
    };

    const handleEnded = () => {
      if (repeat === 'one') {
        audio.currentTime = 0;
        audio.play();
      } else {
        next();
      }
    };

    const handleError = (e: Event) => {
      console.error('Audio error:', e);
      pause();
    };

    // Attach event listeners
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
      // Cleanup blob URLs on unmount
      if (currentBlobUrl.current) {
        api.revokeStreamUrl(currentBlobUrl.current);
        currentBlobUrl.current = null;
      }
      if (preloadedBlobUrl.current) {
        api.revokeStreamUrl(preloadedBlobUrl.current);
        preloadedBlobUrl.current = null;
      }
      // Cleanup preload audio element
      if (preloadRef.current) {
        preloadRef.current.src = '';
        preloadRef.current = null;
      }
    };
  }, [repeat, next, pause, setAudioElement, setProgress, setDuration, volume, queue, queueIndex, shuffle]);

  // Handle track changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    // Revoke old blob URL before loading new track
    if (currentBlobUrl.current) {
      api.revokeStreamUrl(currentBlobUrl.current);
      currentBlobUrl.current = null;
    }

    // Check if this track was preloaded
    if (preloadedTrackId.current === currentTrack.id && preloadedBlobUrl.current) {
      // Use the preloaded blob URL
      audio.src = preloadedBlobUrl.current;
      currentBlobUrl.current = preloadedBlobUrl.current;
      preloadedBlobUrl.current = null;
      preloadedTrackId.current = null;
      audio.load();

      if (isPlaying) {
        audio.play().catch((err) => {
          console.error('Playback failed:', err);
        });
      }
    } else {
      // Fetch secure stream URL
      api.getSecureStreamUrl(currentTrack.id)
        .then((blobUrl) => {
          if (audioRef.current && currentTrack) {
            // Revoke any URL that might have been set in the meantime
            if (currentBlobUrl.current && currentBlobUrl.current !== blobUrl) {
              api.revokeStreamUrl(currentBlobUrl.current);
            }
            audioRef.current.src = blobUrl;
            currentBlobUrl.current = blobUrl;
            audioRef.current.load();

            if (usePlayerStore.getState().isPlaying) {
              audioRef.current.play().catch((err) => {
                console.error('Playback failed:', err);
              });
            }
          } else {
            // Component unmounted, revoke the blob
            api.revokeStreamUrl(blobUrl);
          }
        })
        .catch((err) => {
          console.error('Failed to load audio:', err);
        });
    }

    // Clear preload state for this track
    if (preloadedTrackId.current === currentTrack.id) {
      preloadedTrackId.current = null;
    }
  }, [currentTrack]);

  // Handle play/pause state changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    if (isPlaying) {
      audio.play().catch((err) => {
        console.error('Playback failed:', err);
      });
    } else {
      audio.pause();
    }
  }, [isPlaying, currentTrack]);

  // Handle volume changes
  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.volume = volume;
    }
  }, [volume]);

  // Utility functions
  const formatTime = useCallback((seconds: number): string => {
    if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  return {
    audioRef,
    formatTime,
  };
}
