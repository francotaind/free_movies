// One function per page. Each returns { title, hero, body, mount } where
// `body` is the page's HTML and `mount(root, isCurrent)` (optional) wires up
// anything live and may return a cleanup function.
import { COUNTRIES, VIDSRC_MIRRORS } from './config.js';
import { html } from './html.js';
import { mountPlayer } from './player.js';
import { isEpisode, minutesLeft, percent, resumeSeconds, watchHash } from './store.js';
import { img, normalizeList, tmdb } from './tmdb.js';
import { ago, clock, pageNumber, plural, runtime, today } from './util.js';
import { latestMovies, titleInfo } from './vidsrc.js';

const PLAY_ICON = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16l13-8z"/></svg>`;
const CLOSE_ICON = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const STAR = html`<span class="star" aria-hidden="true">★</span>`;

// --- Shared pieces --------------------------------------------------------------

function card(item, showType = false) {
  return html`<a class="card" href="#/${item.media_type}/${item.id}">
    <div class="card__art">
      ${item.poster_path
        ? html`<img src="${img(item.poster_path, 'w342')}" alt="" loading="lazy" width="342" height="513">`
        : html`<span class="card__fallback">${item.title}</span>`}
      ${item.quality ? html`<span class="card__tag${item.quality === 'CAM' ? ' card__tag--low' : ''}">${item.quality}</span>` : ''}
    </div>
    <span class="card__title">${item.title}</span>
    <span class="card__sub">
      ${item.year ? html`<span>${item.year}</span>` : ''}
      ${item.rating ? html`<span>${STAR} ${item.rating}</span>` : ''}
      ${showType ? html`<span>${item.media_type === 'tv' ? 'Series' : 'Movie'}</span>` : ''}
    </span>
  </a>`;
}

function arrows(label) {
  return {
    prev: html`<button class="row__arrow row__arrow--prev" type="button" data-row-prev aria-label="Scroll ${label} back" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>`,
    next: html`<button class="row__arrow row__arrow--next" type="button" data-row-next aria-label="Scroll ${label} forward" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>`,
  };
}

function row({ title, items, more, showType = false, id = '' }) {
  if (!items || !items.length) return '';
  const arrow = arrows(title);
  return html`<section class="row" data-row ${id ? html`id="${id}"` : ''}>
    <div class="row__head">
      <h2 class="row__title">${title}</h2>
      ${more ? html`<a class="row__more" href="${more}">See all</a>` : ''}
    </div>
    ${arrow.prev}
    <div class="row__track" data-row-track>${items.map((item) => card(item, showType))}</div>
    ${arrow.next}
  </section>`;
}

function progressBar(value, label = true) {
  if (!value) return '';
  return label
    ? html`<div class="progress" role="img" aria-label="${value}% watched"><span style="width: ${value}%"></span></div>`
    : html`<span class="progress"><span style="width: ${value}%"></span></span>`;
}

function pager(page, totalPages, hashFor) {
  const last = Math.min(500, totalPages || 1);
  if (page <= 1 && page >= last) return '';
  return html`<nav class="pager" aria-label="Pages">
    ${page > 1 ? html`<a class="btn btn--small" href="${hashFor(page - 1)}">Previous</a>` : html`<a class="btn btn--small" aria-disabled="true">Previous</a>`}
    <span>Page ${page}</span>
    ${page < last ? html`<a class="btn btn--small" href="${hashFor(page + 1)}">Next</a>` : html`<a class="btn btn--small" aria-disabled="true">Next</a>`}
  </nav>`;
}

function empty(heading, text, action = '') {
  return html`<p class="empty"><strong>${heading}</strong>${text}${action}</p>`;
}

export function failed(route) {
  return {
    title: 'Something went wrong',
    body: html`<div class="page">${empty(
      "This page didn't load",
      'TMDB isn\'t responding, or you\'re offline. ',
      html`<br><a class="btn" href="${route.hash}" data-action="retry">Try again</a>`,
    )}</div>`,
  };
}

export function notFound() {
  return {
    title: 'Not found',
    body: html`<div class="page">${empty(
      "That page doesn't exist",
      'The title may have been removed, or the address is mistyped. ',
      html`<br><a class="btn btn--play" href="#/">Go to the home page</a>`,
    )}</div>`,
  };
}

function cast(credits) {
  const people = ((credits && credits.cast) || []).slice(0, 12);
  if (!people.length) return '';
  return html`<section class="section">
    <h2 class="section__title">Cast</h2>
    <div class="cast">${people.map((person) => html`<div>
      <div class="cast__photo">${person.profile_path
        ? html`<img src="${img(person.profile_path, 'w185')}" alt="" loading="lazy">`
        : (person.name || '?').slice(0, 1)}</div>
      <p class="cast__name">${person.name}</p>
      ${person.character ? html`<p class="cast__role">${person.character}</p>` : ''}
    </div>`)}</div>
  </section>`;
}

function similar(data, mediaType) {
  const items = normalizeList(data.recommendations && data.recommendations.results, mediaType);
  return items.length ? html`<div class="section section--flush">${row({ title: 'More like this', items })}</div>` : '';
}

/** Fill in the quality badge, or the "not on VidSrc" note, once VidSrc answers. */
function mountAvailability(root, isCurrent, mediaType, tmdbId) {
  titleInfo(mediaType, tmdbId).then((info) => {
    if (!info || !isCurrent()) return;
    const badge = root.querySelector('[data-vidsrc-quality]');
    const missing = root.querySelector('[data-vidsrc-missing]');
    if (!info.available) {
      if (missing) missing.hidden = false;
    } else if (badge && info.quality) {
      badge.textContent = info.quality;
      badge.classList.toggle('badge--low', info.quality === 'CAM');
      badge.hidden = false;
    }
  });
}

function aired(airDate) {
  return !airDate || airDate <= today();
}

/** Real seasons only: no specials, nothing empty. */
function realSeasons(show) {
  return (show.seasons || []).filter((s) => s.season_number > 0 && s.episode_count > 0);
}

function episodeList({ showId, season, episodes, watched, current = 0, overview = false }) {
  if (!episodes.length) return html`<p class="empty">Episodes for this season didn't load. Reload the page in a moment.</p>`;
  return html`<ol class="episodes">${episodes.map((ep) => {
    const entry = watched.get(`${season}:${ep.number}`);
    const left = minutesLeft(entry);
    const inner = html`
      <span class="episode__num">${ep.number}</span>
      <span class="episode__still">
        ${ep.still ? html`<img src="${img(ep.still, 'w300')}" alt="" loading="lazy">` : ''}
        ${progressBar(percent(entry), false)}
      </span>
      <span>
        <span class="episode__name">
          ${ep.name}
          ${ep.runtime ? html`<span class="episode__meta">${runtime(ep.runtime)}</span>` : ''}
          ${!ep.aired ? html`<span class="episode__meta">Airs ${ep.airDate}</span>`
            : ep.number === current ? html`<span class="watched-mark">Playing now</span>`
            : entry && entry.completed ? html`<span class="watched-mark">Watched</span>`
            : left ? html`<span class="watched-mark">${left} min left</span>` : ''}
        </span>
        ${overview && ep.overview ? html`<span class="episode__overview">${ep.overview}</span>` : ''}
      </span>`;
    return html`<li class="episode${ep.number === current ? ' is-current' : ''}${ep.aired ? '' : ' episode--soon'}">
      ${ep.aired
        ? html`<a class="episode__link" href="#/tv/${showId}/${season}/${ep.number}" ${ep.number === current ? html`aria-current="true"` : ''}>${inner}</a>`
        : html`<div class="episode__link">${inner}</div>`}
    </li>`;
  })}</ol>`;
}

function shapeEpisodes(seasonData) {
  return ((seasonData && seasonData.episodes) || []).map((ep) => ({
    number: ep.episode_number,
    name: ep.name || `Episode ${ep.episode_number}`,
    overview: ep.overview || '',
    still: ep.still_path || null,
    runtime: ep.runtime || 0,
    airDate: ep.air_date || '',
    aired: aired(ep.air_date),
  }));
}

function watchedMap(store, tmdbId) {
  const map = new Map();
  for (const entry of store.episodesOf(tmdbId)) map.set(`${entry.season}:${entry.episode}`, entry);
  return map;
}

// --- Home -----------------------------------------------------------------------

function continueRow(cards) {
  if (!cards.length) return '';
  const arrow = arrows('continue watching');
  return html`<section class="row row--wide" data-row id="continue-watching">
    <div class="row__head">
      <h2 class="row__title">Continue watching</h2>
      <a class="row__more" href="#/history">Watch history</a>
    </div>
    ${arrow.prev}
    <div class="row__track" data-row-track>${cards.map((item) => html`<article class="resume-card">
      <a class="resume-card__link" href="${item.hash}">
        <div class="resume-card__art${item.isPoster ? ' resume-card__art--poster' : ''}">
          ${item.imagePath ? html`<img src="${img(item.imagePath, 'w500')}" alt="" loading="lazy">` : html`<span class="card__fallback">${item.title}</span>`}
          <span class="resume-card__play" aria-hidden="true">${PLAY_ICON}</span>
          ${progressBar(item.percent)}
        </div>
        <span class="resume-card__title">${item.title}</span>
        <span class="resume-card__sub">${[item.label, item.minutesLeft ? `${item.minutesLeft} min left` : ''].filter(Boolean).join(', ') || 'Pick up where you stopped'}</span>
      </a>
      <div class="resume-card__remove">
        <button class="icon-btn" type="button" data-action="forget-title" data-type="${item.mediaType}" data-id="${item.tmdbId}"
                aria-label="Remove ${item.title} from continue watching" title="Remove">${CLOSE_ICON}</button>
      </div>
    </article>`)}</div>
    ${arrow.next}
  </section>`;
}

export async function home(route, store) {
  const names = ['/trending/all/day', '/movie/popular', '/tv/popular', '/movie/now_playing', '/movie/top_rated'];
  const [trendingData, movies, series, cinemas, top] = await Promise.all(
    names.map((path) => tmdb(path).catch(() => null)),
  );
  if (!trendingData && !movies && !series) throw new Error('catalogue unavailable');

  const results = (data) => (data && data.results) || [];
  const trending = normalizeList(results(trendingData));
  const featured = trending.filter((t) => t.backdrop_path && t.overview).slice(0, 5);
  const hero = featured.length ? featured[Math.floor(Date.now() / 86400000) % featured.length] : null;

  const heroHtml = hero ? html`<section class="hero">
    <div class="hero__art"><img src="${img(hero.backdrop_path, 'w1280')}" alt=""></div>
    <div class="hero__body">
      <h1 class="hero__title display">${hero.title}</h1>
      <div class="facts">
        ${hero.rating ? html`<span>${STAR} <strong>${hero.rating}</strong></span>` : ''}
        ${hero.year ? html`<span>${hero.year}</span>` : ''}
        <span>${hero.media_type === 'tv' ? 'Series' : 'Movie'}</span>
        <span>Trending today</span>
      </div>
      <p class="hero__overview">${hero.overview}</p>
      <div class="hero__actions">
        ${hero.media_type === 'movie'
          ? html`<a class="btn btn--play" href="#/movie/${hero.id}/watch">${PLAY_ICON}Play</a>
                 <a class="btn" href="#/movie/${hero.id}">More info</a>`
          : html`<a class="btn btn--play" href="#/tv/${hero.id}/1/1">${PLAY_ICON}Play</a>
                 <a class="btn" href="#/tv/${hero.id}">Episodes and info</a>`}
      </div>
    </div>
  </section>` : '';

  return {
    title: '',
    hero: Boolean(hero),
    body: html`${heroHtml}
      ${continueRow(store.continueWatching())}
      ${row({ title: 'Trending today', items: trending, showType: true, id: 'trending' })}
      <div data-just-added></div>
      ${row({ title: 'Popular movies', items: normalizeList(results(movies), 'movie'), more: '#/movies' })}
      ${row({ title: 'Popular series', items: normalizeList(results(series), 'tv'), more: '#/series' })}
      ${row({ title: 'In cinemas now', items: normalizeList(results(cinemas), 'movie') })}
      ${row({ title: 'Top rated', items: normalizeList(results(top), 'movie') })}
      <div style="height: 3rem"></div>`,
    mount(root, isCurrent, wire) {
      // The VidSrc feed is slower than TMDB, so it joins the page when it arrives.
      latestMovies().then((items) => {
        const slot = root.querySelector('[data-just-added]');
        if (!isCurrent() || !slot || !items.length) return;
        slot.innerHTML = row({ title: 'Just added', items }).toString();
        wire(slot);
      });
    },
  };
}

// --- Browsing -------------------------------------------------------------------

async function browse({ heading, path, params, mediaType, page, hashFor, back, chips }) {
  const [data, genres] = await Promise.all([
    tmdb(path, { ...params, page }),
    chips ? tmdb(`/genre/${mediaType}/list`).catch(() => null) : null,
  ]);
  const items = normalizeList(data.results, mediaType);
  return {
    title: heading,
    body: html`<div class="page">
      ${back ? html`<a class="back-link" href="${back.hash}">&lsaquo; ${back.label}</a>` : ''}
      <div class="page__head"><h1 class="page__title display">${heading}</h1></div>
      ${genres && genres.genres ? html`<nav class="filter-bar" aria-label="Genres">
        <span class="chip" aria-current="true">Popular</span>
        ${genres.genres.map((g) => html`<a class="chip" href="#/genre/${mediaType}/${g.id}/${encodeURIComponent(g.name)}">${g.name}</a>`)}
      </nav>` : ''}
      ${items.length
        ? html`<div class="grid">${items.map((item) => card(item))}</div>${pager(page, data.total_pages, hashFor)}`
        : empty('Nothing here yet', 'No titles match this list. Try another genre or country.')}
    </div>`,
  };
}

export function movies(route) {
  return browse({
    heading: 'Movies', path: '/movie/popular', mediaType: 'movie', chips: true,
    page: pageNumber(route.query.get('page')), hashFor: (p) => `#/movies?page=${p}`,
  });
}

export function series(route) {
  return browse({
    heading: 'Series', path: '/tv/popular', mediaType: 'tv', chips: true,
    page: pageNumber(route.query.get('page')), hashFor: (p) => `#/series?page=${p}`,
  });
}

export function genre(route) {
  const [, mediaType, id, name = ''] = route.segments;
  if (!/^\d+$/.test(id)) return notFound();
  return browse({
    heading: `${name || 'Genre'} ${mediaType === 'tv' ? 'series' : 'movies'}`,
    path: `/discover/${mediaType}`, params: { with_genres: id }, mediaType,
    page: pageNumber(route.query.get('page')),
    hashFor: (p) => `#/genre/${mediaType}/${id}/${encodeURIComponent(name)}?page=${p}`,
    back: { hash: '#/genres', label: 'All genres' },
  });
}

export function country(route) {
  const code = (route.segments[1] || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return notFound();
  return browse({
    heading: `Movies from ${COUNTRIES[code] || code}`,
    path: '/discover/movie', params: { with_origin_country: code }, mediaType: 'movie',
    page: pageNumber(route.query.get('page')), hashFor: (p) => `#/country/${code}?page=${p}`,
    back: { hash: '#/countries', label: 'All countries' },
  });
}

export async function genres() {
  const [movieGenres, tvGenres] = await Promise.all([tmdb('/genre/movie/list'), tmdb('/genre/tv/list')]);
  const cloud = (list, type) => html`<div class="chip-cloud">${(list.genres || []).map(
    (g) => html`<a class="chip" href="#/genre/${type}/${g.id}/${encodeURIComponent(g.name)}">${g.name}</a>`,
  )}</div>`;
  return {
    title: 'Genres',
    body: html`<div class="page">
      <div class="page__head"><h1 class="page__title display">Genres</h1></div>
      <h2 class="subhead">Movies</h2>${cloud(movieGenres, 'movie')}
      <h2 class="subhead">Series</h2>${cloud(tvGenres, 'tv')}
    </div>`,
  };
}

export function countries() {
  return {
    title: 'Countries',
    body: html`<div class="page">
      <div class="page__head"><h1 class="page__title display">Movies by country</h1></div>
      <div class="chip-cloud">${Object.entries(COUNTRIES).map(
        ([code, name]) => html`<a class="chip" href="#/country/${code}">${name}</a>`,
      )}</div>
    </div>`,
  };
}

export async function search(route) {
  const query = (route.query.get('q') || '').trim();
  const page = pageNumber(route.query.get('page'));
  if (!query) {
    return {
      title: 'Search',
      body: html`<div class="page">
        <div class="page__head"><h1 class="page__title display">Search</h1></div>
        ${empty('Find something to watch', 'Type a movie or series title in the search box above.')}
      </div>`,
    };
  }
  const data = await tmdb('/search/multi', { query, page });
  const items = normalizeList(data.results);
  return {
    title: `${query} | Search`,
    query,
    body: html`<div class="page">
      <div class="page__head"><h1 class="page__title display">Results for &ldquo;${query}&rdquo;</h1></div>
      ${items.length
        ? html`<div class="grid">${items.map((item) => card(item, true))}</div>
               ${pager(page, data.total_pages, (p) => `#/search?q=${encodeURIComponent(query)}&page=${p}`)}`
        : empty(`No matches for “${query}”`, 'Check the spelling, or search for the original title.')}
    </div>`,
  };
}

// --- Title pages ----------------------------------------------------------------

function genreChips(list, mediaType) {
  if (!list || !list.length) return '';
  return html`<div class="genre-list">${list.map(
    (g) => html`<a class="chip" href="#/genre/${mediaType}/${g.id}/${encodeURIComponent(g.name)}">${g.name}</a>`,
  )}</div>`;
}

export async function movieDetail(route, store) {
  const id = Number(route.segments[1]);
  const movie = await tmdb(`/movie/${id}`, { append_to_response: 'credits,recommendations' });
  const entry = store.get('movie', id);
  const resume = resumeSeconds(entry);
  const left = minutesLeft(entry);
  return {
    title: movie.title,
    hero: true,
    body: html`<section class="hero hero--title">
      ${movie.backdrop_path ? html`<div class="hero__art"><img src="${img(movie.backdrop_path, 'w1280')}" alt=""></div>` : ''}
      <div class="hero__body">
        <h1 class="hero__title display">${movie.title}</h1>
        <div class="facts">
          ${movie.vote_average ? html`<span>${STAR} <strong>${movie.vote_average.toFixed(1)}</strong></span>` : ''}
          ${movie.release_date ? html`<span>${movie.release_date.slice(0, 4)}</span>` : ''}
          ${movie.runtime ? html`<span>${runtime(movie.runtime)}</span>` : ''}
          <span class="badge" data-vidsrc-quality hidden></span>
        </div>
        ${movie.tagline ? html`<p class="resume-note"><em>${movie.tagline}</em></p>` : ''}
        <p class="hero__overview hero__overview--full">${movie.overview || 'No synopsis is available for this title.'}</p>
        <div class="hero__actions">
          <a class="btn btn--play" href="#/movie/${id}/watch">${PLAY_ICON}${resume ? 'Resume' : entry && entry.completed ? 'Watch again' : 'Play'}</a>
        </div>
        ${resume ? html`<p class="resume-note">You stopped at ${clock(resume)}${left ? `, ${left} min left` : ''}.</p>
          <div class="progress" style="max-width: 22rem; margin-top: 0.5rem"><span style="width: ${percent(entry)}%"></span></div>` : ''}
        <p class="resume-note" data-vidsrc-missing hidden>VidSrc doesn't have this title yet, so the player may come up empty.</p>
        ${genreChips(movie.genres, 'movie')}
      </div>
    </section>
    ${cast(movie.credits)}
    ${similar(movie, 'movie')}
    <div style="height: 3rem"></div>`,
    mount(root, isCurrent) { mountAvailability(root, isCurrent, 'movie', id); },
  };
}

export async function tvDetail(route, store) {
  const id = Number(route.segments[1]);
  const show = await tmdb(`/tv/${id}`, { append_to_response: 'credits,recommendations' });
  const seasons = realSeasons(show);
  const numbers = seasons.map((s) => s.season_number);
  const watched = watchedMap(store, id);
  const last = store.episodesOf(id)[0] || null;

  // Which season to list: ?season=, else where you left off, else the first.
  const asked = parseInt(route.query.get('season'), 10);
  const current = numbers.includes(asked) ? asked : last && numbers.includes(last.season) ? last.season : numbers[0] || null;
  const episodes = current ? shapeEpisodes(await tmdb(`/tv/${id}/season/${current}`).catch(() => null)) : [];

  // The main button: resume, move on to the next episode, or start at S1 E1.
  let play = null;
  if (last && last.completed && last.nextSeason && last.nextEpisode) {
    play = { season: last.nextSeason, episode: last.nextEpisode, verb: 'Play next' };
  } else if (last && !last.completed) {
    play = { season: last.season, episode: last.episode, verb: resumeSeconds(last) ? 'Resume' : 'Play' };
  } else if (numbers.length) {
    play = { season: numbers[0], episode: 1, verb: last ? 'Play again' : 'Play' };
  }
  const lastResume = last && !last.completed ? resumeSeconds(last) : 0;

  return {
    title: show.name,
    hero: true,
    scrollTo: route.query.has('season') ? '#episodes' : null,
    body: html`<section class="hero hero--title">
      ${show.backdrop_path ? html`<div class="hero__art"><img src="${img(show.backdrop_path, 'w1280')}" alt=""></div>` : ''}
      <div class="hero__body">
        <h1 class="hero__title display">${show.name}</h1>
        <div class="facts">
          ${show.vote_average ? html`<span>${STAR} <strong>${show.vote_average.toFixed(1)}</strong></span>` : ''}
          ${show.first_air_date ? html`<span>${show.first_air_date.slice(0, 4)}</span>` : ''}
          ${show.number_of_seasons ? html`<span>${plural(show.number_of_seasons, 'season')}</span>` : ''}
          ${show.number_of_episodes ? html`<span>${plural(show.number_of_episodes, 'episode')}</span>` : ''}
          <span class="badge" data-vidsrc-quality hidden></span>
        </div>
        <p class="hero__overview hero__overview--full">${show.overview || 'No synopsis is available for this series.'}</p>
        <div class="hero__actions">
          ${play ? html`<a class="btn btn--play" href="#/tv/${id}/${play.season}/${play.episode}">${PLAY_ICON}${play.verb} S${play.season} E${play.episode}</a>` : ''}
        </div>
        ${lastResume ? html`<p class="resume-note">You stopped at ${clock(lastResume)} in season ${last.season}, episode ${last.episode}.</p>` : ''}
        <p class="resume-note" data-vidsrc-missing hidden>VidSrc doesn't have this series yet, so the player may come up empty.</p>
        ${genreChips(show.genres, 'tv')}
      </div>
    </section>

    <section class="section" id="episodes">
      <h2 class="section__title">Episodes</h2>
      ${seasons.length ? html`
        <nav class="tabs" aria-label="Seasons">${seasons.map((s) => html`<a class="chip" href="#/tv/${id}?season=${s.season_number}"
          ${s.season_number === current ? html`aria-current="true"` : ''}>Season ${s.season_number}</a>`)}</nav>
        ${episodeList({ showId: id, season: current, episodes, watched, overview: true })}`
        : html`<p class="empty">No episodes are listed for this series yet.</p>`}
    </section>
    ${cast(show.credits)}
    ${similar(show, 'tv')}
    <div style="height: 3rem"></div>`,
    mount(root, isCurrent) { mountAvailability(root, isCurrent, 'tv', id); },
  };
}

// --- Watch pages ----------------------------------------------------------------

function watchPage({ heading, backHash, episodeLine, overview, controls, below, title, store }) {
  return {
    title: heading,
    body: html`<div class="watch">
      <a class="back-link" href="${backHash}">&lsaquo; ${title.name}</a>
      <div class="player" data-player>
        <iframe title="${title.name} player" allowfullscreen referrerpolicy="origin"
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"></iframe>
        <div class="up-next" data-up-next hidden>
          <p class="up-next__label">Next episode in <span data-up-next-count>8</span>s</p>
          <p class="up-next__title">${title.next ? title.next.label : ''}</p>
          <div class="up-next__actions">
            <a class="btn btn--small btn--play" href="${title.next ? title.next.hash : '#/'}">Play now</a>
            <button class="btn btn--small" type="button" data-up-next-cancel>Cancel</button>
          </div>
        </div>
      </div>
      <div class="resume-bar" data-resume-bar hidden>
        <span>Picking up at <strong data-resume-time></strong></span>
        <button class="btn btn--small" type="button" data-restart>Start from the beginning</button>
      </div>
      <div class="watch__info">
        <div class="watch__text">
          <h1 class="watch__title display">${title.name}</h1>
          ${episodeLine || ''}
          ${overview ? html`<p class="watch__overview">${overview}</p>` : ''}
        </div>
        <div>
          <div class="watch__controls">
            ${controls || ''}
            <label class="field">Server
              <select data-mirror aria-label="Player server">${VIDSRC_MIRRORS.map(
                (mirror, index) => html`<option value="${mirror}">Server ${index + 1}</option>`,
              )}</select>
            </label>
          </div>
          <label class="field field--check">
            <input type="checkbox" data-block-popups> Block pop-up ads
          </label>
          <p class="hint">Player not loading? Try another server, or turn off pop-up blocking.</p>
        </div>
      </div>
      ${below || ''}
    </div>`,
    mount(root) { return mountPlayer(root, title, store); },
  };
}

export async function movieWatch(route, store) {
  const id = Number(route.segments[1]);
  const movie = await tmdb(`/movie/${id}`);
  const name = movie.title || 'Untitled';
  store.recordStart('movie', id, null, null, {
    title: name, posterPath: movie.poster_path || null, backdropPath: movie.backdrop_path || null,
  });
  return watchPage({
    heading: name, backHash: `#/movie/${id}`, overview: movie.overview, store,
    title: { mediaType: 'movie', tmdbId: id, season: null, episode: null, name, next: null },
  });
}

export async function episodeWatch(route, store) {
  const [id, season, episode] = route.segments.slice(1).map(Number);
  if (season < 1 || episode < 1) return notFound();
  const [show, seasonData] = await Promise.all([
    tmdb(`/tv/${id}`),
    tmdb(`/tv/${id}/season/${season}`).catch(() => null),
  ]);
  const episodes = shapeEpisodes(seasonData);
  const current = episodes.find((ep) => ep.number === episode);
  if (episodes.length && !current) return notFound();

  const counts = new Map(realSeasons(show).map((s) => [s.season_number, s.episode_count]));
  const has = (n) => episodes.some((ep) => ep.number === n);

  let prev = null;
  if (has(episode - 1) || (!episodes.length && episode > 1)) prev = [season, episode - 1];
  else if (counts.get(season - 1)) prev = [season - 1, counts.get(season - 1)];

  let next = null;
  const upcoming = episodes.find((ep) => ep.number === episode + 1);
  if (upcoming) { if (upcoming.aired) next = [season, episode + 1]; }
  else if (!episodes.length) next = [season, episode + 1]; // TMDB is down: let the viewer try
  else if (counts.get(season + 1)) next = [season + 1, 1];

  const name = show.name || 'Unknown show';
  store.recordStart('tv', id, season, episode, {
    title: name,
    episodeTitle: current ? current.name : '',
    posterPath: show.poster_path || null,
    backdropPath: (current && current.still) || show.backdrop_path || null,
    nextSeason: next ? next[0] : null,
    nextEpisode: next ? next[1] : null,
  });

  const link = (target, label) => (target
    ? html`<a class="btn btn--small" href="#/tv/${id}/${target[0]}/${target[1]}">${label}</a>`
    : html`<a class="btn btn--small" aria-disabled="true">${label}</a>`);

  return watchPage({
    heading: `${name} S${season} E${episode}`,
    backHash: `#/tv/${id}`,
    episodeLine: html`<p class="watch__episode"><span>Season ${season}, episode ${episode}</span> ${current ? current.name : ''}</p>`,
    overview: current ? current.overview : '',
    controls: html`${link(prev, 'Previous episode')}${link(next, 'Next episode')}`,
    below: episodes.length ? html`<section style="margin-top: 2.5rem">
      <h2 class="section__title">Season ${season}</h2>
      ${episodeList({ showId: id, season, episodes, watched: watchedMap(store, id), current: episode })}
    </section>` : '',
    store,
    title: {
      mediaType: 'tv', tmdbId: id, season, episode, name,
      next: next ? { hash: `#/tv/${id}/${next[0]}/${next[1]}`, label: `Season ${next[0]}, episode ${next[1]}` } : null,
    },
  });
}

// --- Watch history --------------------------------------------------------------

export function history(route, store) {
  const entries = store.all();
  return {
    title: 'Watch history',
    body: html`<div class="page">
      <div class="page__head">
        <h1 class="page__title display">Watch history</h1>
        ${entries.length ? html`<button class="btn btn--small btn--quiet btn--danger" type="button" data-action="clear-history">Clear history</button>` : ''}
      </div>
      ${entries.length ? html`<ul class="history">${entries.map((entry) => {
        const resume = resumeSeconds(entry);
        const left = minutesLeft(entry);
        const art = entry.backdropPath || entry.posterPath;
        const name = entry.title || 'Untitled';
        const label = isEpisode(entry) ? `S${entry.season} E${entry.episode}` : '';
        return html`<li class="history__item">
          <a class="history__art" href="${watchHash(entry)}" tabindex="-1" aria-hidden="true">
            ${art ? html`<img src="${img(art, 'w300')}" alt="" loading="lazy">` : html`<span class="card__fallback">${name}</span>`}
            ${progressBar(percent(entry), false)}
          </a>
          <div>
            <a class="history__title" href="#/${entry.mediaType}/${entry.tmdbId}">${name}</a>
            <div class="history__meta">
              ${label ? html`<span>${label}${entry.episodeTitle ? ` ${entry.episodeTitle}` : ''}</span>` : ''}
              ${entry.completed ? html`<span class="watched-mark">Watched</span>`
                : left ? html`<span>${left} min left</span>`
                : resume ? html`<span>Stopped at ${clock(resume)}</span>` : ''}
              <span>${ago(entry.updatedAt)}</span>
            </div>
          </div>
          <div class="history__actions">
            <a class="btn btn--small" href="${watchHash(entry)}">${entry.completed ? 'Watch again' : resume ? 'Resume' : 'Play'}</a>
            <button class="icon-btn" type="button" data-action="forget-entry" data-key="${entry.key}"
                    aria-label="Remove ${name}${label ? ` ${label}` : ''} from history" title="Remove">${CLOSE_ICON}</button>
          </div>
        </li>`;
      })}</ul>` : empty(
        'Nothing watched yet',
        'Everything you play shows up here, with your place saved so you can pick it up later. ',
        html`<br><a class="btn btn--play" href="#/">Find something to watch</a>`,
      )}
    </div>`,
  };
}
