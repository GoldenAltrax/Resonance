import { useState, useCallback, DragEvent, ReactNode } from 'react';
import { Upload } from 'lucide-react';

interface DropZoneProps {
  onFilesDropped: (files: File[]) => void;
  accept?: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}

const DropZone = ({ onFilesDropped, accept, children, className = '', disabled = false }: DropZoneProps) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragging(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set to false if we're leaving the drop zone entirely
    if (e.currentTarget === e.target) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled) return;

    const files = Array.from(e.dataTransfer.files);

    // Filter by accepted types if specified
    let filteredFiles = files;
    if (accept) {
      const acceptedTypes = accept.split(',').map(t => t.trim());
      filteredFiles = files.filter(file => {
        return acceptedTypes.some(type => {
          if (type.startsWith('.')) {
            // Extension match
            return file.name.toLowerCase().endsWith(type.toLowerCase());
          } else if (type.endsWith('/*')) {
            // Wildcard MIME type (e.g., audio/*)
            const baseType = type.slice(0, -2);
            return file.type.startsWith(baseType);
          } else {
            // Exact MIME type match
            return file.type === type;
          }
        });
      });
    }

    if (filteredFiles.length > 0) {
      onFilesDropped(filteredFiles);
    }
  }, [accept, disabled, onFilesDropped]);

  return (
    <div
      className={`relative ${className}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-zinc-900/95 backdrop-blur-sm border-2 border-dashed border-zinc-500 rounded-2xl flex flex-col items-center justify-center gap-4 pointer-events-none">
          <div className="w-16 h-16 bg-zinc-800 rounded-full flex items-center justify-center">
            <Upload className="w-8 h-8 text-zinc-400" />
          </div>
          <div className="text-center">
            <p className="text-lg font-medium text-white">Drop files to upload</p>
            <p className="text-sm text-zinc-500 mt-1">Release to add to your library</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default DropZone;
