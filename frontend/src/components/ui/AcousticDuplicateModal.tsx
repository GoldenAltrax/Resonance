import { useRef, useCallback, useEffect } from 'react';
import { X, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { AcousticDuplicate } from '@/types/index';

export interface PendingDuplicate {
  file: File;
  duplicate: AcousticDuplicate;
}

interface AcousticDuplicateModalProps {
  isOpen: boolean;
  pendingDuplicates: PendingDuplicate[];
  onClose: () => void;
  onUploadAnyway: (file: File) => Promise<void>;
}

function ScoreBar({ score }: { score: number }) {
  const isStrong = score >= 85;
  const filled = Math.round(score / 5); // 20 segments

  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-0.5">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className={`h-2 w-2.5 rounded-sm ${
              i < filled
                ? isStrong
                  ? 'bg-red-500'
                  : 'bg-amber-500'
                : 'bg-zinc-800'
            }`}
          />
        ))}
      </div>
      <span
        className={`text-sm font-semibold ${
          isStrong ? 'text-red-400' : 'text-amber-400'
        }`}
      >
        {score}% — {isStrong ? 'STRONG MATCH' : 'POSSIBLE MATCH'}
      </span>
    </div>
  );
}

function BreakdownRow({ label, matched, detail }: { label: string; matched: boolean; detail: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      {matched ? (
        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
      ) : (
        <XCircle className="w-4 h-4 text-zinc-600 shrink-0" />
      )}
      <span className={matched ? 'text-zinc-300' : 'text-zinc-600'}>
        <span className="font-medium">{label}</span>
        {matched && <span className="text-zinc-500"> — {detail}</span>}
      </span>
    </div>
  );
}

const AcousticDuplicateModal = ({
  isOpen,
  pendingDuplicates,
  onClose,
  onUploadAnyway,
}: AcousticDuplicateModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key !== 'Tab' || !modalRef.current) return;
    const focusable = Array.from(
      modalRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
    if (!focusable.length) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('keydown', handleKeyDown);
    const t = setTimeout(() => modalRef.current?.querySelector<HTMLButtonElement>('button')?.focus(), 0);
    return () => { document.removeEventListener('keydown', handleKeyDown); clearTimeout(t); };
  }, [isOpen, handleKeyDown]);

  if (!isOpen || !pendingDuplicates.length) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 pb-28">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="acoustic-dup-title"
        className="bg-[#111111] border border-zinc-800 rounded-2xl w-full max-w-lg max-h-[75vh] flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h2 id="acoustic-dup-title" className="text-lg font-medium text-white">
                Possible Duplicate{pendingDuplicates.length > 1 ? 's' : ''} Detected
              </h2>
              <p className="text-zinc-500 text-sm">
                {pendingDuplicates.length} track{pendingDuplicates.length > 1 ? 's were' : ' was'} flagged by acoustic analysis
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
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {pendingDuplicates.map(({ file, duplicate }, idx) => (
            <div key={idx} className="bg-zinc-900/50 rounded-xl p-4 border border-zinc-800/50 space-y-4">
              {/* Track info */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-zinc-500 text-xs uppercase tracking-wide mb-1">Uploading</p>
                  <p className="text-white font-medium truncate">{file.name.replace(/\.[^/.]+$/, '')}</p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs uppercase tracking-wide mb-1">Existing match</p>
                  <p className="text-white font-medium truncate">{duplicate.existingTrack.title}</p>
                  <p className="text-zinc-500 truncate">{duplicate.existingTrack.artist ?? 'Unknown Artist'}</p>
                </div>
              </div>

              {/* Score bar */}
              <ScoreBar score={duplicate.score} />

              {/* Breakdown */}
              <div className="space-y-2">
                <BreakdownRow label="Acoustic Fingerprint" matched={duplicate.breakdown.fingerprint} detail="identical audio content" />
                <BreakdownRow label="MusicBrainz ID" matched={duplicate.breakdown.mbid} detail="same recording, confirmed cross-source" />
                <BreakdownRow label="Duration" matched={duplicate.breakdown.duration} detail="within 2 seconds" />
                <BreakdownRow label="Title / Artist" matched={duplicate.breakdown.title} detail="exact match" />
                <BreakdownRow label="Filename" matched={duplicate.breakdown.filename} detail="exact match" />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => onUploadAnyway(file)}
                  className="flex-1 px-4 py-2 rounded-xl border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors text-sm"
                >
                  Upload Anyway
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="w-full px-4 py-2.5 rounded-xl bg-white text-black font-medium hover:bg-zinc-200 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

export default AcousticDuplicateModal;
