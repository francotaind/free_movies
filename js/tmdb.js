// Client for The Movie Database (TMDB) API, called straight from the browser.
import { IMAGE_BASE, TMDB_API, TMDB_API_KEY } from './config.js';

const cache = new Map(); // URL -> promise, for the life of the page

/** GET a TMDB path. Rejects with an Error carrying .status on failure. */
export function tmdb(path, params = {}) {
  const url = new URL(TMDB_API + path);
  url.searchParams.set('api_key', TMDB_API_KEY);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, value);
  }
  const key = url.toString();
  if (!cache.has(key)) {
    const request = fetch(key).then((response) => {
      if (!response.ok) {
        const error = new Error(`TMDB answered ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return response.json();
    });
    request.catch(() => cache.delete(key)); // let a failed request be retried
    cache.set(key, request);
  }
  return cache.get(key);
}

/** Full image URL for a poster/backdrop path, or '' when missing. */
export function img(path, size = 'w342') {
  return path ? `${IMAGE_BASE}${size}${path}` : '';
}

/** Flatten a movie or TV result into the shape the cards use. */
export function normalize(item, mediaType) {
  const kind = mediaType || (item && item.media_type);
  if (!item || !item.id || (kind !== 'movie' && kind !== 'tv')) return null;
  const date = item.release_date || item.first_air_date || '';
  return {
    id: item.id,
    media_type: kind,
    title: item.title || item.name || 'Untitled',
    year: date.slice(0, 4),
    poster_path: item.poster_path || null,
    backdrop_path: item.backdrop_path || null,
    rating: Math.round((item.vote_average || 0) * 10) / 10,
    overview: item.overview || '',
  };
}

export function normalizeList(items, mediaType) {
  return (items || []).map((item) => normalize(item, mediaType)).filter((entry) => entry && entry.poster_path);
}
