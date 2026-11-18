// Player servers: which one the viewer picked, and how to build its URL.
//
//   VidSrc  (https://vsembed.ru/vidsrc/docs/)  /embed/movie/{id}, /embed/tv/{id}/{s}/{e}
//           ?autoplay=1&autonext=0&startAt=<seconds>; reports position every ~5s
//   VidCore (https://vidcore.org)              /embed/movie/{id}, /embed/tv/{id}/{s}/{e}
//           ?autoplay=true&startAt=<seconds>; reports only play, pause and ended
import { SERVERS, VIDSRC_MIRRORS } from './config.js';

const SERVER_KEY = 'fm:mirror'; // the name predates VidCore; kept so saved choices still apply

export function currentServer() {
  let saved = null;
  try { saved = localStorage.getItem(SERVER_KEY); } catch (error) { /* storage blocked */ }
  return SERVERS.find((server) => server.id === saved) || SERVERS[0];
}

export function setServer(id) {
  if (!SERVERS.some((server) => server.id === id)) return;
  try { localStorage.setItem(SERVER_KEY, id); } catch (error) { /* storage blocked */ }
}

/** The VidSrc host to ask for title info and the "latest" feed. */
export function vidsrcHost() {
  const server = currentServer();
  return server.provider === 'vidsrc' ? server.host : VIDSRC_MIRRORS[0];
}

/** Path of the player for a title, without the host. Both providers share it. */
export function embedPath(mediaType, tmdbId, season, episode) {
  if (mediaType === 'movie') return `/embed/movie/${tmdbId}`;
  return season && episode ? `/embed/tv/${tmdbId}/${season}/${episode}` : `/embed/tv/${tmdbId}`;
}

/** Full player URL. `startAt` (seconds) resumes playback from a saved position. */
export function embedUrl(server, mediaType, tmdbId, season, episode, startAt = 0) {
  const params = [];
  if (server.provider === 'vidcore') {
    params.push('autoplay=true');
  } else {
    params.push('autoplay=1');
    if (mediaType === 'tv') params.push('autonext=0'); // the watch page handles "next episode"
  }
  if (startAt > 0) params.push(`startAt=${Math.floor(startAt)}`);
  return `${server.host}${embedPath(mediaType, tmdbId, season, episode)}?${params.join('&')}`;
}

function finite(value) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Read a VidCore player message. VidCore documents the event names
 * (vidcore:play, vidcore:pause, vidcore:ended) but not the message's shape,
 * so this accepts either a bare string or an object naming the event, and
 * picks up a position or duration only if the message happens to carry one.
 * Returns { status, progress, duration } with status playing, paused or
 * completed, or null for anything else.
 */
export function readVidcoreEvent(data) {
  let name = null;
  let body = {};
  if (typeof data === 'string') {
    name = data;
  } else if (data && typeof data === 'object') {
    name = [data.type, data.event, data.name, data.action].find((v) => typeof v === 'string') || null;
    body = data.data && typeof data.data === 'object' ? { ...data, ...data.data } : data;
  }
  const match = /^vidcore:(play|pause|ended)$/.exec(name || '');
  if (!match) return null;
  return {
    status: { play: 'playing', pause: 'paused', ended: 'completed' }[match[1]],
    progress: finite(body.currentTime ?? body.time ?? body.progress ?? body.position),
    duration: finite(body.duration),
  };
}
