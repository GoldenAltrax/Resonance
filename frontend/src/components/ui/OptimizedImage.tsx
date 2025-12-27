import { useState, useCallback, ImgHTMLAttributes } from 'react';

interface OptimizedImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'onLoad' | 'onError'> {
  src: string;
  alt: string;
  fallback?: React.ReactNode;
  containerClassName?: string;
  showPlaceholder?: boolean;
}

/**
 * OptimizedImage component with:
 * - Native lazy loading (loading="lazy")
 * - Async decoding for better performance
 * - Fade-in animation when loaded
 * - Optional placeholder while loading
 * - Error fallback support
 */
const OptimizedImage = ({
  src,
  alt,
  className = '',
  containerClassName = '',
  fallback,
  showPlaceholder = true,
  ...props
}: OptimizedImageProps) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
  }, []);

  const handleError = useCallback(() => {
    setHasError(true);
  }, []);

  if (hasError && fallback) {
    return <>{fallback}</>;
  }

  return (
    <div className={`relative overflow-hidden ${containerClassName}`}>
      {/* Placeholder background */}
      {showPlaceholder && !isLoaded && (
        <div className="absolute inset-0 bg-zinc-800 animate-pulse" />
      )}

      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={handleLoad}
        onError={handleError}
        className={`transition-opacity duration-300 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        } ${className}`}
        {...props}
      />
    </div>
  );
};

export default OptimizedImage;
