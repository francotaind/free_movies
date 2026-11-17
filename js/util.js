// Small formatting helpers.

/** Seconds as a timestamp: 754 -> 12:34, 5025 -> 1:23:45. */
export function clock(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Minutes as a running time: 134 -> 2h 14m. */
export function runtime(minutes) {
  const total = Math.floor(Number(minutes) || 0);
  if (total <= 0) return '';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  return h ? `${h}h` : `${m}m`;
}

/** How long ago, in words: "Just now", "3 hours ago". */
export function ago(timestamp, now = Date.now()) {
  const seconds = Math.max(0, (now - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const steps = [[60, 'minute'], [60, 'hour'], [24, 'day'], [7, 'week'], [4.345, 'month'], [12, 'year']];
  let value = seconds;
  let unit = 'second';
  for (const [size, name] of steps) {
    if (value < size) break;
    value /= size;
    unit = name;
  }
  const whole = Math.floor(value);
  return `${whole} ${unit}${whole === 1 ? '' : 's'} ago`;
}

export function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/** Clamp a ?page= value to what TMDB accepts (1-500). */
export function pageNumber(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(500, n)) : 1;
}

/** Today's date as YYYY-MM-DD, for comparing with TMDB air dates. */
export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
