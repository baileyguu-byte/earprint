// Earprint EQ lab.
import * as dz from './deezer.js';
import { AC, BANDS, BAND_LABELS, BAND_NAMES, Q, RANGE, PRESETS, N_CURVE, CURVE_F, responseDb, kWeight, meanPower, decode, analyse } from './dsp.js';
import { makeDemo } from './demo.js';
import { FORMATS, buildExport } from './exports.js';

/* ---------- Helpers ---------- */
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const store = {
  get(k, d) { try { const v = localStorage.getItem('earprint:' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('earprint:' + k, JSON.stringify(v)); } catch (e) {} }
};
const compact = new Intl.NumberFormat('en-AU', { notation: 'compact', maximumFractionDigits: 1 });
const fansText = (n) => (typeof n === 'number' ? compact.format(n) + (n === 1 ? ' fan' : ' fans') : '');
const fmtTime = (s, tenths = false) => {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60), r = s - m * 60;
  return m + ':' + (tenths ? r.toFixed(1).padStart(4, '0') : String(Math.floor(r)).padStart(2, '0'));
};
const sgn = (v, d = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
function img(src, cls) {
  if (!src) {
    const s = el('span', 'ph' + (cls ? ' ' + cls : ''));
    s.setAttribute('aria-hidden', 'true');
    return s;
  }
  const i = document.createElement('img');
  i.src = src; i.alt = ''; i.loading = 'lazy'; i.decoding = 'async'; i.referrerPolicy = 'no-referrer';
  return i;
}
function flash(btn, text) {
  const old = btn.dataset.label || btn.textContent;
  btn.dataset.label = old;
  btn.textContent = text;
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.textContent = old; }, 1600);
}

/* ---------- State ---------- */
const validGains = (g) => Array.isArray(g) && g.length === 10 && g.every((v) => typeof v === 'number' && isFinite(v) && Math.abs(v) <= RANGE);
const saved = store.get('slots', null);
const state = {
  slots: (saved && saved.A && saved.B && validGains(saved.A.gains) && validGains(saved.B.gains))
    ? { A: { name: String(saved.A.name || 'Custom'), gains: saved.A.gains }, B: { name: String(saved.B.name || 'Custom'), gains: saved.B.gains } }
    : { A: { name: 'Flat', gains: PRESETS['Flat'].slice() }, B: { name: 'Warm', gains: PRESETS['Warm'].slice() } },
  active: 'A',
  match: store.get('match', true) !== false,
  layers: Object.assign({ spectrum: true, average: true, curve: true }, store.get('layers', {})),
  picks: (store.get('artists', null) || store.get('five', []) || []).filter((a) => a && a.id && a.name).slice(0, 5),
  fmt: store.get('fmt', 'apple'),
  track: null,
  demo: null,
  playing: false,
  offset: 0,
  startOffset: 0,
  startedAt: 0,
  loop: null,
  draft: null,
  blind: null,
  view: null,
  loadToken: 0,
  deezer: null,
  genres: dz.FALLBACK_GENRES.slice()
};
if (!FORMATS.some((f) => f.id === state.fmt)) state.fmt = 'apple';
const gainsOf = (s) => state.slots[s].gains;

/* ---------- Audio graph ---------- */
let ctx = null, voice = null, filters = [], comp = null, limiter = null, analyser = null, master = null, specBuf = null;

function ensureCtx() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  ctx = new AC();
  const g = gainsOf(state.active);
  filters = BANDS.map((f, i) => {
    const b = ctx.createBiquadFilter();
    b.type = 'peaking'; b.frequency.value = f; b.Q.value = Q; b.gain.value = g[i];
    return b;
  });
  for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1]);
  comp = ctx.createGain();
  comp.gain.value = compFor(state.active);
  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.15;
  analyser = ctx.createAnalyser();
  analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0.78;
  master = ctx.createGain();
  master.gain.value = +$('vol').value;
  filters[filters.length - 1].connect(comp);
  comp.connect(limiter); limiter.connect(analyser); analyser.connect(master); master.connect(ctx.destination);
  specBuf = new Float32Array(analyser.frequencyBinCount);
  return ctx;
}
function rampTo(param, v) {
  const t = ctx.currentTime;
  if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(t);
  else { param.cancelScheduledValues(t); param.setValueAtTime(param.value, t); }
  param.setTargetAtTime(v, t, 0.012);
}
function applyLive() {
  if (!ctx) return;
  const g = gainsOf(state.active);
  filters.forEach((f, i) => rampTo(f.gain, g[i]));
  rampTo(comp.gain, compFor(state.active));
}

/* Loudness matching: estimate how much an EQ changes perceived level for this song, then undo it. */
function trackWeights() {
  const fp = state.track && state.track.fp;
  return Array.from(CURVE_F, (f, i) => (fp ? fp.density[i] * f : 1) * kWeight(f));
}
const curveCache = {};
function curveOf(s) {
  const key = gainsOf(s).join(',');
  if (curveCache[s] && curveCache[s].key === key) return curveCache[s].db;
  const db = responseDb(gainsOf(s), CURVE_F);
  curveCache[s] = { key, db };
  return db;
}
function compFor(s) {
  if (!state.match) return 1;
  const w = trackWeights(), db = curveOf(s);
  let num = 0, den = 0;
  for (let i = 0; i < N_CURVE; i++) { num += w[i]; den += w[i] * Math.pow(10, db[i] / 10); }
  const c = Math.sqrt(num / den);
  return isFinite(c) ? Math.min(4, Math.max(0.25, c)) : 1;
}

/* ---------- Playback (with an optional loop section) ---------- */
const duration = () => (state.track ? state.track.buffer.duration : 0);
function clampToLoop(pos) {
  const d = duration(), L = state.loop;
  if (L && (pos < L.start || pos >= L.end - 0.02)) return L.start;
  return Math.min(Math.max(0, pos), Math.max(0, d - 0.01));
}
function position() {
  const d = duration();
  if (!d) return 0;
  if (!state.playing || !ctx) return Math.min(state.offset, d);
  const raw = state.startOffset + (ctx.currentTime - state.startedAt);
  const L = state.loop;
  if (L) return raw < L.end ? raw : L.start + ((raw - L.start) % (L.end - L.start));
  return raw % d;
}
function startVoice(pos) {
  pos = clampToLoop(pos);
  const t = ctx.currentTime;
  const s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = state.track.buffer;
  s.loop = true;
  if (state.loop) { s.loopStart = state.loop.start; s.loopEnd = state.loop.end; }
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(1, t + 0.015);
  s.connect(g); g.connect(filters[0]);
  s.start(t, pos);
  voice = { s, g };
  state.startOffset = pos;
  state.startedAt = t;
}
function stopVoice() {
  const v = voice;
  voice = null;
  if (!v) return;
  const t = ctx.currentTime;
  v.g.gain.cancelScheduledValues(t);
  v.g.gain.setValueAtTime(v.g.gain.value, t);
  v.g.gain.linearRampToValueAtTime(0, t + 0.015);
  try { v.s.stop(t + 0.03); } catch (e) {}
  setTimeout(() => { try { v.s.disconnect(); v.g.disconnect(); } catch (e) {} }, 200);
}
function play() {
  if (!state.track || state.playing) return;
  ensureCtx();
  startVoice(state.offset);
  state.playing = true;
  renderPlay();
  startTick();
  if (ctx.state !== 'running') {
    ctx.resume().catch(() => {});
    setTimeout(() => {
      if (ctx.state !== 'running' && state.playing) { pause(); setStatus('Press play to start listening.'); }
    }, 700);
  }
}
function pause() {
  if (!state.playing) return;
  state.offset = position();
  stopVoice();
  state.playing = false;
  renderPlay(); renderTime(); drawWave(); scheduleDraw();
}
function togglePlay() { if (state.playing) pause(); else play(); }
function seek(t) {
  if (!state.track) return;
  t = Math.max(0, Math.min(duration(), t));
  if (state.playing) { stopVoice(); startVoice(t); }
  else state.offset = clampToLoop(t);
  renderTime(); drawWave();
}
function setLoop(L, opts = {}) {
  const pos = position();
  state.loop = L;
  state.draft = null;
  if (state.playing) { stopVoice(); startVoice(opts.restart && L ? L.start : pos); }
  else state.offset = L ? (opts.restart ? L.start : clampToLoop(state.offset)) : state.offset;
  renderLoop(); renderTime(); drawWave();
  if (opts.autoplay && !state.playing) play();
}

function setTrack(t, autoplay) {
  const was = state.playing;
  if (state.playing) { stopVoice(); state.playing = false; }
  state.track = t;
  state.offset = 0;
  state.loop = null;
  state.draft = null;
  peaks = null; lastVis = null;
  buildWavePeaks();
  applyLive();
  renderLevel(); renderNow(); renderLoop(); renderTime(); renderFingerprint(); renderExport(); renderPlay(); markCurrent();
  drawWave(); scheduleDraw();
  if (autoplay || was) play();
}

/* ---------- Loading songs ---------- */
async function playDeezerTrack(t) {
  ensureCtx();
  const token = ++state.loadToken;
  setStatus('Loading “' + (t.title_short || t.title) + '”…');
  try {
    const fresh = await dz.track(t.id);
    if (!fresh.preview) throw new Error('Deezer has no preview for this song.');
    const res = await fetch(fresh.preview);
    if (!res.ok) throw new Error('The preview server returned an error (' + res.status + ').');
    const buffer = await decode(await res.arrayBuffer());
    const fp = await analyse(buffer).catch(() => null);
    if (token !== state.loadToken) return;
    setTrack({
      id: fresh.id, buffer, fp, source: 'deezer',
      title: fresh.title_short || fresh.title,
      artist: fresh.artist ? fresh.artist.name : '',
      art: fresh.album ? (fresh.album.cover_medium || fresh.album.cover_small) : '',
      link: fresh.link
    }, true);
    setStatus('');
  } catch (e) {
    if (token !== state.loadToken) return;
    setStatus('Couldn’t play that song. ' + (e.message || '') + ' Try another one.');
  }
}
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|wave|flac|ogg|oga|opus|aif|aiff|webm|mp4)$/i;
async function loadFile(file) {
  if (!(file.type || '').startsWith('audio/') && !AUDIO_EXT.test(file.name)) {
    setStatus('“' + file.name + '” isn’t an audio file. Try an MP3, M4A, WAV, FLAC or OGG file.');
    return;
  }
  const token = ++state.loadToken;
  setStatus('Reading ' + file.name + '…');
  try {
    const buffer = await decode(await file.arrayBuffer());
    const fp = await analyse(buffer).catch(() => null);
    if (token !== state.loadToken) return;
    setTrack({ id: null, buffer, fp, source: 'file', title: file.name.replace(/\.[^.]+$/, ''), artist: 'Your file · stays on this device', art: '', link: '' }, true);
    setStatus('');
  } catch (e) {
    if (token !== state.loadToken) return;
    setStatus('That file couldn’t be decoded. Try an MP3, M4A, WAV, FLAC or OGG file.');
  }
}

/* ---------- Search, suggestions and views ---------- */
const qEl = $('q'), sugEl = $('suggest');
const sug = { items: [], active: -1, timer: 0, token: 0 };
let viewToken = 0;

function setStatus(msg) { $('status').textContent = msg; }
function dzFail(e, what) {
  if (e && e.code === 'blocked' && state.deezer !== true) { deezerBlocked(); return; }
  setStatus(e && e.code === 'quota' ? 'Deezer is busy. Wait a few seconds and try again.' : what + ' didn’t work. Check your connection and try again.');
}
function deezerBlocked() {
  state.deezer = false;
  $('hostNote').hidden = false;
  qEl.disabled = true;
  $('searchBtn').disabled = true;
  $('viewBox').hidden = true;
  $('genreBox').hidden = true;
  closeSuggest();
  renderPicks();
  setStatus('');
}

function openSuggest() { sugEl.hidden = false; qEl.setAttribute('aria-expanded', 'true'); }
function closeSuggest() {
  sugEl.hidden = true;
  qEl.setAttribute('aria-expanded', 'false');
  qEl.removeAttribute('aria-activedescendant');
  if (sug.active >= 0) { const o = $('sg-' + sug.active); if (o) o.setAttribute('aria-selected', 'false'); }
  sug.active = -1;
}
function setActive(i, scroll = true) {
  if (sug.active >= 0) { const prev = $('sg-' + sug.active); if (prev) prev.setAttribute('aria-selected', 'false'); }
  sug.active = i;
  const o = $('sg-' + i);
  if (o) {
    o.setAttribute('aria-selected', 'true');
    qEl.setAttribute('aria-activedescendant', o.id);
    if (scroll) o.scrollIntoView({ block: 'nearest' });
  }
}
function sugGroup(title, items) {
  if (!items.length) return;
  const g = el('div', 'sg-group');
  const h = el('div', 'sg-head', title);
  h.id = 'sgh-' + title.toLowerCase();
  g.setAttribute('role', 'group');
  g.setAttribute('aria-labelledby', h.id);
  g.append(h);
  items.forEach((it) => {
    const i = sug.items.length;
    sug.items.push(it);
    const o = el('div', 'sg-opt ' + it.type);
    o.id = 'sg-' + i;
    o.setAttribute('role', 'option');
    o.setAttribute('aria-selected', 'false');
    o.append(img(it.pic, it.type === 'genre' ? 'demo' : ''));
    const m = el('div', 'sg-main');
    m.append(el('b', null, it.title));
    if (it.sub) m.append(el('small', null, it.sub));
    o.append(m, el('span', 'sg-side', it.side || ''));
    o.addEventListener('mousedown', (e) => e.preventDefault());
    o.addEventListener('click', () => choose(i));
    o.addEventListener('mousemove', () => { if (sug.active !== i) setActive(i, false); });
    g.append(o);
  });
  sugEl.append(g);
}
function renderSuggest(q, data, err) {
  sug.items = [];
  sug.active = -1;
  sugEl.textContent = '';
  qEl.removeAttribute('aria-activedescendant');
  if (err) {
    sugEl.append(el('p', 'sg-empty', err.code === 'quota' ? 'Deezer is busy. Keep typing, or press Search in a moment.' : 'Suggestions aren’t loading. Press Search to try again.'));
    openSuggest();
    return;
  }
  const artists = dz.dedupeArtists((data && data.artists && data.artists.data) || []).slice(0, 4);
  const tracks = ((data && data.tracks && data.tracks.data) || []).slice(0, 5);
  const genres = dz.matchGenres(state.genres, q).slice(0, 2);
  sugGroup('Artists', artists.map((a) => ({ type: 'artist', data: a, title: a.name, sub: fansText(a.nb_fan), pic: a.picture_small })));
  sugGroup('Songs', tracks.map((t) => ({
    type: 'track', data: t, title: t.title_short || t.title,
    sub: (t.artist ? t.artist.name : '') + (t.album && t.album.title ? ' · ' + t.album.title : ''),
    pic: t.album && t.album.cover_small, side: t.preview ? '' : 'No preview'
  })));
  sugGroup('Genres', genres.map((g) => ({ type: 'genre', data: g, title: g.name, sub: 'Popular songs in this genre', pic: g.picture_small, side: 'Genre' })));
  if (!sug.items.length) sugEl.append(el('p', 'sg-empty', 'No matches for “' + q + '”. Try another spelling.'));
  openSuggest();
}
async function loadSuggest(q) {
  const token = ++sug.token;
  try {
    const data = await dz.suggest(q);
    if (token !== sug.token || qEl.value.trim() !== q || document.activeElement !== qEl) return;
    renderSuggest(q, data);
  } catch (e) {
    if (token !== sug.token) return;
    if (e.code === 'blocked' && state.deezer !== true) { deezerBlocked(); return; }
    if (document.activeElement === qEl) renderSuggest(q, null, e);
  }
}
function choose(i) {
  const it = sug.items[i];
  if (!it) return;
  closeSuggest();
  if (it.type === 'artist') {
    openArtist(it.data);
  } else if (it.type === 'track') {
    if (it.data.preview) playDeezerTrack(it.data);
    else setStatus('Deezer has no preview for that song. Try another one.');
    if (it.data.artist) openArtist(it.data.artist, { quiet: true });
  } else if (it.type === 'genre') {
    openGenre(it.data);
  }
}

function artistChip(a) {
  const b = el('button', 'achip');
  b.type = 'button';
  b.append(img(a.picture_small || a.picture), el('span', 'nm', a.name));
  if (typeof a.nb_fan === 'number') b.append(el('span', 'fn', compact.format(a.nb_fan)));
  b.title = a.name + (typeof a.nb_fan === 'number' ? ' · ' + fansText(a.nb_fan) + ' on Deezer' : '');
  b.addEventListener('click', () => openArtist(a));
  return b;
}
function genreChip(g, withKind = true) {
  const b = el('button', 'gchip');
  b.type = 'button';
  if (withKind) b.append(el('span', 'kind', 'Genre'));
  b.append(el('span', null, g.name));
  b.addEventListener('click', () => openGenre(g));
  return b;
}
function trackRow(t, sub) {
  const b = el('button', 'trow');
  b.type = 'button';
  b.dataset.id = String(t.id);
  b.append(img(t.album && t.album.cover_small));
  const tx = el('span', 't');
  tx.append(el('b', null, t.title_short || t.title));
  const s = sub ? sub(t) : '';
  if (s) tx.append(el('small', null, s));
  const d = el('span', 'd');
  if (t.preview) {
    d.innerHTML = PLAY_SVG;
    b.setAttribute('aria-label', 'Play ' + (t.title_short || t.title) + (t.artist ? ' by ' + t.artist.name : ''));
  } else {
    d.textContent = 'No preview';
    b.disabled = true;
  }
  b.append(tx, d);
  b.addEventListener('click', () => playDeezerTrack(t));
  return b;
}
function renderView(v) {
  state.view = v;
  $('viewBox').hidden = false;
  $('viewLabel').textContent = v.label;
  const meta = $('viewMeta');
  meta.textContent = v.meta || '';
  meta.hidden = !v.meta;
  $('viewAction').hidden = v.kind !== 'artist';
  renderPickAction();
  const ab = $('viewArtists');
  ab.textContent = '';
  (v.artists || []).forEach((a) => ab.append(artistChip(a)));
  const gb = $('viewGenres');
  gb.textContent = '';
  (v.genres || []).forEach((g) => gb.append(genreChip(g)));
  const tb = $('viewTracks');
  tb.textContent = '';
  tb.scrollTop = 0;
  if (v.loading) tb.append(el('p', 'empty', 'Loading…'));
  (v.tracks || []).forEach((t) => tb.append(trackRow(t, v.sub)));
  markCurrent();
}
async function showPopular() {
  const token = ++viewToken;
  try {
    const [artists, tracks] = await Promise.all([dz.chartArtists(10), dz.chartTracks(10)]);
    state.deezer = true;
    renderPicks();
    if (token !== viewToken) return;
    renderView({ kind: 'popular', label: 'Popular on Deezer', artists, tracks, sub: (t) => (t.artist ? t.artist.name : '') });
  } catch (e) {
    if (e.code === 'blocked') deezerBlocked();
    else dzFail(e, 'Loading popular songs');
  }
}
async function openArtist(a, opts = {}) {
  const token = ++viewToken;
  const info = { id: a.id, name: a.name, picture_small: a.picture_small || a.picture || '', nb_fan: a.nb_fan };
  const meta = () => (typeof info.nb_fan === 'number' ? fansText(info.nb_fan) + ' on Deezer' : '');
  renderView({ kind: 'artist', label: 'Top songs · ' + a.name, artist: info, meta: meta(), loading: true });
  if (!opts.quiet) setStatus('');
  try {
    const [tracks, full] = await Promise.all([
      dz.artistTop(a.id, 10),
      typeof a.nb_fan === 'number' ? Promise.resolve(null) : dz.artist(a.id).catch(() => null)
    ]);
    if (token !== viewToken) return;
    if (full) {
      if (typeof full.nb_fan === 'number') info.nb_fan = full.nb_fan;
      if (!info.picture_small) info.picture_small = full.picture_small || '';
    }
    renderView({ kind: 'artist', label: 'Top songs · ' + a.name, artist: info, meta: meta(), tracks, sub: (t) => (t.album ? t.album.title : '') });
    if (!tracks.length && !opts.quiet) setStatus('Deezer has no songs listed for ' + a.name + '.');
  } catch (e) {
    if (token === viewToken) dzFail(e, 'Loading ' + a.name);
  }
}
async function openGenre(g) {
  const token = ++viewToken;
  $('genreBox').open = false;
  setStatus('');
  renderView({ kind: 'genre', label: g.name + ' · popular songs', loading: true });
  try {
    const tracks = await dz.genreChart(g.id, 50);
    if (token !== viewToken) return;
    const seen = new Set(), artists = [];
    tracks.forEach((t) => { if (t.artist && !seen.has(t.artist.id)) { seen.add(t.artist.id); artists.push(t.artist); } });
    renderView({
      kind: 'genre', label: g.name + ' · popular songs',
      meta: 'From Deezer’s ' + g.name + ' chart. Choose an artist for their top songs.',
      artists: artists.slice(0, 10), tracks, sub: (t) => (t.artist ? t.artist.name : '')
    });
  } catch (e) {
    if (token === viewToken) dzFail(e, 'Loading ' + g.name);
  }
}
async function runSearch(q) {
  const token = ++viewToken;
  sug.token++;
  clearTimeout(sug.timer);
  closeSuggest();
  setStatus('');
  renderView({ kind: 'results', label: 'Results for “' + q + '”', loading: true });
  try {
    const [artists, tracks] = await Promise.all([dz.searchArtists(q, 10), dz.searchTracks(q, 25)]);
    if (token !== viewToken) return;
    const genres = dz.matchGenres(state.genres, q).slice(0, 3);
    renderView({
      kind: 'results', label: 'Results for “' + q + '”',
      artists: dz.dedupeArtists(artists).slice(0, 8), genres, tracks,
      sub: (t) => (t.artist ? t.artist.name : '') + (t.album ? ' · ' + t.album.title : '')
    });
    if (!artists.length && !tracks.length && !genres.length) setStatus('Nothing found for “' + q + '”. Check the spelling or try another name.');
  } catch (e) {
    if (token === viewToken) dzFail(e, 'Search');
  }
}
async function loadGenres() {
  try {
    const list = await dz.genres();
    if (list.length) state.genres = list;
  } catch (e) {}
  renderGenreChips();
}
function renderGenreChips() {
  const box = $('genreChips');
  box.textContent = '';
  state.genres.forEach((g) => box.append(genreChip(g, false)));
}
function markCurrent() {
  const id = state.track && state.track.source === 'deezer' ? String(state.track.id) : null;
  document.querySelectorAll('.trow[data-id]').forEach((r) => {
    if (id && r.dataset.id === id) r.setAttribute('aria-current', 'true');
    else r.removeAttribute('aria-current');
  });
  if (state.track && state.track.source === 'demo') $('demoRow').setAttribute('aria-current', 'true');
  else $('demoRow').removeAttribute('aria-current');
}

/* Your artists: pick up to five */
function renderPicks() {
  const box = $('picks');
  box.textContent = '';
  const n = state.picks.length;
  $('pickCount').textContent = n ? n + ' of 5 picked' : 'Pick up to 5';
  if (!n) {
    box.append(el('span', 'empty', state.deezer === false ? 'Available once song search works.' : 'Open an artist and choose “Add to your artists”.'));
  }
  state.picks.forEach((a) => {
    const c = el('span', 'pchip');
    const open = el('button', null, a.name);
    open.type = 'button';
    open.addEventListener('click', () => openArtist({ id: a.id, name: a.name, picture_small: a.picture, nb_fan: a.nb_fan }));
    const x = el('button', 'x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Remove ' + a.name + ' from your artists');
    x.addEventListener('click', () => togglePick(a));
    c.append(open, x);
    box.append(c);
  });
  renderPickAction();
}
function renderPickAction() {
  const v = state.view, act = $('viewAction');
  if (!v || v.kind !== 'artist') return;
  const has = state.picks.some((p) => p.id === v.artist.id);
  act.textContent = has ? 'Remove from your artists' : (state.picks.length >= 5 ? '5 artists picked' : 'Add to your artists');
  act.disabled = !has && state.picks.length >= 5;
}
function togglePick(a) {
  const i = state.picks.findIndex((p) => p.id === a.id);
  if (i >= 0) state.picks.splice(i, 1);
  else if (state.picks.length < 5) state.picks.push({ id: a.id, name: a.name, picture: a.picture_small || a.picture || '', nb_fan: a.nb_fan });
  store.set('artists', state.picks);
  renderPicks();
}

/* ---------- Transport rendering ---------- */
function renderNow() {
  const t = state.track;
  if (!t) return;
  $('nowTitle').textContent = t.title;
  const sub = $('nowSub');
  sub.textContent = '';
  if (t.source === 'deezer' && t.link) {
    sub.append(document.createTextNode(t.artist + ' · '));
    const a = el('a', null, 'Preview on Deezer');
    a.href = t.link; a.target = '_blank'; a.rel = 'noopener';
    sub.append(a);
  } else sub.textContent = t.artist;
  const n = img(t.art, t.source === 'demo' ? 'demo' : '');
  n.id = 'nowArt';
  $('nowArt').replaceWith(n);
}
function renderPlay() {
  const p = state.playing;
  $('play').setAttribute('aria-label', p ? 'Pause' : 'Play');
  $('playIcon').innerHTML = p ? '<path d="M6 4.5h4.2v15H6zM13.8 4.5H18v15h-4.2z"/>' : '<path d="M7 4.5v15l13-7.5z"/>';
}
let lastAriaSec = -1;
function renderTime() {
  const d = duration(), p = position();
  $('time').textContent = fmtTime(p) + ' / ' + fmtTime(d);
  const s = Math.floor(p);
  if (s !== lastAriaSec) {
    lastAriaSec = s;
    waveEl.setAttribute('aria-valuemax', d.toFixed(1));
    waveEl.setAttribute('aria-valuenow', p.toFixed(1));
    waveEl.setAttribute('aria-valuetext', fmtTime(p) + ' of ' + fmtTime(d));
  }
}

/* ---------- Faders, settings A and B, blind test ---------- */
const faderEls = [];
function buildFaders() {
  const box = $('faders');
  BANDS.forEach((f, i) => {
    const col = el('div', 'fcol');
    const read = el('output', 'fread');
    const fd = el('div', 'fader');
    fd.tabIndex = 0;
    fd.setAttribute('role', 'slider');
    fd.setAttribute('aria-label', BAND_LABELS[i] + ' hertz');
    fd.setAttribute('aria-valuemin', -RANGE);
    fd.setAttribute('aria-valuemax', RANGE);
    fd.setAttribute('aria-orientation', 'vertical');
    fd.innerHTML = '<div class="ftrack"><div class="fzero"></div><div class="ffill"></div><div class="fthumb"></div></div>';
    col.append(read, fd, el('div', 'flab', BAND_LABELS[i]));
    box.append(col);
    const track = fd.querySelector('.ftrack');
    const fromY = (y) => {
      const r = track.getBoundingClientRect();
      return Math.round((-RANGE + (r.bottom - y) / r.height * 2 * RANGE) * 2) / 2;
    };
    let dragging = false;
    fd.addEventListener('pointerdown', (e) => {
      if (state.blind) return;
      dragging = true;
      fd.setPointerCapture(e.pointerId);
      fd.focus({ preventScroll: true });
      setGain(i, fromY(e.clientY));
      e.preventDefault();
    });
    fd.addEventListener('pointermove', (e) => { if (dragging) setGain(i, fromY(e.clientY)); });
    const end = () => { dragging = false; };
    fd.addEventListener('pointerup', end);
    fd.addEventListener('pointercancel', end);
    fd.addEventListener('dblclick', () => { if (!state.blind) setGain(i, 0); });
    fd.addEventListener('keydown', (e) => {
      if (state.blind) return;
      const v = gainsOf(state.active)[i];
      const map = { ArrowUp: 0.5, ArrowRight: 0.5, ArrowDown: -0.5, ArrowLeft: -0.5, PageUp: 3, PageDown: -3 };
      if (e.key in map) { setGain(i, v + map[e.key]); e.preventDefault(); }
      else if (e.key === 'Home') { setGain(i, RANGE); e.preventDefault(); }
      else if (e.key === 'End') { setGain(i, -RANGE); e.preventDefault(); }
      else if (e.key === '0') { setGain(i, 0); e.preventDefault(); }
    });
    faderEls.push({ read, fd, fill: fd.querySelector('.ffill'), thumb: fd.querySelector('.fthumb') });
  });
}
function renderFaders() {
  const g = gainsOf(state.active);
  $('faders').classList.toggle('slot-B', state.active === 'B');
  faderEls.forEach((e, i) => {
    const v = g[i], pos = (v + RANGE) / (2 * RANGE) * 100;
    e.thumb.style.bottom = pos + '%';
    if (v >= 0) { e.fill.style.bottom = '50%'; e.fill.style.height = (pos - 50) + '%'; }
    else { e.fill.style.bottom = pos + '%'; e.fill.style.height = (50 - pos) + '%'; }
    e.read.textContent = sgn(v);
    e.fd.setAttribute('aria-valuenow', v);
    e.fd.setAttribute('aria-valuetext', sgn(v) + ' dB');
  });
}
function presetName(g) {
  for (const [n, p] of Object.entries(PRESETS)) if (p.every((v, i) => v === g[i])) return n;
  return 'Custom';
}
function setGain(i, v) {
  v = Math.max(-RANGE, Math.min(RANGE, Math.round(v * 2) / 2));
  const slot = state.slots[state.active];
  if (slot.gains[i] === v) return;
  slot.gains[i] = v;
  slot.name = presetName(slot.gains);
  afterSlotChange();
}
function afterSlotChange() {
  store.set('slots', state.slots);
  applyLive(); renderFaders(); renderSlots(); renderLevel(); renderExport(); scheduleDraw();
}
function renderSlots() {
  const blind = state.blind;
  document.querySelectorAll('.slot').forEach((b, idx) => {
    const s = blind ? blind.order[idx] : b.dataset.slot;
    b.setAttribute('aria-pressed', String(s === state.active));
    b.querySelector('.k').textContent = blind ? String(idx + 1) : b.dataset.slot;
    b.querySelector('.n').textContent = blind ? 'Hidden' : state.slots[b.dataset.slot].name;
  });
  const other = state.active === 'A' ? 'B' : 'A';
  $('copySlot').textContent = 'Copy ' + state.active + ' to ' + other;
  $('resetSlot').textContent = 'Reset ' + state.active;
  $('lgCurveSw').style.background = blind ? '' : (state.active === 'A' ? 'var(--a)' : 'var(--b)');
}
function renderLevel() {
  if (!state.match) { $('level').textContent = 'Volume follows the EQ, so boosts sound louder.'; return; }
  if (state.blind) { $('level').textContent = 'Both settings play at matched loudness.'; return; }
  $('level').textContent = 'Level correction on ' + state.active + ': ' + sgn(20 * Math.log10(compFor(state.active))) + ' dB';
}
function selectSlot(s) {
  if (state.active === s) return;
  state.active = s;
  applyLive(); renderFaders(); renderSlots(); renderLevel(); renderExport(); scheduleDraw();
}
function swap() { selectSlot(state.active === 'A' ? 'B' : 'A'); }

function startBlind() {
  if (!state.track) return;
  ensureCtx();
  state.blind = { order: Math.random() < 0.5 ? ['A', 'B'] : ['B', 'A'], prevMatch: state.match };
  state.match = true;
  $('match').checked = true;
  document.body.classList.add('is-blind');
  $('blindStart').hidden = true;
  $('blindPick').hidden = false;
  $('blindResult').hidden = true;
  $('blindIntro').textContent = 'Switch between 1 and 2 as often as you like. Both play at the same loudness.';
  $('mask').hidden = false;
  $('faders').setAttribute('aria-hidden', 'true');
  state.active = state.blind.order[0];
  applyLive(); renderFaders(); renderSlots(); renderLevel(); renderExport(); scheduleDraw();
  if (!state.playing) play();
}
function endBlind(pickIdx) {
  const b = state.blind;
  if (!b) return;
  state.blind = null;
  state.match = b.prevMatch;
  $('match').checked = state.match;
  document.body.classList.remove('is-blind');
  $('blindStart').hidden = false;
  $('blindPick').hidden = true;
  $('mask').hidden = true;
  $('faders').removeAttribute('aria-hidden');
  $('blindIntro').textContent = 'Blind test: hide which setting is which, listen to both, then pick one.';
  if (pickIdx != null) {
    const win = b.order[pickIdx], lose = b.order[1 - pickIdx];
    const r = $('blindResult');
    r.hidden = false;
    r.textContent = 'You picked ' + (pickIdx + 1) + ', which was setting ' + win + ' (' + state.slots[win].name + '). Number ' + (2 - pickIdx) + ' was ' + lose + ' (' + state.slots[lose].name + ').';
    state.active = win;
  }
  applyLive(); renderFaders(); renderSlots(); renderLevel(); renderExport(); scheduleDraw();
}

/* ---------- Where this song lives ---------- */
function renderFingerprint() {
  const box = $('fpChart'), fp = state.track && state.track.fp;
  if (!fp) {
    box.textContent = '';
    $('fpText').textContent = state.track ? 'This song couldn’t be analysed in this browser.' : 'Analysing the song…';
    return;
  }
  const W = 400, H = 190, top = 20, bottom = 34, mid = top + (H - top - bottom) / 2, half = (H - top - bottom) / 2, scale = 15;
  const order = fp.rel.map((v, i) => [v, i]).filter(([, i]) => i < 9).sort((a, b) => b[0] - a[0]);
  const hot = new Set([order[0][1], order[1][1]]);
  const cw = W / 10;
  let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Energy per octave for this song">';
  fp.rel.forEach((v, i) => {
    const c = Math.max(-scale, Math.min(scale, v)), h = Math.abs(c) / scale * half;
    const x = i * cw + cw * 0.22, w = cw * 0.56, y = c >= 0 ? mid - h : mid;
    s += '<rect class="fp-bar' + (hot.has(i) ? ' hot' : '') + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + Math.max(1, h).toFixed(1) + '" rx="2"/>';
    const vy = c >= 0 ? y - 4 : y + h + 11;
    s += '<text class="fp-val" x="' + (i * cw + cw / 2).toFixed(1) + '" y="' + vy.toFixed(1) + '" text-anchor="middle">' + sgn(v, 0) + '</text>';
    s += '<text class="fp-lab" x="' + (i * cw + cw / 2).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle">' + BAND_LABELS[i] + '</text>';
  });
  s += '<line class="fp-zero" x1="0" x2="' + W + '" y1="' + mid + '" y2="' + mid + '"/></svg>';
  box.innerHTML = s;
  const [a, b] = [order[0][1], order[1][1]].sort((x, y) => x - y);
  const low = b <= 3, high = a >= 6;
  $('fpText').textContent = 'Most of the energy sits in the ' + BAND_NAMES[a] + ' (' + BAND_LABELS[a] + ' Hz) and ' + BAND_NAMES[b] + ' (' + BAND_LABELS[b] + ' Hz). ' +
    (low ? 'Earbuds and small headphones often roll off down here, so this song loses the most on them.'
      : high ? 'Headphones with harsh or dull treble will change this song the most.'
        : 'Headphones with an uneven midrange will change this song the most.');
}

/* ---------- Export ---------- */
let currentExport = null;
function buildTabs() {
  const box = $('exTabs');
  FORMATS.forEach((f) => {
    const b = el('button', 'tab', f.label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(f.id === state.fmt));
    b.addEventListener('click', () => {
      state.fmt = f.id;
      store.set('fmt', f.id);
      box.querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderExport();
    });
    box.append(b);
  });
}
function renderExport() {
  const blind = !!state.blind;
  $('exHidden').hidden = !blind;
  $('exSlot').textContent = blind ? '' : state.active;
  if (blind) return;
  const ex = buildExport(state.fmt, gainsOf(state.active), state.slots[state.active].name);
  currentExport = ex;
  const vis = $('exVisual');
  vis.innerHTML = ex.visual || '';
  vis.hidden = !ex.visual;
  $('out').textContent = ex.text;
  $('outNote').textContent = ex.note;
  $('copyOut').hidden = !ex.copy;
  $('dlOut').hidden = !ex.download;
}

/* ---------- Frequency scope ---------- */
const N_VIS = 160;
const VIS_F = new Float32Array(N_VIS).map((_, i) => 20 * Math.pow(1000, i / (N_VIS - 1)));
const SPEC_MIN = -105, SPEC_MAX = -18, CURVE_DB = 15;
const canvas = $('scope'), g2 = canvas.getContext('2d');
let raf = 0, drawQueued = false, peaks = null, lastVis = null, powBuf = null;
const colors = {};
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  ['--a', '--b', '--spec', '--muted', '--line', '--ink', '--well', '--panel'].forEach((k) => { colors[k] = cs.getPropertyValue(k).trim(); });
  waveBase = null;
  scheduleDraw();
  drawWave();
}
function rgba(hex, a) {
  const h = (hex || '#888888').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
function fitCanvas(c) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), r = c.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; return true; }
  return false;
}
function scheduleDraw() {
  if (state.playing || drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; drawScope(false); });
}
function startTick() { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); }
function tick() {
  drawScope(true); renderTime(); drawWave();
  if (state.playing) raf = requestAnimationFrame(tick);
}
function liveVis() {
  analyser.getFloatFrequencyData(specBuf);
  const binHz = ctx.sampleRate / analyser.fftSize;
  if (!powBuf || powBuf.length !== specBuf.length) powBuf = new Float64Array(specBuf.length);
  for (let k = 0; k < specBuf.length; k++) powBuf[k] = isFinite(specBuf[k]) ? Math.pow(10, specBuf[k] / 10) : 0;
  const out = new Float32Array(N_VIS);
  for (let i = 0; i < N_VIS; i++) out[i] = 10 * Math.log10(Math.max(meanPower(powBuf, VIS_F[i], 1 / 14, binHz), 1e-14));
  return out;
}
function drawScope(live) {
  const W = canvas.width, H = canvas.height;
  if (W < 2) return;
  const dpr = W / Math.max(1, canvas.getBoundingClientRect().width);
  const padB = 20 * dpr, padT = 10 * dpr, plotH = H - padB - padT, padR = 44 * dpr, plotW = W - padR;
  const X = (f) => Math.log(f / 20) / Math.log(1000) * plotW;
  const YS = (db) => padT + plotH - (Math.max(SPEC_MIN, Math.min(SPEC_MAX, db)) - SPEC_MIN) / (SPEC_MAX - SPEC_MIN) * plotH;
  const YC = (db) => padT + plotH / 2 - Math.max(-CURVE_DB, Math.min(CURVE_DB, db)) / CURVE_DB * (plotH / 2 - 6 * dpr);
  g2.clearRect(0, 0, W, H);

  g2.lineWidth = 1;
  g2.font = (10.5 * dpr) + 'px "JetBrains Mono", ui-monospace, monospace';
  g2.textBaseline = 'alphabetic';
  [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach((f) => {
    const x = Math.round(X(f)) + 0.5;
    g2.strokeStyle = rgba(colors['--muted'], 0.16);
    g2.beginPath(); g2.moveTo(x, padT); g2.lineTo(x, padT + plotH); g2.stroke();
    g2.fillStyle = colors['--muted']; g2.textAlign = 'center';
    g2.fillText(f >= 1000 ? (f / 1000) + 'k' : String(f), x, H - 6 * dpr);
  });
  g2.textAlign = 'left';
  g2.fillStyle = colors['--muted'];
  g2.fillText('Hz', 4 * dpr, H - 6 * dpr);
  [12, 6, 0, -6, -12].forEach((db) => {
    const y = Math.round(YC(db)) + 0.5;
    g2.strokeStyle = rgba(colors['--muted'], db === 0 ? 0.42 : 0.14);
    g2.setLineDash(db === 0 ? [] : [3 * dpr, 4 * dpr]);
    g2.beginPath(); g2.moveTo(0, y); g2.lineTo(plotW, y); g2.stroke();
    g2.setLineDash([]);
    g2.fillText((db > 0 ? '+' : db < 0 ? '−' : ' ') + Math.abs(db) + ' dB', plotW + 6 * dpr, y + 3.5 * dpr);
  });

  const blind = !!state.blind;
  if (state.layers.spectrum && !blind) {
    let vis = null;
    if (live && analyser) {
      vis = liveVis();
      lastVis = vis;
      if (!peaks) peaks = Float32Array.from(vis);
      for (let i = 0; i < N_VIS; i++) peaks[i] = Math.max(vis[i], peaks[i] - 0.5);
    } else vis = lastVis;
    if (vis) {
      const grad = g2.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, rgba(colors['--spec'], live ? 0.55 : 0.25));
      grad.addColorStop(1, rgba(colors['--spec'], 0.04));
      g2.beginPath(); g2.moveTo(0, padT + plotH);
      for (let i = 0; i < N_VIS; i++) g2.lineTo(X(VIS_F[i]), YS(vis[i]));
      g2.lineTo(plotW, padT + plotH); g2.closePath();
      g2.fillStyle = grad; g2.fill();
      g2.beginPath();
      for (let i = 0; i < N_VIS; i++) { const x = X(VIS_F[i]), y = YS(vis[i]); if (i) g2.lineTo(x, y); else g2.moveTo(x, y); }
      g2.strokeStyle = rgba(colors['--spec'], live ? 0.85 : 0.4); g2.lineWidth = 1.25 * dpr; g2.stroke();
      if (peaks && live) {
        g2.beginPath();
        for (let i = 0; i < N_VIS; i++) { const x = X(VIS_F[i]), y = YS(peaks[i]); if (i) g2.lineTo(x, y); else g2.moveTo(x, y); }
        g2.strokeStyle = rgba(colors['--spec'], 0.3); g2.lineWidth = 1 * dpr; g2.stroke();
      }
    }
  }

  const fp = state.track && state.track.fp;
  if (state.layers.average && fp) {
    g2.beginPath();
    for (let i = 0; i < N_CURVE; i++) { const x = X(CURVE_F[i]), y = YS(fp.avgDb[i]); if (i) g2.lineTo(x, y); else g2.moveTo(x, y); }
    g2.setLineDash([4 * dpr, 3 * dpr]);
    g2.strokeStyle = rgba(colors['--muted'], 0.95); g2.lineWidth = 1.4 * dpr; g2.stroke();
    g2.setLineDash([]);
  }

  if (state.layers.curve && !blind) {
    const other = state.active === 'A' ? 'B' : 'A';
    [[other, false], [state.active, true]].forEach(([s, on]) => {
      const db = curveOf(s), col = colors[s === 'A' ? '--a' : '--b'];
      g2.beginPath();
      for (let i = 0; i < N_CURVE; i++) { const x = X(CURVE_F[i]), y = YC(db[i]); if (i) g2.lineTo(x, y); else g2.moveTo(x, y); }
      g2.setLineDash(on ? [] : [6 * dpr, 4 * dpr]);
      g2.strokeStyle = on ? col : rgba(col, 0.55); g2.lineWidth = (on ? 2.6 : 1.6) * dpr; g2.stroke();
      g2.setLineDash([]);
      if (on) {
        BANDS.forEach((f, i) => {
          g2.beginPath(); g2.arc(X(f), YC(gainsOf(s)[i]), 3 * dpr, 0, Math.PI * 2);
          g2.fillStyle = col; g2.fill();
        });
      }
      g2.font = '600 ' + (11 * dpr) + 'px "Instrument Sans", system-ui, sans-serif';
      g2.textAlign = 'left';
      g2.fillStyle = on ? col : rgba(col, 0.7);
      g2.fillText(s, (on ? 6 : 20) * dpr, YC(db[0]) - 6 * dpr);
    });
  }

  const msg = !state.track ? 'Preparing the demo loop…' : blind ? 'Hidden during the blind test. Just listen.' : '';
  if (msg) {
    g2.fillStyle = colors['--muted'];
    g2.textAlign = 'center';
    g2.font = (13 * dpr) + 'px "Instrument Sans", system-ui, sans-serif';
    g2.fillText(msg, plotW / 2, padT + plotH / 2);
  }
}

/* ---------- Waveform strip and loop section ---------- */
const waveEl = $('wave'), waveCanvas = waveEl.querySelector('canvas'), wg = waveCanvas.getContext('2d');
const WAVE_N = 1600, MIN_LOOP = 0.5, HANDLE_PX = 10;
let wavePeaks = null, waveBase = null, waveDrag = null;

function buildWavePeaks() {
  waveBase = null;
  const t = state.track;
  if (!t) { wavePeaks = null; return; }
  const b = t.buffer, n = b.length, chs = Math.min(2, b.numberOfChannels);
  const data = [];
  for (let c = 0; c < chs; c++) data.push(b.getChannelData(c));
  const out = new Float32Array(WAVE_N * 2), step = n / WAVE_N;
  for (let i = 0; i < WAVE_N; i++) {
    const s0 = Math.floor(i * step), s1 = Math.min(n, Math.floor((i + 1) * step));
    let mn = 1, mx = -1;
    for (let k = s0; k < s1; k += 2) {
      let v = 0;
      for (let c = 0; c < chs; c++) v += data[c][k];
      v /= chs;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    if (mn > mx) { mn = 0; mx = 0; }
    out[i * 2] = mn; out[i * 2 + 1] = mx;
  }
  wavePeaks = out;
}
function renderWaveBase() {
  const W = waveCanvas.width, H = waveCanvas.height;
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const g = off.getContext('2d');
  if (wavePeaks) {
    let peak = 0.01;
    for (let i = 0; i < wavePeaks.length; i++) peak = Math.max(peak, Math.abs(wavePeaks[i]));
    const mid = H / 2, amp = (H / 2 - 4) / peak;
    g.fillStyle = rgba(colors['--spec'], 0.5);
    for (let x = 0; x < W; x++) {
      const i0 = Math.floor(x / W * WAVE_N), i1 = Math.max(i0 + 1, Math.floor((x + 1) / W * WAVE_N));
      let mn = 1, mx = -1;
      for (let i = i0; i < i1 && i < WAVE_N; i++) { mn = Math.min(mn, wavePeaks[i * 2]); mx = Math.max(mx, wavePeaks[i * 2 + 1]); }
      if (mn > mx) continue;
      const y0 = mid - mx * amp, y1 = mid - mn * amp;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }
  waveBase = off;
}
function drawWave() {
  const W = waveCanvas.width, H = waveCanvas.height;
  if (W < 2) return;
  if (!waveBase || waveBase.width !== W || waveBase.height !== H) renderWaveBase();
  wg.clearRect(0, 0, W, H);
  wg.drawImage(waveBase, 0, 0);
  const d = duration();
  if (!d) return;
  const dpr = W / Math.max(1, waveCanvas.getBoundingClientRect().width);
  const L = state.draft || state.loop;
  if (L) {
    const x0 = L.start / d * W, x1 = L.end / d * W;
    wg.fillStyle = rgba(colors['--panel'], 0.65);
    wg.fillRect(0, 0, x0, H);
    wg.fillRect(x1, 0, W - x1, H);
    wg.fillStyle = rgba(colors['--spec'], 0.1);
    wg.fillRect(x0, 0, x1 - x0, H);
    [x0, x1].forEach((x) => {
      wg.fillStyle = colors['--ink'];
      wg.fillRect(Math.round(x - dpr), 0, Math.max(2, Math.round(2 * dpr)), H);
      const gw = 8 * dpr, gh = 24 * dpr, gx = x - gw / 2, gy = H / 2 - gh / 2;
      wg.beginPath();
      if (wg.roundRect) wg.roundRect(gx, gy, gw, gh, 3 * dpr); else wg.rect(gx, gy, gw, gh);
      wg.fill();
    });
  }
  const px = position() / d * W;
  wg.fillStyle = rgba(colors['--ink'], 0.85);
  wg.fillRect(Math.round(px - dpr / 2), 0, Math.max(1, Math.round(1.5 * dpr)), H);
}
function waveTime(clientX) {
  const r = waveEl.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration();
}
function waveHit(clientX) {
  const L = state.loop, d = duration();
  if (!L || !d) return 'none';
  const r = waveEl.getBoundingClientRect();
  const xs = r.left + L.start / d * r.width, xe = r.left + L.end / d * r.width;
  if (Math.abs(clientX - xs) <= HANDLE_PX) return 'start';
  if (Math.abs(clientX - xe) <= HANDLE_PX) return 'end';
  if (clientX > xs && clientX < xe) return 'move';
  return 'none';
}
function renderLoop(draft) {
  const L = draft || state.loop, info = $('loopInfo');
  info.textContent = '';
  if (L) {
    info.append('Looping ', el('b', null, fmtTime(L.start, true)), ' to ', el('b', null, fmtTime(L.end, true)), ' (' + (L.end - L.start).toFixed(1) + ' s)');
  } else if (state.track) {
    info.textContent = 'Drag across the waveform to loop a section. Click to jump.';
  }
  $('loopClear').disabled = !state.loop;
  $('loopStart').disabled = !state.track;
  $('loopEnd').disabled = !state.track;
}
function bindWave() {
  waveEl.addEventListener('pointerdown', (e) => {
    if (!state.track || e.button > 0) return;
    ensureCtx();
    const hit = waveHit(e.clientX);
    waveDrag = { mode: hit === 'none' ? 'new' : hit, x0: e.clientX, t0: waveTime(e.clientX), moved: false, orig: state.loop ? { ...state.loop } : null };
    waveEl.setPointerCapture(e.pointerId);
    waveEl.classList.add('dragging');
    waveEl.focus({ preventScroll: true });
    e.preventDefault();
  });
  waveEl.addEventListener('pointermove', (e) => {
    if (!waveDrag) {
      const h = waveHit(e.clientX);
      waveEl.classList.toggle('on-handle', h === 'start' || h === 'end');
      waveEl.classList.toggle('in-loop', h === 'move');
      return;
    }
    if (Math.abs(e.clientX - waveDrag.x0) > 4) waveDrag.moved = true;
    if (!waveDrag.moved) return;
    const d = duration(), t = waveTime(e.clientX), o = waveDrag.orig;
    let L;
    if (waveDrag.mode === 'start') L = { start: Math.min(t, o.end - MIN_LOOP), end: o.end };
    else if (waveDrag.mode === 'end') L = { start: o.start, end: Math.max(t, o.start + MIN_LOOP) };
    else if (waveDrag.mode === 'move') {
      const len = o.end - o.start, s = Math.max(0, Math.min(d - len, o.start + (t - waveDrag.t0)));
      L = { start: s, end: s + len };
    } else L = { start: Math.min(waveDrag.t0, t), end: Math.max(waveDrag.t0, t) };
    L.start = Math.max(0, L.start);
    L.end = Math.min(d, L.end);
    state.draft = L;
    renderLoop(L);
    drawWave();
  });
  const finish = (cancel) => {
    if (!waveDrag) return;
    const dr = waveDrag;
    waveDrag = null;
    waveEl.classList.remove('dragging');
    if (cancel) { state.draft = null; renderLoop(); drawWave(); return; }
    if (!dr.moved) {
      if (dr.mode === 'new') { if (state.loop) setLoop(null); seek(dr.t0); }
      else if (dr.mode === 'move') seek(dr.t0);
      return;
    }
    const L = state.draft;
    state.draft = null;
    if (L && L.end - L.start >= MIN_LOOP) setLoop(L, { restart: dr.mode === 'new' || dr.mode === 'move', autoplay: dr.mode === 'new' });
    else { renderLoop(); drawWave(); }
  };
  waveEl.addEventListener('pointerup', () => finish(false));
  waveEl.addEventListener('pointercancel', () => finish(true));
  waveEl.addEventListener('lostpointercapture', () => finish(false));
  waveEl.addEventListener('keydown', (e) => {
    if (!state.track) return;
    const step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { seek(position() - step); e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { seek(position() + step); e.preventDefault(); }
    else if (e.key === 'Home') { seek(state.loop ? state.loop.start : 0); e.preventDefault(); }
    else if (e.key === 'End') { seek(state.loop ? state.loop.end - 0.05 : duration() - 0.05); e.preventDefault(); }
  });
  $('loopStart').addEventListener('click', () => {
    if (!state.track) return;
    const d = duration(), p = position();
    const end = state.loop && state.loop.end - p >= MIN_LOOP ? state.loop.end : Math.min(d, p + 4);
    if (end - p < MIN_LOOP) { setStatus('Too close to the end to start a loop here.'); return; }
    setLoop({ start: p, end });
  });
  $('loopEnd').addEventListener('click', () => {
    if (!state.track) return;
    const p = position();
    const start = state.loop && p - state.loop.start >= MIN_LOOP ? state.loop.start : Math.max(0, p - 4);
    if (p - start < MIN_LOOP) { setStatus('Too close to the start to end a loop here.'); return; }
    setLoop({ start, end: p }, { restart: true });
  });
  $('loopClear').addEventListener('click', () => setLoop(null));
}

/* ---------- Drag and drop audio files ---------- */
function bindDrop() {
  let depth = 0;
  const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; $('drop').hidden = false; });
  window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) $('drop').hidden = true; });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    $('drop').hidden = true;
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) { ensureCtx(); loadFile(f); }
  });
}

/* ---------- Wiring ---------- */
function init() {
  buildFaders();
  buildTabs();
  bindWave();
  bindDrop();

  const sel = $('preset');
  sel.innerHTML = '<option value="">Load a preset…</option>' + Object.keys(PRESETS).map((n) => '<option>' + n + '</option>').join('');
  sel.addEventListener('change', () => {
    const n = sel.value;
    if (!n) return;
    state.slots[state.active] = { name: n, gains: PRESETS[n].slice() };
    sel.value = '';
    afterSlotChange();
  });
  $('match').checked = state.match;
  $('match').addEventListener('change', (e) => {
    state.match = e.target.checked;
    store.set('match', state.match);
    applyLive(); renderLevel();
  });
  document.querySelectorAll('.slot').forEach((b, idx) => b.addEventListener('click', () => {
    ensureCtx();
    selectSlot(state.blind ? state.blind.order[idx] : b.dataset.slot);
  }));
  $('swap').addEventListener('click', () => { ensureCtx(); swap(); });
  $('copySlot').addEventListener('click', () => {
    const other = state.active === 'A' ? 'B' : 'A';
    state.slots[other] = { name: state.slots[state.active].name, gains: gainsOf(state.active).slice() };
    afterSlotChange();
  });
  $('resetSlot').addEventListener('click', () => {
    state.slots[state.active] = { name: 'Flat', gains: PRESETS['Flat'].slice() };
    afterSlotChange();
  });
  $('blindStart').addEventListener('click', startBlind);
  $('blindCancel').addEventListener('click', () => endBlind(null));
  document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => endBlind(+b.dataset.pick)));

  $('play').addEventListener('click', () => { ensureCtx(); togglePlay(); });
  $('vol').addEventListener('input', (e) => { if (master) master.gain.setTargetAtTime(+e.target.value, ctx.currentTime, 0.02); });
  [['lgSpectrum', 'spectrum'], ['lgAverage', 'average'], ['lgCurve', 'curve']].forEach(([id, k]) => {
    $(id).checked = state.layers[k];
    $(id).addEventListener('change', (e) => {
      state.layers[k] = e.target.checked;
      store.set('layers', state.layers);
      if (state.playing) drawScope(true); else scheduleDraw();
    });
  });

  $('copyOut').addEventListener('click', () => {
    const text = $('out').textContent, btn = $('copyOut');
    const fallback = () => {
      const r = document.createRange();
      r.selectNodeContents($('out'));
      const s = getSelection();
      s.removeAllRanges(); s.addRange(r);
      flash(btn, 'Text selected');
    };
    try { navigator.clipboard.writeText(text).then(() => flash(btn, 'Copied'), fallback); } catch (e) { fallback(); }
  });
  $('dlOut').addEventListener('click', () => {
    const d = currentExport && currentExport.download;
    if (!d) return;
    const url = URL.createObjectURL(new Blob([d.text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = d.filename;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    flash($('dlOut'), 'Downloaded');
  });

  $('searchForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = qEl.value.trim();
    if (q) runSearch(q);
  });
  qEl.addEventListener('input', () => {
    clearTimeout(sug.timer);
    const q = qEl.value.trim();
    if (q.length < 2 || state.deezer === false) { sug.token++; closeSuggest(); return; }
    sug.timer = setTimeout(() => loadSuggest(q), 200);
  });
  qEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (sugEl.hidden) {
        if (!sug.items.length || qEl.value.trim().length < 2) return;
        openSuggest();
      }
      e.preventDefault();
      const n = sug.items.length;
      if (!n) return;
      const down = e.key === 'ArrowDown';
      setActive(sug.active < 0 ? (down ? 0 : n - 1) : (sug.active + (down ? 1 : -1) + n) % n);
    } else if (e.key === 'Enter' && !sugEl.hidden && sug.active >= 0) {
      e.preventDefault();
      choose(sug.active);
    } else if (e.key === 'Escape' && !sugEl.hidden) {
      e.preventDefault();
      closeSuggest();
    }
  });
  qEl.addEventListener('focus', () => { if (sug.items.length && qEl.value.trim().length >= 2) openSuggest(); });
  qEl.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== qEl) closeSuggest(); }, 150));
  $('viewAction').addEventListener('click', () => { if (state.view && state.view.artist) togglePick(state.view.artist); });

  $('demoRow').addEventListener('click', () => {
    ensureCtx();
    state.loadToken++;
    if (state.demo) setTrack(state.demo, true);
    setStatus('');
  });
  $('fileBtn').addEventListener('click', () => { ensureCtx(); $('file').click(); });
  $('file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadFile(f);
    e.target.value = '';
  });

  document.addEventListener('keydown', (e) => {
    const t = e.target, tag = (t.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || t.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'x' || e.key === 'X') { ensureCtx(); swap(); }
    else if (e.key === ' ' && (t === document.body || t.classList.contains('fader') || t === waveEl)) { e.preventDefault(); ensureCtx(); togglePlay(); }
  });

  const ro = new ResizeObserver(() => {
    if (fitCanvas(canvas)) scheduleDraw();
    if (fitCanvas(waveCanvas)) { waveBase = null; drawWave(); }
  });
  ro.observe(canvas);
  ro.observe(waveCanvas);
  readColors();
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors); } catch (e) {}
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => scheduleDraw());

  renderFaders(); renderSlots(); renderLevel(); renderExport(); renderPicks(); renderLoop(); renderGenreChips();
  fitCanvas(canvas); fitCanvas(waveCanvas);
  scheduleDraw();

  makeDemo().then(async (buffer) => {
    const fp = await analyse(buffer).catch(() => null);
    state.demo = { id: null, buffer, fp, source: 'demo', title: 'Demo loop', artist: 'Made in your browser · loops every ' + buffer.duration.toFixed(1) + ' s', art: '', link: '' };
    $('demoDur').textContent = fmtTime(buffer.duration);
    if (!state.track) setTrack(state.demo, false);
  }).catch(() => { $('nowSub').textContent = 'The demo loop couldn’t be built in this browser.'; });

  showPopular();
  loadGenres();
}
init();
