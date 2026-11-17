// Run with: npm test (or: node --test)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { esc, html, raw } from '../js/html.js';
import { createStore, minutesLeft, percent, resumeSeconds, watchHash } from '../js/store.js';
import { ago, clock, pageNumber, runtime } from '../js/util.js';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

function setup() {
  let time = 1_000_000;
  const store = createStore(fakeStorage(), () => (time += 1000));
  return store;
}

const MATRIX = { title: 'The Matrix', posterPath: '/m.jpg', backdropPath: '/mb.jpg' };
const GOT = { title: 'Game of Thrones', posterPath: '/g.jpg', backdropPath: '/s.jpg' };

test('opening a title records it once and keeps the saved position', () => {
  const store = setup();
  store.recordStart('movie', 603, null, null, MATRIX);
  store.setProgress('movie', 603, null, null, { progress: 1500.4, duration: 8160 });
  store.recordStart('movie', 603, null, null, MATRIX);

  assert.equal(store.all().length, 1);
  const entry = store.get('movie', 603);
  assert.equal(resumeSeconds(entry), 1500);
  assert.equal(percent(entry), 18);
  assert.equal(minutesLeft(entry), 111);
  assert.equal(watchHash(entry), '#/movie/603/watch');
});

test('the first few seconds are not worth resuming', () => {
  const store = setup();
  store.recordStart('movie', 603, null, null, MATRIX);
  store.setProgress('movie', 603, null, null, { progress: 9, duration: 8160 });
  assert.equal(resumeSeconds(store.get('movie', 603)), 0);
});

test('near the end counts as watched, and watching again reopens it', () => {
  const store = setup();
  store.recordStart('movie', 603, null, null, MATRIX);
  let entry = store.setProgress('movie', 603, null, null, { progress: 7700, duration: 8160 });
  assert.equal(entry.completed, true);
  assert.equal(resumeSeconds(entry), 0);
  assert.equal(percent(entry), 100);

  entry = store.setProgress('movie', 603, null, null, { progress: 600, duration: 8160 });
  assert.equal(entry.completed, false);
  assert.equal(resumeSeconds(entry), 600);
});

test('a completed event marks it watched whatever the position', () => {
  const store = setup();
  store.recordStart('movie', 603, null, null, MATRIX);
  assert.equal(store.setProgress('movie', 603, null, null, { progress: 10, duration: 0, finished: true }).completed, true);
});

test('nonsense numbers are made safe', () => {
  const store = setup();
  store.recordStart('movie', 603, null, null, MATRIX);
  for (const progress of [NaN, Infinity, -50, null, 'abc', undefined]) {
    assert.equal(store.setProgress('movie', 603, null, null, { progress, duration: 100 }).progress, 0);
  }
});

test('progress for a title that was never opened is ignored', () => {
  const store = setup();
  assert.equal(store.setProgress('movie', 42, null, null, { progress: 10 }), null);
  assert.equal(store.all().length, 0);
});

test('an episode switched inside the player gets its own entry', () => {
  const store = setup();
  store.recordStart('tv', 1399, 1, 1, GOT);
  const entry = store.setProgress('tv', 1399, 1, 2, { progress: 120, duration: 3300 });
  assert.equal(entry.title, 'Game of Thrones');
  assert.equal(store.episodesOf(1399).length, 2);
  assert.equal(watchHash(entry), '#/tv/1399/1/2');
});

test('continue watching: half-watched titles, newest first, one card per show', () => {
  const store = setup();
  store.recordStart('movie', 603, null, null, MATRIX);
  store.setProgress('movie', 603, null, null, { progress: 1200, duration: 8160 });
  store.recordStart('tv', 1399, 1, 1, GOT);
  store.setProgress('tv', 1399, 1, 1, { progress: 300, duration: 3300 });
  store.recordStart('tv', 1399, 1, 2, GOT);
  store.setProgress('tv', 1399, 1, 2, { progress: 600, duration: 3300 });

  const cards = store.continueWatching();
  assert.deepEqual(cards.map((c) => c.title), ['Game of Thrones', 'The Matrix']);
  assert.equal(cards[0].label, 'S1 E2');
  assert.equal(cards[0].minutesLeft, 45);
  assert.equal(cards[0].hash, '#/tv/1399/1/2');
  assert.equal(cards[1].percent, 15);
});

test('continue watching: a finished movie drops out', () => {
  const store = setup();
  store.recordStart('movie', 603, null, null, MATRIX);
  store.setProgress('movie', 603, null, null, { progress: 8100, duration: 8160, finished: true });
  assert.deepEqual(store.continueWatching(), []);
});

test('continue watching: a finished episode offers the next one', () => {
  const store = setup();
  store.recordStart('tv', 1399, 1, 2, { ...GOT, nextSeason: 2, nextEpisode: 1 });
  store.setProgress('tv', 1399, 1, 2, { progress: 3290, duration: 3300, finished: true });
  const [card] = store.continueWatching();
  assert.equal(card.label, 'Next: S2 E1');
  assert.equal(card.hash, '#/tv/1399/2/1');
  assert.equal(card.percent, 0);
});

test('continue watching: a finished series drops out', () => {
  const store = setup();
  store.recordStart('tv', 1399, 2, 2, { ...GOT, nextSeason: null, nextEpisode: null });
  store.setProgress('tv', 1399, 2, 2, { progress: 3290, duration: 3300, finished: true });
  assert.deepEqual(store.continueWatching(), []);
});

test('remove one entry, a whole show, or everything', () => {
  const store = setup();
  store.recordStart('movie', 603, null, null, MATRIX);
  store.recordStart('tv', 1399, 1, 1, GOT);
  store.recordStart('tv', 1399, 1, 2, GOT);

  store.remove('tv:1399:1:1');
  assert.equal(store.all().length, 2);
  store.removeTitle('tv', 1399);
  assert.deepEqual(store.all().map((e) => e.key), ['movie:603']);
  store.clear();
  assert.equal(store.all().length, 0);
});

test('bad or blocked storage never throws', () => {
  const broken = createStore(fakeStorage({ 'fm:history:v1': '{not json' }));
  assert.deepEqual(broken.all(), []);
  const blocked = createStore({
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  });
  assert.deepEqual(blocked.all(), []);
  assert.doesNotThrow(() => blocked.recordStart('movie', 603, null, null, MATRIX));
});

test('history is capped, dropping the oldest', () => {
  const store = setup();
  for (let i = 1; i <= 520; i += 1) store.recordStart('movie', i, null, null, { title: `Movie ${i}` });
  const all = store.all();
  assert.equal(all.length, 500);
  assert.equal(all[0].tmdbId, 520);
  assert.equal(store.get('movie', 1), null);
});

test('templates escape everything that is not marked safe', () => {
  const title = '<img src=x onerror=alert(1)> & "friends"';
  const out = html`<a title="${title}">${title}</a>${[html`<b>${'<i>'}</b>`, raw('<hr>')]}${null}${false}${0}`.toString();
  assert.equal(out, `<a title="${esc(title)}">${esc(title)}</a><b>&lt;i&gt;</b><hr>0`);
  assert.ok(!out.includes('<img'));
});

test('formatting helpers', () => {
  assert.equal(clock(754), '12:34');
  assert.equal(clock(5025), '1:23:45');
  assert.equal(clock('junk'), '0:00');
  assert.equal(runtime(134), '2h 14m');
  assert.equal(runtime(45), '45m');
  assert.equal(runtime(120), '2h');
  assert.equal(runtime(null), '');
  assert.equal(ago(1000, 30_000), 'Just now');
  assert.equal(ago(0, 3 * 3600 * 1000), '3 hours ago');
  assert.equal(ago(0, 86400 * 1000), '1 day ago');
  assert.equal(pageNumber('abc'), 1);
  assert.equal(pageNumber('-4'), 1);
  assert.equal(pageNumber('99999'), 500);
  assert.equal(pageNumber('7'), 7);
});
