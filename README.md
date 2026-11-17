# Free Movies

A static movie and series site: browse, watch, and pick up where you left off. It is plain
HTML, CSS and JavaScript with no build step, so it runs on GitHub Pages as is.

- **Catalogue**: titles, artwork, cast and episode lists come from [TMDB](https://www.themoviedb.org/), fetched by the visitor's browser.
- **Player**: [VidSrc](https://vsembed.ru/vidsrc/docs/) embeds. This site hosts no video.
- **Watch history**: saved in the visitor's browser (`localStorage`). There are no accounts, so
  history doesn't follow you to another browser or device.

## Put it on GitHub Pages

1. On GitHub, open the repository's **Settings**, then **Pages**.
2. Under "Build and deployment", choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
3. After a minute the site is at `https://<your-username>.github.io/free_movies/`.

On GitHub's free plan the repository must be public for Pages to work.

## Run it locally

```bash
python3 -m http.server 8000    # then open http://localhost:8000
npm test                       # unit tests; needs Node 20+, nothing to install
```

It has to be served over HTTP; opening `index.html` straight from disk won't load the scripts.

## How resume works

1. The watch page loads the VidSrc player in an iframe (`/embed/movie/{tmdb_id}` or
   `/embed/tv/{tmdb_id}/{season}/{episode}`).
2. While it plays, the player posts `PLAYER_EVENT` messages (status, position, duration) to the
   page. `js/player.js` saves each one to the watch history.
3. Next time, the page adds `?startAt=<seconds>` to the player URL so it opens where you stopped.
   "Start from the beginning" clears the saved position.
4. A title past 92% counts as watched. A finished episode puts the next one in "Continue watching".

## Where VidSrc is used

| VidSrc API | Used for |
| --- | --- |
| `/embed/movie/{id}`, `/embed/tv/{id}/{s}/{e}` | The player |
| `startAt`, `autoplay`, `autonext` parameters | Resume, and letting this site handle "next episode" |
| `PLAYER_EVENT` messages | Saving progress, marking titles watched, the up-next countdown |
| `/movies/latest/page-1.json` | The "Just added" row on the home page (left out if the browser can't read the feed) |
| `/info/{movie\|tv}/{id}.json` | The quality badge on title pages, and a warning when a title is missing |

## Settings

Everything is in `js/config.js`:

- `TMDB_API_KEY`: sent from the visitor's browser, so anyone can read it. Use a key made for this site.
- `VIDSRC_MIRRORS`: player hosts. The first is the default; viewers can switch on the watch page.
  If one is blocked where you are, put another first.

## Files

| Path | What it does |
| --- | --- |
| `index.html` | The page shell. Every page lives behind a `#/` address. |
| `js/app.js` | Router |
| `js/views.js` | One function per page |
| `js/player.js` | Player loading, progress saving, resume, up next |
| `js/store.js` | Watch history in `localStorage` |
| `js/tmdb.js`, `js/vidsrc.js` | API clients |
| `css/app.css`, `fonts/` | Styles and the self-hosted Archivo font (SIL Open Font License) |
