
export type Page = 'home' | 'library' | 'liked' | 'playlists' | 'playlist-detail' | 'search' | 'settings' | 'admin';

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
