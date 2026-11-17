// Site settings. Edit these to change the catalogue key or the player hosts.

// TMDB supplies titles, artwork and episode data. This key is sent from the
// visitor's browser, so anyone can read it; use a key made for this site.
export const TMDB_API_KEY = '81e845769a90cdbd18395b87427684b4';
export const TMDB_API = 'https://api.themoviedb.org/3';
export const IMAGE_BASE = 'https://image.tmdb.org/t/p/';

// VidSrc supplies the player. Every mirror serves the same content and API
// (docs: https://vsembed.ru/vidsrc/docs/). The first is the default; viewers
// can switch on the watch page. If one is blocked where you are, put another first.
export const VIDSRC_MIRRORS = ['https://vsembed.ru', 'https://vidsrc.sh', 'https://vsembed.su'];

export const COUNTRIES = {
  US: 'United States', IN: 'India', GB: 'United Kingdom', FR: 'France',
  DE: 'Germany', JP: 'Japan', KR: 'South Korea', CA: 'Canada',
  AU: 'Australia', MX: 'Mexico', ES: 'Spain',
};
