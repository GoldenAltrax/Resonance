import { useState, useEffect, useRef, useCallback, FormEvent } from 'react';
import {
  Search as SearchIcon, Link2, Plus, Check, Clock, Loader2, AlertCircle, RotateCw, X, Disc3, Music, Download, ListPlus,
} from 'lucide-react';
import {
  api, CatalogSong, CatalogAlbum, DownloadJob, DownloadStatus, EnqueueResult,
} from '@/services/api';
import { usePlaylistStore } from '@/stores/playlistStore';
import { toast } from '@/stores/toastStore';
import { formatDuration } from '@/utils/time';
import { navigate } from '@/utils/router';

const ACTIVE: DownloadStatus[] = ['queued', 'searching', 'downloading', 'importing'];

const isLink = (value: string) => /^https?:\/\/\S+$/i.test(value.trim());

function describeResult(r: EnqueueResult): string {
  const parts: string[] = [];
  if (r.queued) parts.push(`${r.queued} song${r.queued === 1 ? '' : 's'} queued`);
  if (r.alreadyInLibrary) parts.push(`${r.alreadyInLibrary} already in library`);
  if (r.alreadyQueued) parts.push(`${r.alreadyQueued} already queued`);
  return parts.join(', ') || 'Nothing new to add';
}

const STATUS_LABEL: Record<DownloadStatus, string> = {
  queued: 'Queued',
  searching: 'Finding',
  downloading: 'Downloading',
  importing: 'Adding',
  done: 'Added',
  skipped: 'In library',
  failed: 'Failed',
};

const Cover = ({ url, className = 'w-12 h-12' }: { url?: string | null; className?: string }) => (
  <div className={`${className} rounded-lg overflow-hidden bg-zinc-800 flex-shrink-0 flex items-center justify-center`}>
    {url ? (
      <img src={url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
    ) : (
      <Music className="w-5 h-5 text-zinc-600" />
    )}
  </div>
);

const StatusChip = ({ status }: { status: DownloadStatus }) => {
  const busy = status === 'searching' || status === 'downloading' || status === 'importing';
  const tone =
    status === 'done' ? 'text-emerald-400 bg-emerald-500/10'
    : status === 'failed' ? 'text-red-400 bg-red-500/10'
    : busy ? 'text-sky-300 bg-sky-500/10'
    : 'text-zinc-400 bg-zinc-800/80';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${tone}`}>
      {busy && <Loader2 className="w-3 h-3 animate-spin" />}
      {status === 'queued' && <Clock className="w-3 h-3" />}
      {status === 'done' && <Check className="w-3 h-3" />}
      {status === 'failed' && <AlertCircle className="w-3 h-3" />}
      {STATUS_LABEL[status]}
    </span>
  );
};

const AddMusicView = () => {
  const [input, setInput] = useState('');
  const [tab, setTab] = useState<'songs' | 'albums'>('songs');
  const [songs, setSongs] = useState<CatalogSong[]>([]);
  const [albums, setAlbums] = useState<CatalogAlbum[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [addingAlbum, setAddingAlbum] = useState<string | null>(null);

  const [createPlaylist, setCreatePlaylist] = useState(true);
  const [importing, setImporting] = useState(false);

  const [jobs, setJobs] = useState<DownloadJob[]>([]);
  const [counts, setCounts] = useState<Partial<Record<DownloadStatus, number>>>({});
  const [downloader, setDownloader] = useState<{ available: boolean; ytdlpVersion: string | null } | null>(null);
  const [updating, setUpdating] = useState(false);

  const searchSeq = useRef(0);
  const finishedCount = useRef<number | null>(null);
  const linkMode = isLink(input);
  const activeCount = ACTIVE.reduce((n, s) => n + (counts[s] ?? 0), 0);

  // ── Download queue: poll quickly while something is running, slowly otherwise ──
  const loadJobs = useCallback(async () => {
    try {
      const data = await api.getDownloadJobs();
      setJobs(data.jobs);
      setCounts(data.counts);
      // New songs landed: refresh the library (and playlists, for playlist imports)
      const finished = data.counts.done ?? 0;
      if (finishedCount.current !== null && finished > finishedCount.current) {
        const { fetchLibrary, fetchPlaylists } = usePlaylistStore.getState();
        fetchLibrary();
        fetchPlaylists();
      }
      finishedCount.current = finished;
    } catch {
      // Keep the last list; the next poll retries
    }
  }, []);

  useEffect(() => {
    loadJobs();
    api.getDownloaderStatus().then(setDownloader).catch(() => setDownloader(null));
  }, [loadJobs]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') loadJobs();
    }, activeCount > 0 ? 2500 : 15000);
    return () => clearInterval(timer);
  }, [activeCount, loadJobs]);

  // ── Catalog search (debounced; links are handled on submit instead) ──
  useEffect(() => {
    const q = input.trim();
    if (!q || linkMode) {
      setSongs([]);
      setAlbums([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.searchCatalog(q, tab);
        if (seq !== searchSeq.current) return;
        if (tab === 'songs') setSongs(data.songs ?? []);
        else setAlbums(data.albums ?? []);
        setSearchError(null);
      } catch (err) {
        if (seq !== searchSeq.current) return;
        setSearchError(err instanceof Error ? err.message : 'Search failed');
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [input, tab, linkMode]);

  const songKey = (s: CatalogSong) => s.externalId ?? `${s.title}|${s.artist}`;

  const handleAddSong = async (song: CatalogSong) => {
    const key = songKey(song);
    setRequested((prev) => new Set(prev).add(key));
    try {
      const { inLibrary: _l, queued: _q, ...track } = song;
      const result = await api.requestDownloads({ tracks: [track] });
      if (!result.queued) toast.info(describeResult(result));
      loadJobs();
    } catch (err) {
      setRequested((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      toast.error(err instanceof Error ? err.message : 'Could not add song');
    }
  };

  const handleAddAlbum = async (album: CatalogAlbum) => {
    setAddingAlbum(album.id);
    try {
      const result = await api.requestDownloads({ albumId: album.id });
      toast.success(`${album.title}: ${describeResult(result)}`);
      loadJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add album');
    } finally {
      setAddingAlbum(null);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!linkMode || importing) return;
    setImporting(true);
    try {
      const result = await api.importLink(input.trim(), createPlaylist);
      toast.success(`${result.label ?? 'Link'}: ${describeResult(result)}`);
      if (result.playlistId) {
        usePlaylistStore.getState().fetchPlaylists();
        toast.info('Playlist created; songs appear in it as they finish');
      }
      setInput('');
      loadJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not import that link');
    } finally {
      setImporting(false);
    }
  };

  const runJobAction = async (action: () => Promise<unknown>, errorMessage: string) => {
    try {
      await action();
      loadJobs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : errorMessage);
    }
  };

  const handleUpdateDownloader = async () => {
    setUpdating(true);
    try {
      const { ytdlpVersion } = await api.updateDownloader();
      setDownloader({ available: ytdlpVersion !== null, ytdlpVersion });
      toast.success(`Downloader updated${ytdlpVersion ? ` to ${ytdlpVersion}` : ''}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setUpdating(false);
    }
  };

  const failedCount = counts.failed ?? 0;
  const finishedTotal = (counts.done ?? 0) + (counts.skipped ?? 0) + failedCount;

  return (
    <div>
      <p className="mb-6 text-zinc-500 text-sm">
        Search for a song or album, or paste a link from YouTube, YouTube Music, Spotify, Apple Music or Deezer.
      </p>

      {downloader && !downloader.available && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            The downloader (yt-dlp) isn't installed on the server, so requests will fail. The Docker image includes it;
            for local development run <code className="font-mono">brew install yt-dlp</code>.
          </span>
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── Search / link ── */}
        <section className="min-w-0">
          <form onSubmit={handleSubmit} className="mb-4">
            <div className="relative">
              {linkMode ? (
                <Link2 className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
              ) : (
                <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500" />
              )}
              <input
                type="text"
                inputMode="search"
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Artist, song, album, or a link"
                aria-label="Search for music or paste a link"
                className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl pl-12 pr-11 py-3.5 text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
              />
              {input && (
                <button
                  type="button"
                  onClick={() => setInput('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-white"
                  aria-label="Clear"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {linkMode && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
                <label className="flex items-center gap-2 text-sm text-zinc-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={createPlaylist}
                    onChange={(e) => setCreatePlaylist(e.target.checked)}
                    className="accent-white"
                  />
                  If it's a playlist, also create it in Resonance
                </label>
                <button
                  type="submit"
                  disabled={importing}
                  className="flex items-center gap-2 px-5 py-2.5 bg-white text-black rounded-xl text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50"
                >
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {importing ? 'Reading link…' : 'Import'}
                </button>
              </div>
            )}
          </form>

          {!linkMode && (
            <>
              <div className="flex gap-2 mb-4" role="tablist">
                {(['songs', 'albums'] as const).map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
                      tab === t ? 'bg-white text-black font-medium' : 'bg-zinc-900/60 text-zinc-400 hover:text-white'
                    }`}
                  >
                    {t === 'songs' ? 'Songs' : 'Albums'}
                  </button>
                ))}
              </div>

              {searching && (
                <div className="flex items-center gap-2 text-sm text-zinc-500 py-6">
                  <Loader2 className="w-4 h-4 animate-spin" /> Searching…
                </div>
              )}
              {!searching && searchError && <p className="text-sm text-red-400 py-6">{searchError}</p>}

              {!searching && !searchError && !input.trim() && (
                <div className="text-sm text-zinc-500 py-10 text-center border border-dashed border-zinc-800 rounded-2xl px-6">
                  Songs are downloaded from YouTube Music in their original quality, tagged with the official title,
                  album and cover, and added to the shared library.
                </div>
              )}

              {!searching && !searchError && input.trim() && tab === 'songs' && (
                <ul className="divide-y divide-zinc-800/50">
                  {songs.length === 0 && <li className="py-6 text-sm text-zinc-500">No songs found.</li>}
                  {songs.map((song) => {
                    const key = songKey(song);
                    const isQueued = song.queued || requested.has(key);
                    return (
                      <li key={key} className="flex items-center gap-3 py-2.5">
                        <Cover url={song.coverUrl} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-white truncate">{song.title}</p>
                          <p className="text-xs text-zinc-500 truncate">
                            {song.artist}{song.album ? ` · ${song.album}` : ''}
                          </p>
                        </div>
                        {song.duration ? (
                          <span className="text-xs text-zinc-600 tabular-nums hidden sm:block">{formatDuration(song.duration)}</span>
                        ) : null}
                        {song.inLibrary ? (
                          <span className="flex items-center gap-1 text-xs text-zinc-500 w-24 justify-end">
                            <Check className="w-3.5 h-3.5" /> In library
                          </span>
                        ) : isQueued ? (
                          <span className="flex items-center gap-1 text-xs text-sky-300 w-24 justify-end">
                            <Clock className="w-3.5 h-3.5" /> Queued
                          </span>
                        ) : (
                          <button
                            onClick={() => handleAddSong(song)}
                            className="flex items-center justify-center gap-1 w-24 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-200 hover:bg-white hover:text-black transition-colors"
                            aria-label={`Add ${song.title}`}
                          >
                            <Plus className="w-3.5 h-3.5" /> Add
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {!searching && !searchError && input.trim() && tab === 'albums' && (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {albums.length === 0 && <li className="py-6 text-sm text-zinc-500">No albums found.</li>}
                  {albums.map((album) => (
                    <li key={album.id} className="flex items-center gap-3 p-3 rounded-xl bg-zinc-900/40 border border-zinc-800/60">
                      <Cover url={album.coverUrl} className="w-16 h-16" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white truncate">{album.title}</p>
                        <p className="text-xs text-zinc-500 truncate">{album.artist}</p>
                        <p className="text-[11px] text-zinc-600">
                          {[album.year, `${album.trackCount} song${album.trackCount === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <button
                        onClick={() => handleAddAlbum(album)}
                        disabled={addingAlbum === album.id}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-200 hover:bg-white hover:text-black transition-colors disabled:opacity-50"
                        aria-label={`Add album ${album.title}`}
                      >
                        {addingAlbum === album.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ListPlus className="w-3.5 h-3.5" />}
                        Add album
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {/* ── Download queue ── */}
        <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <div className="bg-zinc-900/30 border border-zinc-800/50 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-800/50">
              <div>
                <h2 className="text-sm font-semibold text-white">Downloads</h2>
                <p className="text-[11px] text-zinc-500">
                  {activeCount > 0 ? `${activeCount} in progress` : jobs.length ? 'All done' : 'Nothing yet'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                {failedCount > 0 && (
                  <button
                    onClick={() => runJobAction(() => api.retryFailedDownloads(), 'Retry failed')}
                    className="px-2.5 py-1 rounded-lg text-xs text-zinc-300 hover:bg-zinc-800"
                  >
                    Retry failed
                  </button>
                )}
                {finishedTotal > 0 && (
                  <button
                    onClick={() => runJobAction(() => api.clearFinishedDownloads(), 'Could not clear')}
                    className="px-2.5 py-1 rounded-lg text-xs text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
                  >
                    Clear finished
                  </button>
                )}
              </div>
            </div>

            <ul className="divide-y divide-zinc-800/40 max-h-[60vh] overflow-y-auto">
              {jobs.length === 0 && (
                <li className="px-4 py-8 text-center text-xs text-zinc-600">Songs you add show up here.</li>
              )}
              {jobs.map((job) => (
                <li key={job.id} className="flex items-start gap-3 px-4 py-2.5">
                  <Cover url={job.coverUrl} className="w-9 h-9" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{job.title}</p>
                    <p className="text-[11px] text-zinc-500 truncate">
                      {job.artist}{job.batchLabel ? ` · ${job.batchLabel}` : ''}
                    </p>
                    {job.error && (
                      <p className={`text-[11px] mt-0.5 ${job.status === 'failed' ? 'text-red-400/90' : 'text-zinc-600'}`}>{job.error}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusChip status={job.status} />
                    <div className="flex items-center gap-0.5">
                      {job.status === 'failed' && (
                        <button
                          onClick={() => runJobAction(() => api.retryDownload(job.id), 'Retry failed')}
                          className="p-1 text-zinc-500 hover:text-white"
                          title="Retry"
                          aria-label={`Retry ${job.title}`}
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {(job.status === 'queued' || !ACTIVE.includes(job.status)) && (
                        <button
                          onClick={() => runJobAction(() => api.removeDownload(job.id), 'Could not remove')}
                          className="p-1 text-zinc-600 hover:text-white"
                          title="Remove from list"
                          aria-label={`Remove ${job.title} from list`}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-zinc-800/50 text-[11px] text-zinc-600">
              <span className="truncate">
                {downloader?.ytdlpVersion ? `yt-dlp ${downloader.ytdlpVersion}` : 'Downloader status unknown'}
              </span>
              <div className="flex items-center gap-3">
                <button onClick={() => navigate('library')} className="hover:text-zinc-300 flex items-center gap-1">
                  <Disc3 className="w-3 h-3" /> Library
                </button>
                {downloader?.available && (
                  <button onClick={handleUpdateDownloader} disabled={updating} className="hover:text-zinc-300 disabled:opacity-50">
                    {updating ? 'Updating…' : 'Update'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default AddMusicView;
