// Earprint EQ lab.
import * as dz from './deezer.js';
import {
  AC, BANDS, BAND_LABELS, BAND_NAMES, Q, RANGE, SOFT, GUIDE, PRESETS, N_CURVE, CURVE_F, TYPICAL, typicalF, vsTypical,
  responseDb, kWeight, meanPower, decode, analyse, balanceCurve, tiltDb, fitGains
} from './dsp.js';
import { makeDemo } from './demo.js';
import { FORMATS, buildExport } from './exports.js';
import { BAND_INFO, FIXES } from './cheats.js';
import { renderBalance, renderArtists, outside } from './charts.js';

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
const dbText = (v) => sgn(v, Number.isInteger(v) ? 0 : 1) + ' dB';
const hz = (i) => (BAND_LABELS[i].includes('k') ? BAND_LABELS[i].replace('k', ' kHz') : BAND_LABELS[i] + ' Hz');
const PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
const playable = (t) => !!(t && t.preview) && t.readable !== false;
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
/** "−3 dB at 64 Hz and +2 dB at 8 kHz" for the biggest changes in a list of gains. */
function describeGains(g, max = 3) {
  const parts = g.map((v, i) => [v, i]).filter(([v]) => v !== 0).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]));
  if (!parts.length) return '';
  const shown = parts.slice(0, max).map(([v, i]) => dbText(v) + ' at ' + hz(i));
  const rest = parts.length - shown.length;
  if (rest > 0) return shown.join(', ') + ' and ' + rest + ' smaller ' + (rest === 1 ? 'change' : 'changes');
  return shown.length > 1 ? shown.slice(0, -1).join(', ') + ' and ' + shown[shown.length - 1] : shown[0];
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
  limit: store.get('limit', SOFT) === RANGE ? RANGE : SOFT,
  layers: Object.assign({ spectrum: true, average: true, typical: true, curve: true }, store.get('layers', {})),
  picks: (store.get('artists', null) || store.get('five', []) || []).filter((a) => a && a.id && a.name).slice(0, 5),
  fmt: store.get('fmt', 'apple'),
  fitStrength: [0.35, 0.65, 1].includes(store.get('fitStrength', 0.65)) ? store.get('fitStrength', 0.65) : 0.65,
  undo: null,
  hot: -1,
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
  genres: dz.FALLBACK_GENRES.slice(),
  art: { token: 0, running: false, done: 0, total: 0, note: '' }
};
if (!FORMATS.some((f) => f.id === state.fmt)) state.fmt = 'apple';
// Each picked artist keeps its chart colour (slots 1–5) even when others are removed.
state.picks.forEach((p) => { if (!(p.c >= 1 && p.c <= 5)) p.c = 0; });
state.picks.forEach((p) => { if (!p.c) p.c = [1, 2, 3, 4, 5].find((c) => !state.picks.some((q) => q.c === c)); });
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
  if (t.fp && !t.bal) t.bal = balanceCurve(t.fp.avgDb);
  state.track = t;
  state.offset = 0;
  state.loop = null;
  state.draft = null;
  peaks = null; lastVis = null;
  buildWavePeaks();
  applyLive();
  renderLevel(); renderNow(); renderLoop(); renderTime(); renderFingerprint(); renderFitAvailability(); renderExport(); renderPlay(); markCurrent(); renderMini(); renderBandInfo();
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
    if (fresh.readable === false) throw new Error('Deezer doesn’t offer this song in your country.');
    if (!fresh.preview) throw new Error('Deezer has no preview for this song.');
    // Previews are streamed into memory only: never cached, stored or offered as a download.
    const res = await fetch(fresh.preview, { cache: 'no-store' });
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
    if (it.off) o.setAttribute('aria-disabled', 'true');
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
/** An exact name match first, then the most-followed artists. */
function byFans(list, q) {
  const s = q.trim().toLowerCase();
  const exact = (a) => ((a.name || '').trim().toLowerCase() === s ? 1 : 0);
  return list.slice().sort((x, y) => (exact(y) - exact(x)) || ((y.nb_fan || 0) - (x.nb_fan || 0)));
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
  const artists = byFans(dz.dedupeArtists((data && data.artists && data.artists.data) || []), q).slice(0, 4);
  const tracks = ((data && data.tracks && data.tracks.data) || []).slice(0, 5);
  const genres = dz.matchGenres(state.genres, q).slice(0, 2);
  sugGroup('Artists', artists.map((a) => ({ type: 'artist', data: a, title: a.name, sub: fansText(a.nb_fan), pic: a.picture_small })));
  sugGroup('Songs', tracks.map((t) => ({
    type: 'track', data: t, title: t.title_short || t.title,
    sub: (t.artist ? t.artist.name : '') + (t.album && t.album.title ? ' · ' + t.album.title : ''),
    pic: t.album && t.album.cover_small,
    off: !playable(t),
    side: t.readable === false ? 'Not available here' : t.preview ? '' : 'No preview'
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
    if (playable(it.data)) playDeezerTrack(it.data);
    else setStatus(it.data.readable === false ? 'Deezer doesn’t offer that song in your country. Try another one.' : 'Deezer has no preview for that song. Try another one.');
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
  if (playable(t)) {
    d.innerHTML = PLAY_SVG;
    b.setAttribute('aria-label', 'Play ' + (t.title_short || t.title) + (t.artist ? ' by ' + t.artist.name : ''));
  } else {
    d.textContent = t.readable === false ? 'Not available here' : 'No preview';
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
      artists: byFans(dz.dedupeArtists(artists), q).slice(0, 8), genres, tracks,
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
    const dot = el('i');
    dot.style.background = 'var(--s' + a.c + ')';
    dot.setAttribute('aria-hidden', 'true');
    const open = el('button', null, a.name);
    open.type = 'button';
    open.addEventListener('click', () => openArtist({ id: a.id, name: a.name, picture_small: a.picture, nb_fan: a.nb_fan }));
    const x = el('button', 'x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Remove ' + a.name + ' from your artists');
    x.addEventListener('click', () => togglePick(a));
    c.append(dot, open, x);
    box.append(c);
  });
  $('toArtists').hidden = !n;
  renderPickAction();
  renderArtistsPanel();
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
  else if (state.picks.length < 5) {
    const c = [1, 2, 3, 4, 5].find((k) => !state.picks.some((p) => p.c === k));
    state.picks.push({ id: a.id, name: a.name, picture: a.picture_small || a.picture || '', nb_fan: a.nb_fan, c });
  }
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
  if (t.source === 'deezer') {
    sub.append(document.createTextNode(t.artist + ' · 30-second preview'));
    if (t.link) {
      sub.append(document.createTextNode(' · '));
      const a = el('a', null, 'Full song on Deezer');
      a.href = t.link; a.target = '_blank'; a.rel = 'noopener';
      sub.append(a);
    }
  } else sub.textContent = t.artist;
  const n = img(t.art, t.source === 'demo' ? 'demo' : '');
  n.id = 'nowArt';
  $('nowArt').replaceWith(n);
  $('miniTitle').textContent = t.title;
  $('miniSub').textContent = t.source === 'deezer' ? t.artist + ' · Deezer preview' : (t.source === 'demo' ? 'Demo loop' : 'Your file');
}
function renderPlay() {
  const p = state.playing;
  const icon = p ? '<path d="M6 4.5h4.2v15H6zM13.8 4.5H18v15h-4.2z"/>' : '<path d="M7 4.5v15l13-7.5z"/>';
  $('play').setAttribute('aria-label', p ? 'Pause' : 'Play');
  $('playIcon').innerHTML = icon;
  $('miniPlay').setAttribute('aria-label', p ? 'Pause' : 'Play');
  $('miniIcon').innerHTML = icon;
}

/* Phone player bar: shown on narrow screens while the main player is scrolled out of view */
function renderMini() {
  const r = document.querySelector('.transport').getBoundingClientRect();
  const transportVisible = r.bottom > 0 && r.top < window.innerHeight;
  const show = !!state.track && !transportVisible;
  $('mini').classList.toggle('show', show);
  document.body.classList.toggle('has-mini', show);
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

/* ---------- Gains, the ±10 dB soft limit, faders and dots ---------- */
function presetName(g) {
  for (const [n, p] of Object.entries(PRESETS)) if (p.every((v, i) => v === g[i])) return n;
  return 'Custom';
}
/** Set one band on the selected setting. Past the limit it stops there and explains why, once. */
function setGain(i, v) {
  const lim = state.limit;
  if (Math.abs(v) > lim) {
    v = Math.sign(v) * lim;
    if (lim < RANGE) hitLimit();
  }
  v = Math.round(v * 2) / 2 || 0;
  const slot = state.slots[state.active];
  if (slot.gains[i] === v) return;
  slot.gains[i] = v;
  slot.name = presetName(slot.gains);
  afterSlotChange();
}
function hitLimit() {
  if (store.get('limitSeen', false)) return;
  store.set('limitSeen', true);
  $('limitNote').hidden = false;
}
function setLimit(l) {
  state.limit = l;
  store.set('limit', l);
  $('allow12').checked = l === RANGE;
  $('limitNote').hidden = true;
  renderFaders();
}
function afterSlotChange() {
  store.set('slots', state.slots);
  applyLive(); renderFaders(); renderSlots(); renderLevel(); renderExport(); renderBandInfo(); scheduleDraw();
}

const faderEls = [];
function buildFaders() {
  const box = $('faders');
  BANDS.forEach((f, i) => {
    const col = el('div', 'fcol');
    const read = el('output', 'fread');
    const fd = el('div', 'fader');
    fd.tabIndex = 0;
    fd.setAttribute('role', 'slider');
    fd.setAttribute('aria-label', hz(i) + ', ' + BAND_INFO[i].name.toLowerCase());
    fd.setAttribute('aria-describedby', 'bandInfo');
    fd.setAttribute('aria-orientation', 'vertical');
    fd.innerHTML = '<div class="ftrack"><div class="fguide" style="top:25%"></div><div class="fguide" style="top:75%"></div><div class="fzero"></div><div class="ffill"></div><div class="fthumb"></div></div>';
    col.append(read, fd, el('div', 'flab', BAND_LABELS[i]));
    box.append(col);
    const track = fd.querySelector('.ftrack');
    const fromY = (y) => {
      const r = track.getBoundingClientRect();
      return -RANGE + (r.bottom - y) / r.height * 2 * RANGE;
    };
    let dragging = false;
    fd.addEventListener('pointerdown', (e) => {
      if (state.blind) return;
      dragging = true;
      fd.setPointerCapture(e.pointerId);
      fd.focus({ preventScroll: true });
      setHot(i);
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
      else if (e.key === 'Home') { setGain(i, state.limit); e.preventDefault(); }
      else if (e.key === 'End') { setGain(i, -state.limit); e.preventDefault(); }
      else if (e.key === '0') { setGain(i, 0); e.preventDefault(); }
    });
    col.addEventListener('pointerenter', () => setHot(i));
    col.addEventListener('pointerleave', () => { if (!dragging && document.activeElement !== fd) setHot(-1); });
    fd.addEventListener('focus', () => setHot(i));
    fd.addEventListener('blur', () => setHot(-1));
    faderEls.push({ col, read, fd, fill: fd.querySelector('.ffill'), thumb: fd.querySelector('.fthumb') });
  });
}
function renderFaders() {
  const g = gainsOf(state.active);
  const box = $('faders');
  box.classList.toggle('slot-B', state.active === 'B');
  box.classList.toggle('locked', state.limit < RANGE);
  $('dots').classList.toggle('slot-B', state.active === 'B');
  faderEls.forEach((e, i) => {
    const v = g[i], pos = (v + RANGE) / (2 * RANGE) * 100;
    e.thumb.style.bottom = pos + '%';
    if (v >= 0) { e.fill.style.bottom = '50%'; e.fill.style.height = (pos - 50) + '%'; }
    else { e.fill.style.bottom = pos + '%'; e.fill.style.height = (50 - pos) + '%'; }
    e.read.textContent = sgn(v);
    e.fd.setAttribute('aria-valuemin', -state.limit);
    e.fd.setAttribute('aria-valuemax', state.limit);
    e.fd.setAttribute('aria-valuenow', v);
    e.fd.setAttribute('aria-valuetext', sgn(v) + ' dB');
  });
}

/* Band info under the scope: what lives in the band you point at */
function setHot(i) {
  if (state.hot === i) return;
  state.hot = i;
  faderEls.forEach((e, k) => e.col.classList.toggle('hot', k === i));
  renderBandInfo();
  scheduleDraw();
}
function renderBandInfo() {
  const box = $('bandInfo'), i = state.hot;
  box.textContent = '';
  if (i < 0) {
    box.textContent = state.blind ? 'Settings are hidden. Switch between 1 and 2 and listen.' : 'Point at a band, or drag its dot, to see what lives there.';
    return;
  }
  const info = BAND_INFO[i];
  box.append(el('b', null, hz(i) + ' · ' + info.name + '. '), info.what + ' Too much sounds ' + info.more + '; too little, ' + info.less + '.');
  const fp = state.track && state.track.fp;
  if (fp) box.append(' This song: ' + dbText(Math.round(vsTypical(fp.rel)[i] * 2) / 2) + ' against the typical song.');
  if (!state.blind) box.append(' Setting ' + state.active + ': ' + dbText(gainsOf(state.active)[i]) + '.');
}

/* ---------- Settings A and B, presets, auto fit, quick fixes ---------- */
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
  $('shapeSlot').textContent = blind ? '' : state.active;
  document.querySelectorAll('.slotName').forEach((s) => { s.textContent = blind ? '' : state.active; });
  $('lgCurveSw').style.background = blind ? '' : (state.active === 'A' ? 'var(--a)' : 'var(--b)');
  $('miniSlot').textContent = 'Hearing ' + (blind ? String(blind.order.indexOf(state.active) + 1) : state.active);
}
function renderLevel() {
  if (!state.match) { $('level').textContent = 'Volume follows the EQ, so boosts sound louder.'; return; }
  if (state.blind) { $('level').textContent = 'Both settings play at matched loudness.'; return; }
  $('level').textContent = 'Level correction on ' + state.active + ': ' + sgn(20 * Math.log10(compFor(state.active))) + ' dB';
}
function selectSlot(s) {
  if (state.active === s) return;
  state.active = s;
  applyLive(); renderFaders(); renderSlots(); renderLevel(); renderExport(); renderBandInfo(); scheduleDraw();
}
function swap() { selectSlot(state.active === 'A' ? 'B' : 'A'); }

function setToolMsg(msg) { $('toolMsg').textContent = msg; }
/** Remember a setting before a one-click change so Undo can bring it back. */
function remember(label, slot = state.active) {
  state.undo = { slot, label, prev: { name: state.slots[slot].name, gains: gainsOf(slot).slice() } };
  $('undo').disabled = false;
  $('undo').textContent = 'Undo ' + label;
}
function undo() {
  const u = state.undo;
  if (!u) return;
  state.slots[u.slot] = { name: u.prev.name, gains: u.prev.gains.slice() };
  state.undo = null;
  $('undo').disabled = true;
  $('undo').textContent = 'Undo';
  if (state.active !== u.slot) selectSlot(u.slot);
  afterSlotChange();
  setToolMsg('Setting ' + u.slot + ' is back to how it was before the ' + u.label + '.');
}
function loadGains(name, gains, label) {
  remember(label);
  state.slots[state.active] = { name, gains: gains.slice() };
  afterSlotChange();
}

function renderFitAvailability() {
  const fp = state.track && state.track.fp;
  $('fitEven').disabled = !fp;
  $('fitBoost').disabled = !fp;
  $('fitIntro').textContent = fp
    ? 'Builds a starting point from how “' + state.track.title + '” compares with a typical song. Every band stays within ±' + Math.min(GUIDE, state.limit) + ' dB.'
    : 'Builds a starting point from how the song compares with a typical song. Load a song to use it.';
}
function applyFit(dev, sign, opts) {
  const cap = Math.min(GUIDE, state.limit);
  const g = fitGains(dev, sign, state.fitStrength, cap);
  const strength = { 0.35: 'gentle', 0.65: 'medium', 1: 'strong' }[state.fitStrength];
  if (g.every((v) => v === 0)) {
    setToolMsg(opts.subject + ' already sits close to a typical song, so a ' + strength + ' fit changes nothing. Try Strong, or shape it by ear.');
    return;
  }
  loadGains(opts.name, g, 'auto fit');
  setToolMsg('Setting ' + state.active + ' now ' + opts.verb + ': ' + describeGains(g) + '. Press X or “Switch A and B” to compare it with ' + (state.active === 'A' ? 'B' : 'A') + '.');
}
function fitSong(sign) {
  const t = state.track;
  if (!t || !t.fp) return;
  applyFit(vsTypical(t.fp.rel), sign, {
    subject: '“' + t.title + '”',
    name: sign < 0 ? 'Evened out' : 'Its character',
    verb: sign < 0 ? 'evens out “' + t.title + '”' : 'brings out what makes “' + t.title + '” different'
  });
}
function applyFix(fx) {
  const s = state.slots[state.active];
  let hit = false;
  const g = s.gains.map((v, i) => {
    let n = v + fx.delta[i];
    if (Math.abs(n) > state.limit) { n = Math.sign(n) * state.limit; hit = true; }
    return Math.round(n * 2) / 2 || 0;
  });
  if (g.every((v, i) => v === s.gains[i])) { setToolMsg(fx.label + ': setting ' + state.active + ' is already at the limit there.'); if (hit) hitLimit(); return; }
  const change = g.map((v, i) => Math.round((v - s.gains[i]) * 2) / 2 || 0);
  loadGains(presetName(g), g, fx.label.toLowerCase() + ' fix');
  if (hit && state.limit < RANGE) hitLimit();
  setToolMsg(fx.label + ' (' + fx.hint.toLowerCase() + '): ' + describeGains(change) + ' on setting ' + state.active + '. Click again for more.');
}
function buildFixes() {
  const box = $('fixes');
  FIXES.forEach((fx) => {
    const b = el('button', 'fix', fx.label);
    b.type = 'button';
    b.title = fx.hint;
    b.addEventListener('click', () => { ensureCtx(); applyFix(fx); });
    box.append(b);
  });
}

/* ---------- Blind test ---------- */
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
  $('shapeHidden').hidden = false;
  $('limitNote').hidden = true;
  $('blindIntro').textContent = 'Switch between 1 and 2 as often as you like, with the buttons under the faders or the X key. Both play at the same loudness.';
  $('mask').hidden = false;
  $('faders').setAttribute('aria-hidden', 'true');
  state.active = state.blind.order[0];
  applyLive(); renderFaders(); renderSlots(); renderLevel(); renderExport(); renderBandInfo(); scheduleDraw();
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
  $('shapeHidden').hidden = true;
  $('mask').hidden = true;
  $('faders').removeAttribute('aria-hidden');
  $('blindIntro').textContent = 'Hide which setting is which, listen to both at the same loudness, then pick the one you prefer.';
  if (pickIdx != null) {
    const win = b.order[pickIdx], lose = b.order[1 - pickIdx];
    const r = $('blindResult');
    r.hidden = false;
    r.textContent = 'You picked ' + (pickIdx + 1) + ', which was setting ' + win + ' (' + state.slots[win].name + '). Number ' + (2 - pickIdx) + ' was ' + lose + ' (' + state.slots[lose].name + ').';
    state.active = win;
  }
  applyLive(); renderFaders(); renderSlots(); renderLevel(); renderExport(); renderBandInfo(); scheduleDraw();
}

/* ---------- This song against a typical song ---------- */
function balanceSentence(dev, subject) {
  const out = dev.map((v, i) => [v, i]).filter(([v, i]) => outside(v, i));
  const more = out.filter(([v]) => v > 0).sort((a, b) => b[0] - a[0]).slice(0, 2);
  const less = out.filter(([v]) => v < 0).sort((a, b) => a[0] - b[0]).slice(0, 2);
  const phrase = (list) => list.map(([v, i]) => BAND_NAMES[i] + ' (' + sgn(v, 0) + ' dB at ' + hz(i) + ')').join(' and ');
  if (!more.length && !less.length) return { text: subject.charAt(0).toUpperCase() + subject.slice(1) + ' is balanced like most songs: every octave sits inside the typical range.', more, less };
  let s = 'Compared with most songs, ' + subject + ' has ';
  if (more.length) s += 'more ' + phrase(more);
  if (more.length && less.length) s += ', and ';
  if (less.length) s += 'less ' + phrase(less);
  return { text: s + '.', more, less };
}
function renderFingerprint() {
  const box = $('fpChart'), fp = state.track && state.track.fp;
  if (!fp) {
    box.textContent = '';
    $('fpText').textContent = state.track ? 'This song couldn’t be analysed in this browser.' : 'Analysing the song…';
    return;
  }
  const dev = vsTypical(fp.rel);
  renderBalance(box, dev);
  const { text, more } = balanceSentence(dev, 'this song');
  let tail = '';
  if (more.length) {
    const top = more[0][1];
    tail = top <= 2 ? ' Its low end carries a lot of the song, so headphones that are weak in the bass will change it the most.'
      : top >= 7 ? ' Its treble stands out, so headphones with a sharp or dull top end will change it the most.'
        : ' Its midrange stands out, so headphones with an uneven midrange will change it the most.';
  }
  if (state.track.source === 'file') tail += ' The typical song was measured from MP3 previews, which lose most of the 16 kHz band, so a full-quality file can look brighter there.';
  $('fpText').textContent = text + tail;
}

/* ---------- Your artists’ sound ---------- */
const PER_ARTIST = 4;
const loadAfp = () => { const c = store.get('afp', {}); return c && typeof c === 'object' ? c : {}; };
function saveAfp(cache) {
  const keys = Object.keys(cache);
  if (keys.length > 160) keys.sort((a, b) => (cache[b].t || 0) - (cache[a].t || 0)).slice(160).forEach((k) => delete cache[k]);
  store.set('afp', cache);
}
function artistRels(id, cache) {
  return Object.values(cache).filter((e) => e && e.a === id && Array.isArray(e.r) && e.r.length === 10).sort((p, q) => (q.t || 0) - (p.t || 0)).slice(0, PER_ARTIST).map((e) => e.r);
}
const meanOf = (rows) => rows[0].map((_, i) => rows.reduce((s, r) => s + r[i], 0) / rows.length);
function artistSeries() {
  const cache = loadAfp();
  return state.picks.map((p) => {
    const rels = artistRels(p.id, cache);
    return { id: p.id, name: p.name, slot: p.c, n: rels.length, dev: rels.length ? vsTypical(meanOf(rels)) : null };
  });
}
function renderArtistsPanel() {
  const picks = state.picks, A = state.art;
  $('artCount').textContent = picks.length ? picks.length + ' of 5' : '';
  const all = artistSeries(), ready = all.filter((s) => s.dev), missing = all.filter((s) => !s.dev);
  const intro = $('artIntro');
  if (!picks.length) {
    intro.textContent = 'Pick up to five artists you listen to most: open an artist on the left and choose “Add to your artists”. Earprint then measures their top songs and shows the balance they share, so you can fit one setting to all of them.';
  } else if (A.running) {
    intro.textContent = 'Measuring ' + PER_ARTIST + ' top songs per artist. Nothing plays aloud, and only the numbers are kept.';
  } else if (missing.length) {
    intro.textContent = (ready.length ? 'Not measured yet: ' + missing.map((s) => s.name).join(', ') + '. ' : '') +
      'Earprint measures ' + PER_ARTIST + ' top songs per artist from their Deezer previews. Nothing plays aloud, it uses about 2 MB of data per artist, and only the numbers are kept.' + (A.note ? ' ' + A.note : '');
  } else {
    intro.textContent = 'Based on up to ' + PER_ARTIST + ' top songs per artist, measured from their Deezer previews.' + (A.note ? ' ' + A.note : '');
  }
  $('artActions').hidden = !picks.length || (!missing.length && !A.running);
  $('artRun').hidden = A.running;
  $('artRun').disabled = state.deezer === false;
  $('artRun').textContent = ready.length ? 'Measure ' + missing.length + ' more ' + (missing.length === 1 ? 'artist' : 'artists') : 'Measure their top songs';
  $('artCancel').hidden = !A.running;
  $('artProgress').hidden = !A.running;
  if (A.running) $('artBar').style.width = (A.total ? A.done / A.total * 100 : 0) + '%';

  const has = ready.length > 0;
  $('artLegend').hidden = !has;
  $('artChart').hidden = !has;
  $('artText').hidden = !has;
  $('artFit').hidden = !has;
  if (!has) { $('artChart').textContent = ''; return; }
  const avg = meanOf(ready.map((s) => s.dev));
  state.art.avg = avg;
  const leg = $('artLegend');
  leg.textContent = '';
  const li = (cls, name, note) => {
    const l = el('li');
    l.append(el('i', 'sw ' + cls), el('span', null, name));
    if (note) l.append(el('span', 'm', note));
    leg.append(l);
  };
  if (ready.length > 1) li('avg', 'Average of your artists');
  ready.forEach((s) => li('s' + s.slot, s.name, s.n < PER_ARTIST ? s.n + (s.n === 1 ? ' song' : ' songs') : ''));
  renderArtists($('artChart'), ready, ready.length > 1 ? avg : null);
  const subject = ready.length > 1 ? 'your artists’ music' : ready[0].name + '’s music';
  let text = balanceSentence(avg, subject).text;
  if (ready.length > 1) {
    // Compare each band's spread with how much songs normally vary there (the typical range).
    const spread = avg.map((_, i) => { const v = ready.map((s) => s.dev[i]); return Math.max(...v) - Math.min(...v); });
    const usual = (i) => Math.max(4, TYPICAL.rel.hi[i] - TYPICAL.rel.lo[i]);
    const wide = spread.map((v, i) => [v / usual(i), v, i]).sort((a, b) => b[0] - a[0])[0];
    text += wide[0] <= 1
      ? ' They’re alike across the whole range, so one setting should suit all of them.'
      : ' They differ most at ' + hz(wide[2]) + ' (' + Math.round(wide[1]) + ' dB apart), so one setting is a compromise there.';
  } else {
    text += ' Add more artists to see what they have in common.';
  }
  $('artText').textContent = text;
}
async function runArtists() {
  if (state.art.running || !state.picks.length) return;
  const tok = ++state.art.token;
  Object.assign(state.art, { running: true, done: 0, total: 0, note: '' });
  renderArtistsPanel();
  const cache = loadAfp();
  const jobs = [];
  let failed = 0;
  for (const p of state.picks) {
    if (artistRels(p.id, cache).length) continue;
    try {
      const top = await dz.artistTop(p.id, 10);
      top.filter(playable).slice(0, PER_ARTIST).forEach((t) => jobs.push({ p, t }));
    } catch (e) { failed++; }
    if (tok !== state.art.token) return;
  }
  state.art.total = jobs.length;
  renderArtistsPanel();
  const worker = async () => {
    while (jobs.length && tok === state.art.token) {
      const { p, t } = jobs.shift();
      $('artStatus').textContent = 'Measuring “' + (t.title_short || t.title) + '” by ' + p.name + '…';
      try {
        const res = await fetch(t.preview, { cache: 'no-store' });
        if (!res.ok) throw new Error(res.status);
        const fp = await analyse(await decode(await res.arrayBuffer()));
        if (fp && tok === state.art.token) {
          cache[t.id] = { a: p.id, t: Date.now(), r: fp.rel.map((v) => Math.round(v * 10) / 10) };
          saveAfp(cache);
        }
      } catch (e) { failed++; }
      state.art.done++;
      if (tok === state.art.token) { $('artBar').style.width = (state.art.done / Math.max(1, state.art.total) * 100) + '%'; }
    }
  };
  await Promise.all([worker(), worker()]);
  if (tok !== state.art.token) return;
  state.art.running = false;
  state.art.note = failed ? failed + (failed === 1 ? ' song' : ' songs') + ' couldn’t be measured.' : '';
  renderArtistsPanel();
}
function cancelArtists() {
  state.art.token++;
  state.art.running = false;
  state.art.note = 'Stopped. The songs measured so far are kept.';
  renderArtistsPanel();
}
function fitArtists(sign) {
  const avg = state.art.avg;
  if (!avg) return;
  const many = state.picks.length > 1;
  applyFit(avg, sign, {
    subject: many ? 'Your artists’ music' : 'This artist’s music',
    name: sign < 0 ? 'Artists, evened' : 'Artists’ character',
    verb: sign < 0 ? 'evens out your artists' : 'brings out what your artists share'
  });
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

/* ---------- Frequency scope ----------
   One dB scale for everything: the song and the typical song are tilted by 3 dB per octave and
   centred on the song's average level, so the EQ curve's dB mean the same as the song's. */
const F_LO = 32 / Math.SQRT2, F_HI = 16000 * Math.SQRT2, OCTS = Math.log2(F_HI / F_LO);
const DB_TOP = 15, DB_BOT = -27;
const N_VIS = 170;
const VIS_F = new Float32Array(N_VIS).map((_, i) => F_LO * Math.pow(2, i / (N_VIS - 1) * OCTS));
const VIS_TILT = Array.from(VIS_F, tiltDb);
const canvas = $('scope'), g2 = canvas.getContext('2d'), scopeWrap = $('scopeWrap'), eqArea = $('eqArea');
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
/** Scope geometry in CSS pixels (k = 1) or canvas pixels (k = device pixel ratio). */
let gutter = 46;
const readGutter = () => { gutter = parseFloat(getComputedStyle(eqArea).getPropertyValue('--gutter')) || 46; };
function geom(k = 1) {
  const r = canvas.getBoundingClientRect();
  const w = r.width * k, h = r.height * k, padT = 10 * k, padB = 10 * k;
  const plotW = Math.max(10, w - gutter * k), plotH = Math.max(10, h - padT - padB);
  return {
    w, h, padT, plotW, plotH, k,
    X: (f) => Math.log2(f / F_LO) / OCTS * plotW,
    Y: (db) => padT + (DB_TOP - Math.max(DB_BOT, Math.min(DB_TOP, db))) / (DB_TOP - DB_BOT) * plotH,
    dbAt: (y) => DB_TOP - (y - padT) / plotH * (DB_TOP - DB_BOT)
  };
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
  const off = state.track && state.track.bal ? state.track.bal.offset : -62;
  const out = new Float32Array(N_VIS);
  for (let i = 0; i < N_VIS; i++) out[i] = 10 * Math.log10(Math.max(meanPower(powBuf, VIS_F[i], 1 / 14, binHz), 1e-14)) + VIS_TILT[i] - off;
  return out;
}
function line(G, fs, vals, n) {
  g2.beginPath();
  for (let i = 0; i < n; i++) { const x = G.X(fs(i)), y = G.Y(vals[i]); if (i) g2.lineTo(x, y); else g2.moveTo(x, y); }
}
function drawScope(live) {
  const W = canvas.width, H = canvas.height;
  if (W < 2) return;
  const dpr = W / Math.max(1, canvas.getBoundingClientRect().width);
  const G = geom(dpr);
  g2.clearRect(0, 0, W, H);
  const blind = !!state.blind;

  // Band columns: the one you point at is lightly shaded; a hairline marks each band centre.
  if (state.hot >= 0) {
    const f = BANDS[state.hot];
    g2.fillStyle = rgba(colors['--ink'], 0.05);
    g2.fillRect(G.X(f / Math.SQRT2), 0, G.X(f * Math.SQRT2) - G.X(f / Math.SQRT2), H);
  }
  g2.lineWidth = 1;
  BANDS.forEach((f) => {
    const x = Math.round(G.X(f)) + 0.5;
    g2.strokeStyle = rgba(colors['--muted'], 0.13);
    g2.beginPath(); g2.moveTo(x, G.padT); g2.lineTo(x, G.padT + G.plotH); g2.stroke();
  });
  g2.font = (10.5 * dpr) + 'px "JetBrains Mono", ui-monospace, monospace';
  g2.textBaseline = 'middle';
  g2.textAlign = 'left';
  [12, 6, 0, -6, -12, -18, -24].forEach((db) => {
    const y = Math.round(G.Y(db)) + 0.5;
    g2.strokeStyle = rgba(colors['--muted'], db === 0 ? 0.5 : 0.13);
    g2.setLineDash(db === 0 ? [] : [3 * dpr, 4 * dpr]);
    g2.beginPath(); g2.moveTo(0, y); g2.lineTo(G.plotW, y); g2.stroke();
    g2.setLineDash([]);
    g2.fillStyle = colors['--muted'];
    g2.fillText(db === 0 ? '0 dB' : sgn(db, 0), G.plotW + 6 * dpr, y);
  });

  g2.save();
  g2.beginPath(); g2.rect(0, 0, G.plotW, H); g2.clip();

  // The typical song: middle half of 128 songs, with the median dotted.
  if (state.layers.typical) {
    const tc = TYPICAL.curve, n = tc.med.length;
    g2.beginPath();
    for (let k = 0; k < n; k++) { const x = G.X(typicalF(k)), y = G.Y(tc.hi[k]); if (k) g2.lineTo(x, y); else g2.moveTo(x, y); }
    for (let k = n - 1; k >= 0; k--) g2.lineTo(G.X(typicalF(k)), G.Y(tc.lo[k]));
    g2.closePath();
    g2.fillStyle = rgba(colors['--muted'], 0.15); g2.fill();
    line(G, typicalF, tc.med, n);
    g2.setLineDash([1.5 * dpr, 3 * dpr]);
    g2.strokeStyle = rgba(colors['--muted'], 0.9); g2.lineWidth = 1.4 * dpr; g2.stroke();
    g2.setLineDash([]);
  }

  // Live sound (after the EQ), filled.
  if (state.layers.spectrum && !blind) {
    let vis = null;
    if (live && analyser) {
      vis = liveVis();
      lastVis = vis;
      if (!peaks) peaks = Float32Array.from(vis);
      for (let i = 0; i < N_VIS; i++) peaks[i] = Math.max(vis[i], peaks[i] - 0.35);
    } else vis = lastVis;
    if (vis) {
      const grad = g2.createLinearGradient(0, G.padT, 0, G.padT + G.plotH);
      grad.addColorStop(0, rgba(colors['--spec'], live ? 0.42 : 0.18));
      grad.addColorStop(1, rgba(colors['--spec'], 0.03));
      g2.beginPath(); g2.moveTo(0, G.padT + G.plotH);
      for (let i = 0; i < N_VIS; i++) g2.lineTo(G.X(VIS_F[i]), G.Y(vis[i]));
      g2.lineTo(G.plotW, G.padT + G.plotH); g2.closePath();
      g2.fillStyle = grad; g2.fill();
      line(G, (i) => VIS_F[i], vis, N_VIS);
      g2.strokeStyle = rgba(colors['--spec'], live ? 0.7 : 0.3); g2.lineWidth = 1.1 * dpr; g2.stroke();
      if (peaks && live) {
        line(G, (i) => VIS_F[i], peaks, N_VIS);
        g2.strokeStyle = rgba(colors['--spec'], 0.25); g2.lineWidth = 1 * dpr; g2.stroke();
      }
    }
  }

  // The song's average balance, before EQ.
  const bal = state.track && state.track.bal;
  if (state.layers.average && bal) {
    line(G, (i) => CURVE_F[i], bal.db, N_CURVE);
    g2.strokeStyle = rgba(colors['--ink'], 0.78); g2.lineWidth = 1.8 * dpr; g2.lineJoin = 'round'; g2.stroke();
  }

  // EQ curves: the other setting dashed, the selected one solid (its dots are draggable elements).
  if (state.layers.curve && !blind) {
    const other = state.active === 'A' ? 'B' : 'A';
    [[other, false], [state.active, true]].forEach(([s, on]) => {
      const db = curveOf(s), col = colors[s === 'A' ? '--a' : '--b'];
      line(G, (i) => CURVE_F[i], db, N_CURVE);
      g2.setLineDash(on ? [] : [6 * dpr, 4 * dpr]);
      g2.strokeStyle = on ? col : rgba(col, 0.6); g2.lineWidth = (on ? 2.6 : 1.6) * dpr; g2.stroke();
      g2.setLineDash([]);
      g2.font = '600 ' + (11 * dpr) + 'px "Instrument Sans", system-ui, sans-serif';
      g2.textAlign = 'left'; g2.textBaseline = 'alphabetic';
      g2.fillStyle = on ? col : rgba(col, 0.75);
      g2.fillText(s, (on ? 5 : 17) * dpr, G.Y(db[Math.round(N_CURVE * 0.02)]) - 7 * dpr);
    });
  }
  g2.restore();

  const msg = !state.track ? 'Preparing the demo loop…' : blind ? 'EQ curves are hidden during the blind test. Just listen.' : '';
  if (msg) {
    g2.font = (13 * dpr) + 'px "Instrument Sans", system-ui, sans-serif';
    g2.textAlign = 'center';
    g2.textBaseline = 'middle';
    const tw = g2.measureText(msg).width, bw = tw + 28 * dpr, bh = 30 * dpr, bx = G.plotW / 2 - bw / 2, by = G.padT + G.plotH * 0.3 - bh / 2;
    g2.fillStyle = rgba(colors['--panel'], 0.92);
    g2.beginPath();
    if (g2.roundRect) g2.roundRect(bx, by, bw, bh, 8 * dpr); else g2.rect(bx, by, bw, bh);
    g2.fill();
    g2.fillStyle = colors['--muted'];
    g2.fillText(msg, G.plotW / 2, G.padT + G.plotH * 0.3);
    g2.textBaseline = 'alphabetic';
  }
  placeDots();
}

/* Draggable dots on the selected setting's curve */
const dotEls = [];
function buildDots() {
  const box = $('dots');
  BANDS.forEach((f, i) => {
    const d = el('div', 'dot');
    const v = el('span', 'dv');
    d.append(v);
    box.append(d);
    let drag = null;
    d.addEventListener('pointerdown', (e) => {
      if (state.blind || e.button > 0) return;
      ensureCtx();
      const G = geom(), r = canvas.getBoundingClientRect();
      drag = { offset: e.clientY - (r.top + G.Y(gainsOf(state.active)[i])) };
      d.setPointerCapture(e.pointerId);
      d.classList.add('drag');
      setHot(i);
      e.preventDefault();
    });
    d.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const G = geom(), r = canvas.getBoundingClientRect();
      setGain(i, G.dbAt(e.clientY - r.top - drag.offset));
    });
    const end = () => { if (!drag) return; drag = null; d.classList.remove('drag'); };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);
    d.addEventListener('lostpointercapture', end);
    d.addEventListener('dblclick', () => { if (!state.blind) setGain(i, 0); });
    d.addEventListener('pointerenter', () => setHot(i));
    dotEls.push({ d, v });
  });
}
function placeDots() {
  if (state.blind || !state.layers.curve) { dotEls.forEach((o) => { o.d.hidden = true; }); return; }
  const G = geom(), g = gainsOf(state.active);
  dotEls.forEach((o, i) => {
    o.d.hidden = false;
    o.d.style.transform = '';
    o.d.style.left = G.X(BANDS[i]).toFixed(1) + 'px';
    o.d.style.top = G.Y(g[i]).toFixed(1) + 'px';
    o.v.textContent = sgn(g[i]) + ' dB';
  });
}
function bindScopeHover() {
  // Each band owns one octave of the scope, from its centre ÷ √2 to its centre × √2.
  const band = (clientX) => {
    const G = geom(), r = canvas.getBoundingClientRect(), x = clientX - r.left;
    if (x < 0 || x > G.plotW) return -1;
    return Math.max(0, Math.min(9, Math.floor(x / G.plotW * OCTS)));
  };
  scopeWrap.addEventListener('pointermove', (e) => { if (e.target === canvas) setHot(band(e.clientX)); });
  scopeWrap.addEventListener('pointerdown', (e) => { if (e.target === canvas) setHot(band(e.clientX)); });
  scopeWrap.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !document.querySelector('.dot.drag')) setHot(-1); });
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
  buildDots();
  buildFixes();
  buildTabs();
  bindWave();
  bindDrop();
  bindScopeHover();

  const sel = $('preset');
  sel.innerHTML = '<option value="">Load a preset…</option>' + Object.keys(PRESETS).map((n) => '<option>' + n + '</option>').join('');
  sel.addEventListener('change', () => {
    const n = sel.value;
    if (!n) return;
    sel.value = '';
    loadGains(n, PRESETS[n], 'preset');
    setToolMsg('Loaded “' + n + '” into setting ' + state.active + '.');
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
    const from = state.active, to = from === 'A' ? 'B' : 'A';
    remember('copy', to);
    state.slots[to] = { name: state.slots[from].name, gains: gainsOf(from).slice() };
    afterSlotChange();
    setToolMsg('Copied ' + from + ' to ' + to + '. Change one of them, then switch between them to compare.');
  });
  $('resetSlot').addEventListener('click', () => {
    loadGains('Flat', PRESETS['Flat'], 'reset');
    setToolMsg('Setting ' + state.active + ' is flat again.');
  });
  $('undo').addEventListener('click', undo);
  $('fitEven').addEventListener('click', () => { ensureCtx(); fitSong(-1); });
  $('fitBoost').addEventListener('click', () => { ensureCtx(); fitSong(1); });
  document.querySelectorAll('input[name="fitStrength"]').forEach((r) => {
    r.checked = +r.value === state.fitStrength;
    r.addEventListener('change', () => { if (r.checked) { state.fitStrength = +r.value; store.set('fitStrength', state.fitStrength); } });
  });
  $('allow12').checked = state.limit === RANGE;
  $('allow12').addEventListener('change', (e) => setLimit(e.target.checked ? RANGE : SOFT));
  $('limitAllow').addEventListener('click', () => setLimit(RANGE));
  $('limitKeep').addEventListener('click', () => { $('limitNote').hidden = true; });
  $('blindStart').addEventListener('click', startBlind);
  $('blindCancel').addEventListener('click', () => endBlind(null));
  document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => endBlind(+b.dataset.pick)));

  $('artRun').addEventListener('click', runArtists);
  $('artCancel').addEventListener('click', cancelArtists);
  $('artEven').addEventListener('click', () => { ensureCtx(); fitArtists(-1); });
  $('artBoost').addEventListener('click', () => { ensureCtx(); fitArtists(1); });
  $('toArtists').addEventListener('click', (e) => {
    e.preventDefault();
    const p = $('artistsPanel');
    p.scrollIntoView({ behavior: 'smooth', block: 'start' });
    p.focus({ preventScroll: true });
  });

  $('play').addEventListener('click', () => { ensureCtx(); togglePlay(); });
  $('miniPlay').addEventListener('click', () => { ensureCtx(); togglePlay(); });
  $('miniSwap').addEventListener('click', () => { ensureCtx(); swap(); });
  $('miniJump').addEventListener('click', () => { document.querySelector('.player').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  window.addEventListener('scroll', renderMini, { passive: true });
  window.addEventListener('resize', renderMini);
  $('vol').addEventListener('input', (e) => { if (master) master.gain.setTargetAtTime(+e.target.value, ctx.currentTime, 0.02); });
  [['lgSpectrum', 'spectrum'], ['lgAverage', 'average'], ['lgTypical', 'typical'], ['lgCurve', 'curve']].forEach(([id, k]) => {
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

  const ro = new ResizeObserver((entries) => {
    entries.forEach((en) => {
      if (en.target === canvas) { readGutter(); fitCanvas(canvas); scheduleDraw(); placeDots(); }
      else if (en.target === waveCanvas) { if (fitCanvas(waveCanvas)) { waveBase = null; drawWave(); } }
      else if (en.target === $('fpChart')) { if (state.track && state.track.fp) renderFingerprint(); }
      else if (en.target === $('artChart')) { if (!$('artChart').hidden) renderArtistsPanel(); }
    });
  });
  [canvas, waveCanvas, $('fpChart'), $('artChart')].forEach((n) => ro.observe(n));
  readColors();
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors); } catch (e) {}
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => scheduleDraw());

  readGutter();
  renderFaders(); renderSlots(); renderLevel(); renderExport(); renderPicks(); renderLoop(); renderGenreChips(); renderBandInfo(); renderFitAvailability();
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
