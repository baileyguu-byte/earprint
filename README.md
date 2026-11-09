# Earprint

Shape your EQ on the songs you actually play. Earprint plays 30-second song previews from Deezer, shows how each song's balance compares with a typical song, lets you shape it with a 10-band equaliser right on the frequency scope, and compares two settings blind at matched volume. It can also measure up to five of your artists and fit one setting to what they share. Settings export to Apple Music on a Mac, Spotify, Equalizer APO and Wavelet.

## Site layout

| Path | What it is |
| --- | --- |
| `public/index.html` | Front page: what EQ does, the EQ cheat sheet, devices, artists over time, reading the scope, limitations |
| `public/lab/index.html` | The EQ lab |
| `public/about/index.html` | Conditions of use for Deezer previews, privacy, credits, and a button to clear saved data |
| `public/assets/earprint.css` | Shared colours, fonts, header, footer and the Deezer credit |
| `public/assets/lab.js` | Lab app: search, playback, loop, scope with draggable dots, faders, soft limit, auto fit, quick fixes, blind test, your artists |
| `public/assets/dsp.js` | EQ bands, filter maths, song analysis, the typical-song reference and the auto fit |
| `public/assets/charts.js` | The two comparison charts (this song, your artists) |
| `public/assets/cheats.js` | What each band does and the quick fixes |
| `public/assets/deezer.js` | Deezer search and suggestions (JSONP, no key needed) |
| `public/assets/exports.js` | Export formats for each app |
| `public/assets/demo.js` | The built-in demo loop |
| `public/assets/deezer/` | Official Deezer logos, unaltered (see below) |
| `public/assets/fonts/` | Self-hosted fonts and their licences |
| `wrangler.jsonc` | Cloudflare settings: serves `public/`, custom 404 page, preview links |

There is no build step: the files in `public/` are served as they are.

## Hosting

Deployed on Cloudflare from this repository.

- Pushing to `main` updates earprint.xyz.
- Pushing any other branch builds a preview at `<branch>-earprint.bailey-guu.workers.dev`.

## Data sources

- Song previews, artist and genre data: Deezer's public API, called from the visitor's browser.
- The typical song (`TYPICAL` in `dsp.js`): 128 previews, 8 from each of 16 Deezer charts, measured with the lab's own analysis in November 2026. Only the medians and quartiles are kept.
- Typical songs per genre (`GENRE_TYPICAL` in `dsp.js`): the top 12 previews on each of 17 Deezer genre charts, measured the same way in November 2026. The lab finds a song's genre from its album on Deezer. "Even it out" and the song chart use the genre by default; "Bring out its character" always compares with all music, so a genre's own traits count as character.
- Export formats were checked against each app's documentation (Equalizer APO configuration reference, Wavelet's import format).
- Cheat-sheet ranges follow common mixing practice; iZotope's EQ cheat sheet is linked as further reading. The wording and graphics are Earprint's own.

## Deezer compliance checklist

From Deezer's developer guidelines, logo page, brand site (deezerbrand.com) and terms of use:

- **Logo clearly visible**: the official horizontal logo (purple heart, black wordmark on light, white wordmark on dark) sits at the top of the song panel in the lab and in every footer, with clear space around it. Files in `public/assets/deezer/` were taken unaltered from the Black and purple and White and purple collections on deezerbrand.com.
- **30-second extracts only**: only `preview` URLs are used; no full-track URLs exist in the app.
- **No downloads or offline storage of audio**: previews are fetched with `cache: 'no-store'`, decoded in memory and never offered as files. Only derived numbers (ten per song) are stored, in the visitor's browser.
- **Regional availability**: tracks with `readable: false` are shown as "Not available here" and never played or measured.
- **Conditions of use shown to users**: the lab and the About page state that previews are for private, non-commercial listening within the household.
- **Non-commercial**: Deezer's terms limit use of the API to non-commercial purposes. No ads, paid tiers or sponsorship while Deezer content is used.
- **Privacy**: no accounts, cookies or analytics; fonts are self-hosted; the About page explains what is stored and lets visitors clear it.
- **Open question**: the terms forbid modifying the "Services". Applying an EQ to previews and measuring them is worth confirming with Deezer developer support.
