// VidSrc integration: player URLs, the "latest added" feed and title info.
// API reference: https://vsembed.ru/vidsrc/docs/
import { VIDSRC_MIRRORS } from './config.js';
import { normalize, tmdb } from './tmdb.js';

const MIRROR_KEY = 'fm:mirror';
const LATEST_KEY = 'fm:latest:v1';
const LATEST_TTL = 30 * 60 * 1000;

/** The player host this viewer picked, or the default. */
export function currentMirror() {
  let saved = null;
  try { saved = localStorage.getItem(MIRROR_KEY); } catch (error) { /* storage blocked */ }
  return VIDSRC_MIRRORS.includes(saved) ? saved : VIDSRC_MIRRORS[0];
}

export function setMirror(mirror) {
  if (!VIDSRC_MIRRORS.includes(mirror)) return;
  try { localStorage.setItem(MIRROR_KEY, mirror); } catch (error) { /* storage blocked */ }
}

/** Path of the player for a title, without the mirror's host. */
export function embedPath(mediaType, tmdbId, season, episode) {
  if (mediaType === 'movie') return `/embed/movie/${tmdbId}`;
  return season && episode ? `/embed/tv/${tmdbId}/${season}/${episode}` : `/embed/tv/${tmdbId}`;
}

/** Full player URL. `startAt` (seconds) resumes playback from a saved position. */
export function embedUrl(mirror, mediaType, tmdbId, season, episode, startAt = 0) {
  const params = ['autoplay=1'];
  if (mediaType === 'tv') params.push('autonext=0'); // the watch page handles "next episode"
  if (startAt > 0) params.push(`startAt=${Math.floor(startAt)}`);
  return `${mirror}${embedPath(mediaType, tmdbId, season, episode)}?${params.join('&')}`;
}

function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Ask VidSrc about one title: GET /info/{movie|tv}/{id}.json.
 * Resolves to { available: true, quality } or { available: false }, or null
 * when VidSrc can't be reached.
 */
export async function titleInfo(mediaType, tmdbId) {
  try {
    const response = await fetchWithTimeout(`${currentMirror()}/info/${mediaType}/${tmdbId}.json`, 6000);
    if (response.status === 404) return { available: false };
    if (!response.ok) return null;
    const info = await response.json();
    return { available: true, quality: typeof info.quality === 'string' ? info.quality : '' };
  } catch (error) {
    return null;
  }
}

/**
 * Movies most recently added to VidSrc (GET /movies/latest/page-1.json),
 * with TMDB artwork. Resolves to [] when the feed can't be read, so the home
 * page simply leaves the row out. Cached for 30 minutes per tab.
 */
export async function latestMovies(limit = 20) {
  try {
    const cached = JSON.parse(sessionStorage.getItem(LATEST_KEY));
    if (cached && Date.now() - cached.at < LATEST_TTL && Array.isArray(cached.items)) return cached.items;
  } catch (error) { /* no cache */ }

  let rows = [];
  try {
    const response = await fetchWithTimeout(`${currentMirror()}/movies/latest/page-1.json`, 6000);
    if (!response.ok) return [];
    rows = (await response.json()).result || [];
  } catch (error) {
    return [];
  }

  const picked = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = parseInt(row && row.tmdb_id, 10); // the feed allows a null TMDB id
    if (!(id > 0) || seen.has(id)) continue;
    seen.add(id);
    picked.push({ id, quality: typeof row.quality === 'string' ? row.quality : '' });
    if (picked.length >= limit) break;
  }

  const details = await Promise.all(picked.map(({ id }) => tmdb(`/movie/${id}`).catch(() => null)));
  const items = [];
  picked.forEach(({ quality }, index) => {
    const entry = normalize(details[index], 'movie');
    if (entry && entry.poster_path) items.push({ ...entry, quality });
  });

  try { sessionStorage.setItem(LATEST_KEY, JSON.stringify({ at: Date.now(), items })); } catch (error) { /* ignore */ }
  return items;
}
