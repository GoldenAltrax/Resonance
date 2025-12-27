import { useEffect, useState, useRef, useMemo } from 'react';
import { X, Music2 } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { fetchLyrics, LyricLine, getCurrentLyricIndex } from '@/services/lyrics';

const LyricsPanel = () => {
  const { currentTrack, progress, showLyrics, toggleLyrics, seek } = usePlayerStore();
  const [lyrics, setLyrics] = useState<LyricLine[] | null>(null);
  const [plainLyrics, setPlainLyrics] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLineRef = useRef<HTMLButtonElement>(null);

  // Fetch lyrics when track changes
  useEffect(() => {
    if (!currentTrack) {
      setLyrics(null);
      setPlainLyrics(null);
      return;
    }

    const loadLyrics = async () => {
      setIsLoading(true);
      setError(null);
      setLyrics(null);
      setPlainLyrics(null);

      try {
        const result = await fetchLyrics(currentTrack.title, currentTrack.artist);
        setLyrics(result.synced);
        setPlainLyrics(result.plain);

        if (!result.synced && !result.plain) {
          setError('No lyrics available for this track');
        }
      } catch {
        setError('Failed to load lyrics');
      } finally {
        setIsLoading(false);
      }
    };

    loadLyrics();
  }, [currentTrack?.id]);

  // Get current lyric index
  const currentIndex = useMemo(() => {
    if (!lyrics) return -1;
    return getCurrentLyricIndex(lyrics, progress);
  }, [lyrics, progress]);

  // Auto-scroll to current lyric
  useEffect(() => {
    if (activeLineRef.current && containerRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }
  }, [currentIndex]);

  // Handle lyric click to seek
  const handleLyricClick = (time: number) => {
    seek(time);
  };

  // Handle close with animation
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      toggleLyrics();
      setIsClosing(false);
    }, 300);
  };

  if (!showLyrics) return null;

  return (
    <div className="fixed top-0 right-0 bottom-24 z-40 pointer-events-none">
      {/* Right Sidebar Panel */}
      <div
        className={`w-[400px] max-w-[90vw] h-full bg-[#0a0a0a] border-l border-zinc-800/50 flex flex-col shadow-2xl transition-transform duration-300 ease-out pointer-events-auto ${
          isClosing ? 'translate-x-full' : 'translate-x-0'
        }`}
        style={{
          animation: isClosing ? undefined : 'slideInFromRight 0.3s ease-out',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800/50">
          <div className="flex items-center gap-3 min-w-0">
            <Music2 className="w-5 h-5 text-zinc-500 flex-shrink-0" />
            <div className="min-w-0">
              <h3 className="text-white font-medium truncate">{currentTrack?.title || 'No track playing'}</h3>
              <p className="text-zinc-500 text-sm truncate">{currentTrack?.artist || 'Unknown artist'}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors flex-shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Lyrics Content */}
        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar"
        >
          {isLoading && (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500">
              <svg className="animate-spin h-8 w-8 mb-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" fill="none"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <p>Loading lyrics...</p>
            </div>
          )}

          {error && !isLoading && (
            <div className="flex flex-col items-center justify-center h-full text-zinc-500">
              <Music2 className="w-12 h-12 mb-4 opacity-50" />
              <p>{error}</p>
            </div>
          )}

          {/* Synced Lyrics */}
          {lyrics && lyrics.length > 0 && (
            <div className="flex flex-col gap-4 py-4">
              {lyrics.map((line, index) => (
                <button
                  key={index}
                  ref={index === currentIndex ? activeLineRef : null}
                  onClick={() => handleLyricClick(line.time)}
                  className={`text-left px-3 py-2 rounded-lg transition-all duration-300 ${
                    index === currentIndex
                      ? 'text-white text-lg font-medium bg-zinc-800/50'
                      : index < currentIndex
                      ? 'text-zinc-600 text-base hover:text-zinc-400 hover:bg-zinc-800/30'
                      : 'text-zinc-500 text-base hover:text-zinc-300 hover:bg-zinc-800/30'
                  }`}
                >
                  {line.text}
                </button>
              ))}
            </div>
          )}

          {/* Plain Lyrics (fallback when no synced lyrics) */}
          {!lyrics && plainLyrics && (
            <div className="py-4">
              <p className="text-zinc-400 whitespace-pre-wrap leading-relaxed">
                {plainLyrics}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* CSS Animation */}
      <style>{`
        @keyframes slideInFromRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
};

export default LyricsPanel;
