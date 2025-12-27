import { useEffect, useRef, useCallback } from 'react';
import { X, Keyboard } from 'lucide-react';

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const shortcuts = [
  { key: 'Space', description: 'Play / Pause' },
  { key: 'N', description: 'Next track' },
  { key: 'P', description: 'Previous track' },
  { key: 'M', description: 'Mute / Unmute' },
  { key: 'S', description: 'Toggle shuffle' },
  { key: 'R', description: 'Cycle repeat mode' },
  { key: 'L', description: 'Show / Hide lyrics' },
  { key: '\u2190', description: 'Seek backward 10 seconds', label: 'Left Arrow' },
  { key: '\u2192', description: 'Seek forward 10 seconds', label: 'Right Arrow' },
  { key: 'Shift + \u2191', description: 'Increase volume', label: 'Shift + Up' },
  { key: 'Shift + \u2193', description: 'Decrease volume', label: 'Shift + Down' },
  { key: '?', description: 'Show keyboard shortcuts' },
];

const KeyboardShortcutsModal = ({ isOpen, onClose }: KeyboardShortcutsModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
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
  }, [onClose]);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        className="relative bg-zinc-900 rounded-2xl w-full max-w-lg mx-4 shadow-2xl border border-zinc-800 max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center">
              <Keyboard className="w-5 h-5 text-zinc-400" />
            </div>
            <h2 id="keyboard-shortcuts-title" className="text-lg font-semibold text-white">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto">
          <div className="space-y-3">
            {shortcuts.map(({ key, description, label }) => (
              <div
                key={key}
                className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0"
              >
                <span className="text-zinc-400 text-sm">{description}</span>
                <kbd className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs font-mono text-zinc-300 min-w-[60px] text-center">
                  {label || key}
                </kbd>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-zinc-800">
          <p className="text-xs text-zinc-500 text-center">
            Press <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">?</kbd> anytime to view this help
          </p>
        </div>
      </div>
    </div>
  );
};

export default KeyboardShortcutsModal;
