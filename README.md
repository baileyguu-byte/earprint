# Earprint

Shape your EQ on the songs you actually play. Earprint plays 30-second song previews from Deezer, shows where each song's energy sits, lets you shape it with a 10-band equaliser, and compares two settings blind at matched volume. Settings export to Apple Music on a Mac, Spotify, Equalizer APO and Wavelet.

## Site layout

| Path | What it is |
| --- | --- |
| `public/index.html` | Front page: what EQ does, limitations, devices, how artists change over time |
| `public/lab/index.html` | The EQ lab |
| `public/assets/earprint.css` | Shared colours, type and header |
| `public/assets/lab.js` | Lab app (search, playback, loop, faders, blind test, scope) |
| `public/assets/deezer.js` | Deezer search and suggestions (JSONP, no key needed) |
| `public/assets/dsp.js` | EQ bands, filter maths, song analysis |
| `public/assets/exports.js` | Export formats for each app |
| `public/assets/demo.js` | The built-in demo loop |
| `wrangler.jsonc` | Cloudflare settings: serves `public/`, custom 404 page, preview links |

There is no build step: the files in `public/` are served as they are.

## Hosting

Deployed on Cloudflare from this repository.

- Pushing to `main` updates earprint.xyz.
- Pushing any other branch builds a preview at `<branch>-earprint.bailey-guu.workers.dev` (needs Preview Builds turned on in the Worker's build settings).

## Data sources

- Song previews, artist and genre data: Deezer's public API, called from the visitor's browser.
- Export formats were checked against each app's documentation (Equalizer APO configuration reference, Wavelet's import format).
