// Watch history, kept in this browser's localStorage.
//
// One entry per movie, or per TV episode, that has been started. The watch
// page keeps `progress` up to date from the player's events, which is what
// powers "Continue watching" and resume.

export const COMPLETE_AT = 0.92;        // past this share of the runtime, count it as watched
export const MIN_RESUME_SECONDS = 15;   // don't bother resuming from the first few seconds
const STORAGE_KEY = 'fm:history:v1';
const MAX_ENTRIES = 500;

export function entryKey(mediaType, tmdbId, season, episode) {
  return mediaType === 'tv' && season && episode
    ? `tv:${tmdbId}:${season}:${episode}`
    : `${mediaType}:${tmdbId}`;
}

export function isEpisode(entry) {
  return entry.mediaType === 'tv' && Boolean(entry.season) && Boolean(entry.episode);
}

/** Share watched, 0-100. */
export function percent(entry) {
  if (!entry) return 0;
  if (entry.completed) return 100;
  if (!(entry.duration > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((entry.progress / entry.duration) * 100)));
}

/** Where the player should start: 0 means from the beginning. */
export function resumeSeconds(entry) {
  if (!entry || entry.completed || !(entry.progress >= MIN_RESUME_SECONDS)) return 0;
  return Math.floor(entry.progress);
}

export function minutesLeft(entry) {
  if (!entry || entry.completed || !(entry.duration > 0)) return null;
  return Math.max(1, Math.round((entry.duration - entry.progress) / 60));
}

/** Address of the page that plays an entry. */
export function watchHash(entry) {
  if (entry.mediaType === 'movie') return `#/movie/${entry.tmdbId}/watch`;
  return isEpisode(entry) ? `#/tv/${entry.tmdbId}/${entry.season}/${entry.episode}` : `#/tv/${entry.tmdbId}`;
}

function seconds(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 86400) : 0;
}

export function createStore(storage, now = () => Date.now()) {
  function read() {
    try {
      const data = JSON.parse(storage.getItem(STORAGE_KEY));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (error) {
      return {}; // nothing saved yet, storage blocked, or bad data
    }
  }

  function write(entries) {
    const keys = Object.keys(entries);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => entries[b].updatedAt - entries[a].updatedAt)
        .slice(MAX_ENTRIES)
        .forEach((key) => delete entries[key]);
    }
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(entries));
      return true;
    } catch (error) {
      return false; // storage full or blocked: the page still works, it just forgets
    }
  }

  /** Every entry, most recently watched first. */
  function all() {
    return Object.values(read()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function get(mediaType, tmdbId, season, episode) {
    return read()[entryKey(mediaType, tmdbId, season, episode)] || null;
  }

  /**
   * Create or refresh an entry when its watch page opens. Keeps any saved
   * position, so reopening a title never loses your place.
   */
  function recordStart(mediaType, tmdbId, season, episode, details = {}) {
    const entries = read();
    const key = entryKey(mediaType, tmdbId, season, episode);
    const entry = entries[key] || {
      key, mediaType, tmdbId,
      season: mediaType === 'tv' ? season : null,
      episode: mediaType === 'tv' ? episode : null,
      progress: 0, duration: 0, completed: false, startedAt: now(),
    };
    Object.assign(entry, details, { updatedAt: now() });
    entries[key] = entry;
    write(entries);
    return entry;
  }

  /** Record a playback position reported by the player. */
  function setProgress(mediaType, tmdbId, season, episode, { progress, duration, finished } = {}) {
    const entries = read();
    const key = entryKey(mediaType, tmdbId, season, episode);
    let entry = entries[key];
    if (!entry) {
      // The viewer switched episode inside the player: start a row for it,
      // borrowing the artwork from one they already have for this title.
      const sibling = Object.values(entries).find((e) => e.mediaType === mediaType && e.tmdbId === tmdbId);
      if (!sibling) return null;
      entry = {
        key, mediaType, tmdbId, season, episode,
        title: sibling.title, posterPath: sibling.posterPath || null, backdropPath: null,
        progress: 0, duration: 0, completed: false, startedAt: now(),
      };
    }
    entry.progress = seconds(progress);
    if (seconds(duration) > 0) entry.duration = seconds(duration);
    const nearEnd = entry.duration > 0 && entry.progress / entry.duration >= COMPLETE_AT;
    entry.completed = Boolean(finished || nearEnd);
    entry.updatedAt = now();
    entries[key] = entry;
    write(entries);
    return entry;
  }

  function remove(key) {
    const entries = read();
    delete entries[key];
    write(entries);
  }

  /** Forget a whole title: the movie, or every episode of a show. */
  function removeTitle(mediaType, tmdbId) {
    const entries = read();
    for (const [key, entry] of Object.entries(entries)) {
      if (entry.mediaType === mediaType && entry.tmdbId === tmdbId) delete entries[key];
    }
    write(entries);
  }

  function clear() {
    write({});
  }

  /** Episodes of one show that have been started, newest first. */
  function episodesOf(tmdbId) {
    return all().filter((entry) => entry.tmdbId === tmdbId && isEpisode(entry));
  }

  /**
   * Cards for the "Continue watching" row: one per title, newest first.
   * A half-watched movie or episode resumes where it stopped. A finished
   * episode hands over to the next one. Finished movies and finished series
   * drop out.
   */
  function continueWatching(limit = 20) {
    const cards = [];
    const seen = new Set();
    for (const entry of all()) {
      const titleKey = `${entry.mediaType}:${entry.tmdbId}`;
      if (seen.has(titleKey)) continue;
      seen.add(titleKey);

      const card = {
        mediaType: entry.mediaType,
        tmdbId: entry.tmdbId,
        title: entry.title || 'Untitled',
        imagePath: entry.backdropPath || entry.posterPath || null,
        isPoster: !entry.backdropPath,
        label: isEpisode(entry) ? `S${entry.season} E${entry.episode}` : '',
        percent: percent(entry),
        minutesLeft: minutesLeft(entry),
        hash: watchHash(entry),
      };
      if (entry.completed) {
        if (!(isEpisode(entry) && entry.nextSeason && entry.nextEpisode)) continue;
        card.label = `Next: S${entry.nextSeason} E${entry.nextEpisode}`;
        card.percent = 0;
        card.minutesLeft = null;
        card.hash = `#/tv/${entry.tmdbId}/${entry.nextSeason}/${entry.nextEpisode}`;
      }
      cards.push(card);
      if (cards.length >= limit) break;
    }
    return cards;
  }

  return { all, get, recordStart, setProgress, remove, removeTitle, clear, episodesOf, continueWatching };
}
