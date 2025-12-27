import { Heart } from 'lucide-react';
import { Track } from '@/services/api';
import { useFavoritesStore } from '@/stores/favoritesStore';

interface FavoriteButtonProps {
  track: Track;
  size?: 'sm' | 'md';
  className?: string;
}

export const FavoriteButton = ({ track, size = 'md', className = '' }: FavoriteButtonProps) => {
  const { toggleFavorite, isFavorited } = useFavoritesStore();
  const favorited = isFavorited(track.id);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite(track);
  };

  const iconSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';

  return (
    <button
      onClick={handleClick}
      className={`transition-all duration-200 ${className} ${
        favorited
          ? 'text-pink-500 hover:text-pink-400 scale-110'
          : 'text-zinc-500 hover:text-pink-500 hover:scale-110'
      }`}
      title={favorited ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
    >
      <Heart
        className={`${iconSize} transition-transform ${favorited ? 'fill-current' : ''}`}
      />
    </button>
  );
};

export default FavoriteButton;
