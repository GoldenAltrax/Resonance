export type Page = 'home' | 'library' | 'liked' | 'playlists' | 'playlist-detail' | 'search' | 'settings' | 'admin' | 'albums';

export interface Song {
  id: string;
  title: string;
  artist: string;
  duration: string;
  album?: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  image: string;
  songs: Song[];
}

export interface User {
  username: string;
  profileImage: string;
  email: string;
}

// ─── Acoustic Duplicate Detection ───────────────────────────────────────────

export interface AcousticDuplicateBreakdown {
  fingerprint: boolean;
  mbid: boolean;
  duration: boolean;
  title: boolean;
  filename: boolean;
}

export interface AcousticDuplicate {
  score: number;
  breakdown: AcousticDuplicateBreakdown;
  existingTrack: {
    id: string;
    title: string;
    artist: string | null;
    album: string | null;
    duration: number;
    coverArt: string | null;
  };
}

export class DuplicateError extends Error {
  constructor(public readonly duplicate: AcousticDuplicate) {
    super('Acoustic duplicate detected');
    this.name = 'DuplicateError';
  }
}
