// Watch page: loads the player, saves your position as you watch, and
// resumes from it next time.
//
// VidSrc (https://vsembed.ru/vidsrc/docs/) posts { type: 'PLAYER_EVENT',
// data: { player_info, player_status, player_progress, player_duration } }
// to this page about every 5s while playing, and on pause, seek and end.
//
// VidCore (https://vidcore.org) posts only vidcore:play, vidcore:pause and
// vidcore:ended, with no position, so on VidCore a title is marked started
// and finished but your place isn't updated.
//
// Both take ?startAt=<seconds> to open at a saved position.
import { currentServer, embedUrl, readVidcoreEvent, setServer } from './servers.js';
import { MIN_RESUME_SECONDS, resumeSeconds } from './store.js';
import { clock } from './util.js';

const UP_NEXT_SECONDS = 8;
const STATUSES = ['playing', 'paused', 'seeked', 'completed'];

function number(value) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
}

function wholeNumber(value) {
  const n = parseInt(value, 10);
  return n > 0 ? n : null;
}

/**
 * Wire up the player inside `root` (the rendered watch page).
 * `title` is { mediaType, tmdbId, season, episode, next: { hash, label } | null }.
 * Returns a function that stops everything when the viewer leaves the page.
 */
export function mountPlayer(root, title, store) {
  let frame = root.querySelector('[data-player] iframe');
  const mirrorSelect = root.querySelector('[data-mirror]');
  const serverNote = root.querySelector('[data-server-note]');
  const resumeBar = root.querySelector('[data-resume-bar]');
  const resumeTime = root.querySelector('[data-resume-time]');
  const restartButton = root.querySelector('[data-restart]');
  const upNext = root.querySelector('[data-up-next]');

  let startedAt = 0;     // the startAt we asked the player for
  let settled = true;    // false until the player has caught up to startedAt
  let loadedAt = 0;
  let latest = null;     // newest position reported by the player
  let countdown = null;

  function load(startAt) {
    startedAt = Math.max(0, Math.floor(startAt || 0));
    settled = startedAt === 0;
    loadedAt = Date.now();
    // Swap in a fresh frame instead of changing src: re-pointing a loaded frame
    // adds a step to the browser's history, which would break the Back button.
    const fresh = frame.cloneNode(false);
    const server = currentServer();
    fresh.src = embedUrl(server, title.mediaType, title.tmdbId, title.season, title.episode, startedAt);
    frame.replaceWith(fresh);
    frame = fresh;
    resumeBar.hidden = startedAt === 0;
    resumeTime.textContent = clock(startedAt);
    serverNote.hidden = server.provider !== 'vidcore';
    hideUpNext();
  }

  // True when a message came from the player frame or a frame nested in it.
  // (VidSrc's player sits a few frames deep, on hosts other than the mirror's.)
  function fromPlayer(source, win = frame.contentWindow, depth = 0) {
    if (!source || !win) return false;
    if (source === win) return true;
    if (depth >= 5) return false;
    try {
      for (let i = 0; i < win.length; i += 1) {
        if (fromPlayer(source, win[i], depth + 1)) return true;
      }
    } catch (error) { /* a frame went away mid-walk */ }
    return false;
  }

  function onMessage(event) {
    if (!fromPlayer(event.source)) return;
    const vidcore = readVidcoreEvent(event.data);
    if (vidcore) {
      onVidcoreEvent(vidcore);
      return;
    }
    const message = event.data;
    if (!message || message.type !== 'PLAYER_EVENT' || !message.data || typeof message.data !== 'object') return;

    const data = message.data;
    const info = data.player_info || {};
    const status = data.player_status;
    const progress = number(data.player_progress);
    if (progress === null || !STATUSES.includes(status)) return;
    if (info.mediaType && info.mediaType !== title.mediaType) return;

    // Right after loading with startAt, the player can report a position near
    // zero before it jumps. Don't let that overwrite the saved one.
    if (!settled) {
      const caughtUp = progress >= startedAt - 5;
      const waitedLongEnough = Date.now() - loadedAt > 30000;
      if (caughtUp || status === 'seeked' || waitedLongEnough) settled = true;
      else return;
    }

    const tv = title.mediaType === 'tv';
    latest = {
      status,
      progress,
      duration: number(data.player_duration) || (latest ? latest.duration : 0),
      // The viewer may have changed episode inside the player.
      season: tv ? (wholeNumber(info.season) || title.season) : null,
      episode: tv ? (wholeNumber(info.episode) || title.episode) : null,
    };
    store.setProgress(title.mediaType, title.tmdbId, latest.season, latest.episode, {
      progress: latest.progress,
      duration: latest.duration,
      finished: status === 'completed',
    });

    if (status === 'playing' && progress > startedAt + 60) resumeBar.hidden = true;
    if (status === 'completed') showUpNext();
    else if (status === 'playing' || status === 'seeked') hideUpNext();
  }

  // VidCore says when playback starts, pauses and ends, but not where. Save a
  // position only if the message happens to carry one; always record the end.
  function onVidcoreEvent({ status, progress, duration }) {
    const saved = store.get(title.mediaType, title.tmdbId, title.season, title.episode);
    if (status === 'completed') {
      store.setProgress(title.mediaType, title.tmdbId, title.season, title.episode, {
        progress: progress ?? (saved ? saved.duration : 0),
        duration: duration ?? (saved ? saved.duration : 0),
        finished: true,
      });
      latest = { status, progress: progress || 0, duration: duration || 0, season: title.season, episode: title.episode };
      showUpNext();
      return;
    }
    hideUpNext();
    if (progress === null) return;
    if (!settled && progress < startedAt - 5) return; // the player hasn't jumped to startAt yet
    settled = true;
    latest = { status, progress, duration: duration || (saved ? saved.duration : 0), season: title.season, episode: title.episode };
    store.setProgress(title.mediaType, title.tmdbId, title.season, title.episode, {
      progress: latest.progress, duration: latest.duration,
    });
  }

  function hideUpNext() {
    if (countdown) { clearInterval(countdown); countdown = null; }
    upNext.hidden = true;
  }

  function showUpNext() {
    if (!title.next || !upNext.hidden) return;
    const count = upNext.querySelector('[data-up-next-count]');
    let remaining = UP_NEXT_SECONDS;
    count.textContent = remaining;
    upNext.hidden = false;
    countdown = setInterval(() => {
      remaining -= 1;
      count.textContent = remaining;
      if (remaining <= 0) {
        hideUpNext();
        window.location.hash = title.next.hash;
      }
    }, 1000);
  }

  function onRestart() {
    store.setProgress(title.mediaType, title.tmdbId, title.season, title.episode, {
      progress: 0, duration: latest ? latest.duration : 0,
    });
    latest = null;
    load(0);
  }

  function onMirrorChange() {
    setServer(mirrorSelect.value);
    // Keep your place across servers.
    const position = latest && latest.status !== 'completed' ? latest.progress : startedAt;
    load(position >= MIN_RESUME_SECONDS ? position : 0);
  }

  window.addEventListener('message', onMessage);
  restartButton.addEventListener('click', onRestart);
  mirrorSelect.value = currentServer().id;
  mirrorSelect.addEventListener('change', onMirrorChange);
  upNext.querySelector('[data-up-next-cancel]').addEventListener('click', hideUpNext);

  load(resumeSeconds(store.get(title.mediaType, title.tmdbId, title.season, title.episode)));

  return function unmount() {
    window.removeEventListener('message', onMessage);
    hideUpNext();
    frame.remove(); // stops playback
  };
}
