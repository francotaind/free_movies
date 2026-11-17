// Router and page shell. Every page lives behind a #/ address so the site
// works from any folder on a static host such as GitHub Pages.
import { createStore } from './store.js';
import * as views from './views.js';

const store = createStore(window.localStorage);
const main = document.getElementById('view');
const nav = document.querySelector('[data-nav]');
const searchForm = document.querySelector('[data-search]');

const id = '(\\d{1,9})';
const ROUTES = [
  [/^$/, views.home, 'home'],
  [/^movies$/, views.movies, 'movies'],
  [/^series$/, views.series, 'series'],
  [/^genres$/, views.genres, 'genres'],
  [/^genre\/(movie|tv)\/\d+(\/[^/]*)?$/, views.genre, 'genres'],
  [/^countries$/, views.countries, 'countries'],
  [/^country\/[^/]+$/, views.country, 'countries'],
  [/^search$/, views.search, ''],
  [/^history$/, views.history, 'history'],
  [new RegExp(`^movie/${id}$`), views.movieDetail, 'movies'],
  [new RegExp(`^movie/${id}/watch$`), views.movieWatch, 'movies'],
  [new RegExp(`^tv/${id}$`), views.tvDetail, 'series'],
  [new RegExp(`^tv/${id}/(\\d{1,4})/(\\d{1,4})$`), views.episodeWatch, 'series'],
];

function parseHash() {
  const hash = window.location.hash || '#/';
  const [pathPart, queryPart = ''] = hash.replace(/^#\/?/, '').split('?');
  const path = pathPart.replace(/\/+$/, '');
  let segments;
  try {
    segments = path.split('/').filter(Boolean).map(decodeURIComponent);
  } catch (error) {
    segments = null; // a mangled %-escape
  }
  return { hash, path, segments, query: new URLSearchParams(queryPart) };
}

let visit = 0;        // bumps on every navigation; stale renders check it and bail
let cleanup = null;   // undo function from the current page, if it has one
let lastPath = null;

async function render({ keepScroll = false } = {}) {
  const route = parseHash();
  const mine = ++visit;
  const isCurrent = () => mine === visit;
  const match = route.segments && ROUTES.find(([pattern]) => pattern.test(route.path));

  main.setAttribute('aria-busy', 'true');
  let page;
  try {
    page = match ? await match[1](route, store) : views.notFound();
  } catch (error) {
    page = error && error.status === 404 ? views.notFound() : views.failed(route);
  }
  if (!isCurrent()) return;

  if (cleanup) { cleanup(); cleanup = null; }
  main.innerHTML = page.body.toString();
  main.removeAttribute('aria-busy');
  document.body.classList.toggle('has-hero', Boolean(page.hero));
  document.title = page.title ? `${page.title} | Free Movies` : 'Free Movies';
  searchForm.elements.q.value = page.query || '';

  const key = match ? match[2] : '';
  document.querySelectorAll('[data-nav-key]').forEach((link) => {
    if (link.dataset.navKey === key) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  wire(main);
  if (page.mount) cleanup = page.mount(main, isCurrent, wire) || null;

  const target = page.scrollTo && main.querySelector(page.scrollTo);
  if (target) target.scrollIntoView();
  else if (!keepScroll) window.scrollTo(0, 0);
  if (lastPath !== null && lastPath !== route.path) main.focus({ preventScroll: true });
  lastPath = route.path;
  paintNav();
}

/** Arrow buttons page a row sideways; they hide at either end. */
function wire(root) {
  root.querySelectorAll('[data-row]').forEach((row) => {
    const track = row.querySelector('[data-row-track]');
    const prev = row.querySelector('[data-row-prev]');
    const next = row.querySelector('[data-row-next]');
    if (!track || !prev || !next || row.dataset.wired) return;
    row.dataset.wired = 'true';
    const sync = () => {
      prev.hidden = track.scrollLeft <= 4;
      next.hidden = track.scrollLeft >= track.scrollWidth - track.clientWidth - 4;
    };
    const page = (direction) => track.scrollBy({ left: direction * track.clientWidth * 0.85, behavior: 'smooth' });
    prev.addEventListener('click', () => page(-1));
    next.addEventListener('click', () => page(1));
    track.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
    // Posters arrive after the row is drawn and change how far it scrolls.
    track.querySelectorAll('img').forEach((image) => image.addEventListener('load', sync, { once: true }));
  });
}

function paintNav() {
  nav.classList.toggle('is-solid', window.scrollY > 24);
}

// Buttons that change the watch history.
main.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'retry') {
    event.preventDefault();
    render();
  } else if (action === 'forget-title') {
    store.removeTitle(button.dataset.type, Number(button.dataset.id));
    render({ keepScroll: true });
  } else if (action === 'forget-entry') {
    store.remove(button.dataset.key);
    render({ keepScroll: true });
  } else if (action === 'clear-history') {
    if (window.confirm("Clear your whole watch history? This can't be undone.")) {
      store.clear();
      render({ keepScroll: true });
    }
  }
});

searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = searchForm.elements.q.value.trim();
  if (query) window.location.hash = `#/search?q=${encodeURIComponent(query)}`;
});

window.addEventListener('hashchange', () => render());
window.addEventListener('scroll', paintNav, { passive: true });
render();
