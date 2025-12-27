import { useEffect, useRef, useCallback } from 'react';
import { usePlayerStore } from '@/stores/playerStore';
import { api } from '@/services/api';

// Preload threshold (percentage of track completion)
const PRELOAD_THRESHOLD = 0.75;

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadRef = useRef<HTMLAudioElement | null>(null);
  const preloadedTrackId = useRef<string | null>(null);

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

      // Preload the next track
      const streamUrl = api.getTrackStreamUrl(nextTrack.id);
      preloadRef.current.src = streamUrl;
      preloadRef.current.load();
      preloadedTrackId.current = nextTrack.id;
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
    };
  }, [repeat, next, pause, setAudioElement, setProgress, setDuration, volume, queue, queueIndex, shuffle]);

  // Handle track changes
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;

    // Check if this track was preloaded
    if (preloadedTrackId.current === currentTrack.id && preloadRef.current?.src) {
      // Use the preloaded audio source
      audio.src = preloadRef.current.src;
    } else {
      // Set the audio source normally
      const streamUrl = api.getTrackStreamUrl(currentTrack.id);
      audio.src = streamUrl;
    }

    audio.load();

    // Clear preload state for this track
    if (preloadedTrackId.current === currentTrack.id) {
      preloadedTrackId.current = null;
    }

    // Auto-play if isPlaying is true
    if (isPlaying) {
      audio.play().catch((err) => {
        console.error('Playback failed:', err);
      });
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
