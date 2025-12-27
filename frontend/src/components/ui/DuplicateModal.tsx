import { useState, useEffect, useRef, useCallback } from 'react';
import { X, AlertTriangle } from 'lucide-react';

export type DuplicateAction = 'skip' | 'add' | 'replace';

export interface DuplicateItem {
  fileName: string;
  title: string;
  artist: string | null;
  existingTrackId: string;
  action: DuplicateAction;
}

interface DuplicateModalProps {
  isOpen: boolean;
  duplicates: DuplicateItem[];
  onClose: () => void;
  onConfirm: (duplicates: DuplicateItem[]) => void;
}

const DuplicateModal = ({
  isOpen,
  duplicates,
  onClose,
  onConfirm,
}: DuplicateModalProps) => {
  const [items, setItems] = useState<DuplicateItem[]>(duplicates);
  const [applyToAll, setApplyToAll] = useState(false);
  const [bulkAction, setBulkAction] = useState<DuplicateAction>('skip');

  // Reset state when modal opens with new duplicates
  useEffect(() => {
    setItems(duplicates);
    setApplyToAll(false);
    setBulkAction('skip');
  }, [duplicates]);

  const handleActionChange = (index: number, action: DuplicateAction) => {
    if (applyToAll) {
      // Apply to all items
      setBulkAction(action);
      setItems(items.map((item) => ({ ...item, action })));
    } else {
      // Apply to single item
      setItems(items.map((item, i) => i === index ? { ...item, action } : item));
    }
  };

  const handleApplyToAllChange = (checked: boolean) => {
    setApplyToAll(checked);
    if (checked) {
      // Apply current bulk action to all
      setItems(items.map((item) => ({ ...item, action: bulkAction })));
    }
  };

  const handleConfirm = () => {
    onConfirm(items);
  };

  const modalRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key !== 'Tab' || !modalRef.current) return;
    const focusable = Array.from(modalRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 pb-28">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicate-modal-title"
        className="bg-[#111111] border border-zinc-800 rounded-2xl w-full max-w-lg max-h-[70vh] flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h2 id="duplicate-modal-title" className="text-lg font-medium text-white">Duplicates Found</h2>
              <p className="text-zinc-500 text-sm">
                {duplicates.length} track{duplicates.length === 1 ? '' : 's'} already exist in your library
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <p className="text-zinc-400 text-sm mb-4">
            The following tracks already exist in your library. Choose what to do with each:
          </p>

          <div className="space-y-4">
            {items.map((item, index) => (
              <div
                key={`${item.fileName}-${index}`}
                className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800/50"
              >
                <div className="mb-3">
                  <p className="text-white font-medium truncate">{item.title}</p>
                  <p className="text-zinc-500 text-sm truncate">
                    {item.artist || 'Unknown Artist'}
                  </p>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => handleActionChange(index, 'skip')}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      item.action === 'skip'
                        ? 'bg-zinc-700 text-white'
                        : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-white'
                    }`}
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => handleActionChange(index, 'add')}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      item.action === 'add'
                        ? 'bg-zinc-700 text-white'
                        : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-white'
                    }`}
                  >
                    Add Anyway
                  </button>
                  <button
                    onClick={() => handleActionChange(index, 'replace')}
                    className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      item.action === 'replace'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-white'
                    }`}
                  >
                    Replace
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800">
          {/* Apply to all checkbox */}
          <label className="flex items-center gap-2 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => handleApplyToAllChange(e.target.checked)}
              className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-white focus:ring-0 focus:ring-offset-0"
            />
            <span className="text-sm text-zinc-400">Apply same action to all duplicates</span>
          </label>

          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 px-4 py-2.5 rounded-xl bg-white text-black font-medium hover:bg-zinc-200 transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DuplicateModal;
