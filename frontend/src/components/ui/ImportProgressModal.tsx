import { useEffect, useRef, useCallback } from 'react';
import { X, Loader2, CheckCircle2, Music } from 'lucide-react';

interface ImportProgressModalProps {
  isOpen: boolean;
  current: number;
  total: number;
  currentFileName?: string;
  onCancel: () => void;
  completed: number;
  skipped: number;
}

const ImportProgressModal = ({
  isOpen,
  current,
  total,
  currentFileName,
  onCancel,
  completed,
  skipped,
}: ImportProgressModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
      return;
    }
    if (e.key !== 'Tab' || !modalRef.current) return;
    const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, [onCancel]);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    const timer = setTimeout(() => {
      modalRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }, 0);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timer);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const progress = total > 0 ? (current / total) * 100 : 0;
  const isFinishing = current === total && total > 0;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4 pb-28">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-progress-title"
        className="bg-[#111111] border border-zinc-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center">
              {isFinishing ? (
                <CheckCircle2 className="w-5 h-5 text-green-500" />
              ) : (
                <Music className="w-5 h-5 text-zinc-400" />
              )}
            </div>
            <div>
              <h2 id="import-progress-title" className="text-lg font-medium text-white">
                {isFinishing ? 'Finishing up...' : 'Importing Tracks'}
              </h2>
              <p className="text-zinc-500 text-sm">
                {isFinishing
                  ? 'Almost done'
                  : `${current} of ${total} tracks`}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
            title="Cancel import"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress */}
        <div className="px-6 py-6">
          {/* Progress bar */}
          <div className="mb-4">
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Current file */}
          {currentFileName && !isFinishing && (
            <div className="flex items-center gap-3 mb-4">
              <Loader2 className="w-4 h-4 text-zinc-500 animate-spin flex-shrink-0" />
              <p className="text-zinc-400 text-sm truncate">{currentFileName}</p>
            </div>
          )}

          {/* Stats */}
          <div className="flex gap-6 text-sm">
            <div>
              <span className="text-zinc-500">Added:</span>{' '}
              <span className="text-green-400 font-medium">{completed}</span>
            </div>
            {skipped > 0 && (
              <div>
                <span className="text-zinc-500">Skipped:</span>{' '}
                <span className="text-amber-400 font-medium">{skipped}</span>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 bg-zinc-900/30">
          <button
            onClick={onCancel}
            className="w-full px-4 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors text-sm"
          >
            Cancel Import
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImportProgressModal;
