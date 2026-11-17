// Watch page: loads the VidSrc player, saves your position as you watch,
// and resumes from it next time.
//
// VidSrc API (https://vsembed.ru/vidsrc/docs/):
//   - the player posts { type: 'PLAYER_EVENT', data: { player_info,
//     player_status, player_progress, player_duration } } to this page;
//     status is playing (about every 5s), paused, seeked or completed
//   - ?startAt=<seconds> starts playback at a saved position
import { MIN_RESUME_SECONDS, resumeSeconds } from './store.js';
import { clock } from './util.js';
import { blockPopups, currentMirror, embedUrl, PLAYER_SANDBOX, setBlockPopups, setMirror } from './vidsrc.js';

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
  const popupToggle = root.querySelector('[data-block-popups]');
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
    // The sandbox must be set before src: it can't be changed once a frame loads.
    if (blockPopups()) fresh.setAttribute('sandbox', PLAYER_SANDBOX);
    else fresh.removeAttribute('sandbox');
    fresh.src = embedUrl(currentMirror(), title.mediaType, title.tmdbId, title.season, title.episode, startedAt);
    frame.replaceWith(fresh);
    frame = fresh;
    resumeBar.hidden = startedAt === 0;
    resumeTime.textContent = clock(startedAt);
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
    const message = event.data;
    if (!message || message.type !== 'PLAYER_EVENT' || !message.data || typeof message.data !== 'object') return;
    if (!fromPlayer(event.source)) return;

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

  // Reload the player where you are, after a server or pop-up setting change.
  function reloadInPlace() {
    const position = latest && latest.status !== 'completed' ? latest.progress : startedAt;
    load(position >= MIN_RESUME_SECONDS ? position : 0);
  }

  function onMirrorChange() {
    setMirror(mirrorSelect.value);
    reloadInPlace();
  }

  function onPopupToggle() {
    setBlockPopups(popupToggle.checked);
    reloadInPlace();
  }

  window.addEventListener('message', onMessage);
  restartButton.addEventListener('click', onRestart);
  mirrorSelect.value = currentMirror();
  mirrorSelect.addEventListener('change', onMirrorChange);
  popupToggle.checked = blockPopups();
  popupToggle.addEventListener('change', onPopupToggle);
  upNext.querySelector('[data-up-next-cancel]').addEventListener('click', hideUpNext);

  load(resumeSeconds(store.get(title.mediaType, title.tmdbId, title.season, title.episode)));

  return function unmount() {
    window.removeEventListener('message', onMessage);
    hideUpNext();
    frame.remove(); // stops playback
  };
}
