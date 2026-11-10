# Earprint

Shape your EQ on the songs you actually play. Earprint plays 30-second song previews from Deezer, shows how each song's balance compares with a typical song of its genre, and lets you shape it right on the frequency scope with an equaliser laid out like yours. It can start from a correction for your exact headphones (AutoEq, 6,000+ models) and a gentle treble lift for your age (ISO 7029), compares two settings blind at matched volume, and can measure up to five of your artists and fit one setting to what they share. Settings export to Apple Music on a Mac, Samsung Galaxy, Spotify, Android's equaliser, cars and speakers, Equalizer APO and Wavelet.

## Site layout

| Path | What it is |
| --- | --- |
| `public/index.html` | Front page: what EQ does, the EQ cheat sheet, headphones, hearing and age, band layouts, artists over time, reading the scope, limitations |
| `public/lab/index.html` | The EQ lab |
| `public/about/index.html` | Conditions of use for Deezer previews, privacy, credits, and a button to clear saved data |
| `public/assets/earprint.css` | Shared colours, fonts, header, footer and the Deezer credit |
| `public/assets/lab.js` | Lab app: your setup (equaliser, headphones, hearing), search, playback, loop, scope with draggable dots, faders, soft limit, auto fit, quick fixes, blind test, your artists |
| `public/assets/autoeq.js` | Headphone list search and corrections (loads `public/assets/autoeq/`) |
| `public/assets/hearing.js` | ISO 7029 hearing by age, and the age compensation |
| `public/assets/curves.js` | Small frequency charts with tooltips (headphone correction, hearing) |
| `public/assets/home.js` | Front page hearing chart and table |
| `public/assets/dsp.js` | EQ bands, filter maths, song analysis, the typical-song reference and the auto fit |
| `public/assets/charts.js` | The two comparison charts (this song, your artists) |
| `public/assets/autoeq/` | AutoEq data: `index.json` (models), `eq-NN.json` (filters, 250 models each) and AutoEq's MIT licence |
| `tools/autoeq_build.py` | Rebuilds `public/assets/autoeq/` from a checkout of the AutoEq repository |
| `public/assets/cheats.js` | What each band does and the quick fixes |
| `public/assets/deezer.js` | Deezer search and suggestions (JSONP, no key needed) |
| `public/assets/exports.js` | Export formats for each app |
| `public/assets/demo.js` | The built-in demo loop |
| `public/assets/deezer/` | Official Deezer logos, unaltered (see below) |
| `public/assets/fonts/` | Self-hosted fonts and their licences |
| `public/feedback/index.html` | Feedback form (ideas, bugs, comments); script `public/assets/feedback.js` |
| `public/sitemap.xml`, `public/assets/og.png`, `public/apple-touch-icon.png` | Sitemap, social share image (1200×630) and home-screen icon |
| `src/worker.js` | The only server code: `POST /api/feedback` (stores feedback in D1) and `GET /robots.txt` (open on earprint.xyz, closed on preview links). Every other request is a static file and never runs it. |
| `migrations/0001_feedback.sql` | Schema of the `feedback` table in the `earprint-feedback` D1 database |
| `wrangler.jsonc` | Cloudflare settings: serves `public/`, the Worker for `/api/*` and `/robots.txt`, the D1 binding, the feedback rate limit, custom 404 page, preview links |

There is no build step: the files in `public/` are served as they are.

## Feedback

Messages from `/feedback/` go to the `earprint-feedback` D1 database (Oceania) on the Cloudflare account. Read them in the Cloudflare dashboard (Storage & databases › D1 › earprint-feedback › Console):

```sql
SELECT id, created_at, kind, message, contact, page FROM feedback WHERE status = 'new' ORDER BY id DESC;
UPDATE feedback SET status = 'done' WHERE id = 12;
```

Spam protection without storing IP addresses: a hidden honeypot field, a minimum time on the page, a same-origin check, Cloudflare's rate limit binding (3 posts a minute per IP, counted in memory) and a cap of 500 messages a day. Preview links write to a separate test database, `earprint-feedback-preview` (Worker Previews don't inherit production bindings, so the `previews` block in `wrangler.jsonc` sets their own).

## Search engines

- `robots.txt` comes from the Worker: it allows crawling on earprint.xyz and points to `sitemap.xml`, and blocks crawling on preview links. Every page has a canonical link to its earprint.xyz address.
- Every page has a title, description, Open Graph and Twitter tags with `assets/og.png`; the front page has JSON-LD (WebSite and WebApplication).
- When adding a page, add it to `public/sitemap.xml` and give it the same head tags.

## Hosting

Deployed on Cloudflare from this repository.

- Pushing to `main` updates earprint.xyz.
- Pushing any other branch builds a preview at `<branch>-earprint.bailey-guu.workers.dev`.

## Data sources

- Song previews, artist and genre data: Deezer's public API, called from the visitor's browser.
- The typical song (`TYPICAL` in `dsp.js`): 128 previews, 8 from each of 16 Deezer charts, measured with the lab's own analysis in November 2026. Only the medians and quartiles are kept.
- Typical songs per genre (`GENRE_TYPICAL` in `dsp.js`): the top 12 previews on each of 17 Deezer genre charts, measured the same way in November 2026. The lab finds a song's genre from its album on Deezer. "Even it out" and the song chart use the genre by default; "Bring out its character" always compares with all music, so a genre's own traits count as character.
- Headphone corrections: [AutoEq](https://github.com/jaakkopasanen/AutoEq) (MIT licence, copy in `public/assets/autoeq/LICENSE.txt`), its recommended result per model (`results/README.md`, one measurement per model from the most accurate source) at commit 7ae0f56 (July 2025). Each is a ten-filter parametric EQ towards the Harman over-ear target, AutoEq's in-ear target or a rig-specific version. Served from this site, so the lab never contacts AutoEq or GitHub. To update: shallow-clone AutoEq (a blob-less partial clone with a sparse checkout of `results/**/*ParametricEQ.txt` and `results/README.md` is enough), then run `python3 -I tools/autoeq_build.py <autoeq checkout> public/assets/autoeq <commit> <date>`.
- Hearing and age: ISO 7029:2017 Formula (1) and Table 1 (median threshold change from age 18, by sex, 125 Hz–8 kHz, ages 18–80). The lab's compensation gives back a third (Gentle) or half (Stronger) of the change above the 500 Hz–1 kHz level, eased above 8 kHz and capped at +6 dB, played as four high shelves and a 16 kHz dip.
- Export formats were checked against each app's documentation (Equalizer APO configuration reference, Wavelet's import format). With your setup on, fixed-band exports are fitted to setting + correction + age lift; Equalizer APO gets the exact filters and Wavelet the exact curve; the car and speaker export leaves out the headphone correction.
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
