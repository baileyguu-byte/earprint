// Audio maths shared by the lab: EQ bands, filter responses, song analysis and decoding.

export const AC = window.AudioContext || window.webkitAudioContext;
export const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;

// Octave bands matching the Music app on a Mac (and most 10-band graphic equalisers).
export const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const BAND_LABELS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
export const BAND_NAMES = ['deep sub-bass', 'sub-bass', 'bass', 'upper bass', 'low mids', 'mids', 'upper mids', 'presence', 'brilliance', 'air'];
export const Q = 1.41;
export const RANGE = 12;      // hard limit of the faders
export const SOFT = 10;       // default limit; going past it needs a deliberate unlock
export const GUIDE = 6;       // most good settings stay inside this

/*
 * A typical song, measured with analyse() below: 128 popular songs, 8 from each of 16 Deezer
 * charts (all genres, pop, rap/hip hop, rock, dance, R&B, alternative, electro, country, latin,
 * metal, jazz, soul & funk, reggae, folk, classical) in November 2026, 30-second previews.
 * med is the median song, lo and hi the 25th and 75th percentiles, so half of all songs sit
 * between lo and hi. Only these numbers are kept, never the audio.
 *  - rel: energy per octave band relative to the 64 Hz–8 kHz average (same as analyse().rel)
 *  - curve: the balance at 1/6-octave steps from 22.6 Hz (see balanceCurve)
 */
export const TYPICAL = {
  id: 0, name: 'All music', noun: 'song',
  songs: 128,
  rel: {
    med: [-2, 5.3, 4.3, 3.3, 2.4, 0.6, -2.1, -5.6, -7.9, -16.3],
    lo: [-8.8, 3, 2.3, 1.8, 1.3, -0.7, -3.6, -7.5, -9.6, -19.5],
    hi: [2.5, 7.5, 5.8, 5.2, 4.1, 2.4, -0.7, -3.7, -6.4, -14]
  },
  curve: {
    f0: 32 / Math.SQRT2,
    perOct: 6,
    med: [-18.3, -15.7, -11.4, -7.6, -2.8, 2.5, 4.5, 5.5, 5.9, 6, 6, 4.6, 4.9, 4.6, 4.5, 4.1, 4, 3.3, 3.7, 2.7, 3.1, 2.9, 3.4, 3.1, 2.1, 2.1, 1.8, 2.2, 3.1, 2.5, 1.8, 1.1, 1.1, 0.3, -0.2, -0.3, -1, -1.1, -1.4, -2.3, -2.7, -3.5, -4.1, -4.4, -4.7, -5.3, -6.1, -6.9, -6.6, -6.4, -6.9, -7, -7.4, -8.1, -10.1, -12.3, -15.1, -25, -61.6, -61.3, -61.3],
    lo: [-23.5, -21.7, -16.9, -13.3, -8.8, -5, -1.2, 1, 3.1, 3, 3.3, 2.5, 3, 2.3, 2, 2.1, 2.1, 1.3, 0.9, 0.4, 0.2, 0.4, 0.9, 0.6, -0.1, 0.2, -0.3, -0.5, 0.6, 0.4, -0.2, -1.2, -1.2, -2.1, -2.2, -3.2, -2.9, -3, -3.7, -3.9, -4.6, -5.5, -6.4, -6.5, -7, -7.8, -8.3, -8.4, -8.3, -8.9, -9.3, -9, -9.2, -9.9, -12.1, -15.5, -18.7, -31.9, -69.2, -69.1, -69.1],
    hi: [-10.5, -7.1, -2.4, 0.8, 3.1, 6.1, 7.9, 9.1, 8.8, 8.3, 7.9, 7.4, 7.2, 7, 7.2, 5.9, 7.2, 5.7, 5.6, 6.1, 6.1, 5.7, 6.3, 5.6, 4.6, 4.6, 4.8, 5.4, 6, 4.4, 3.6, 3.9, 3.9, 2.7, 2.3, 2, 1.6, 1.2, 0.5, 0, 0.4, -0.7, -1.8, -1.5, -2.5, -3.2, -4.3, -4.7, -4.7, -4.9, -5.2, -5.5, -5.9, -6.7, -8, -9.8, -12.3, -20.3, -53.3, -53.4, -53.4]
  }
};
/** Frequency of point k on the TYPICAL.curve grid. */
export const typicalF = (k) => TYPICAL.curve.f0 * Math.pow(2, k / TYPICAL.curve.perOct);
/** How a song's octave balance differs from the median song of a reference, band by band (dB). */
export const vsTypical = (rel, ref = TYPICAL) => rel.map((v, i) => v - ref.rel.med[i]);
/** The typical song of a Deezer genre, when Earprint has measured that genre. */
export const genreRef = (id) => GENRE_TYPICAL[id] || null;

export const PRESETS = {
  'Flat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Warm': [3, 3, 2, 1, 0, 0, -1, -1, -2, -2],
  'Bass boost': [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Vocal clarity': [-2, -2, -1, 0, 1, 3, 4, 3, 1, 0],
  'Bright': [0, 0, 0, 0, 0, 0, 1, 3, 4, 5],
  'V-shape': [5, 4, 2, 0, -2, -2, 0, 2, 4, 5]
};

export const N_CURVE = 256;
export const CURVE_F = new Float32Array(N_CURVE).map((_, i) => 20 * Math.pow(1000, i / (N_CURVE - 1)));

/*
 * Band layouts: the equalisers people actually have. Picking one in the lab changes the faders
 * and the filters you hear, so what you shape is what your device can do. Phone makers don't
 * publish their filter shapes, so peaking bands use the usual one-octave-wide shape (wider where
 * the bands are further apart). max is the device's own limit; step its default step size.
 *  - b9: Samsung Galaxy (One UI) Custom equaliser: 63 Hz–16 kHz, whole dB from −10 to +10.
 *  - b6: Spotify's equaliser: 60 Hz–15 kHz.
 *  - b5: Android's built-in equaliser, which many music apps use: 60, 230, 910, 3600, 14000 Hz.
 *  - b3: bass, mid and treble tone controls (cars, TVs, speakers). Frequencies vary by maker;
 *    these are typical: shelves at 100 Hz and 10 kHz and a broad mid around 1 kHz.
 */
const pk = (f, q = Q) => ({ f, type: 'peaking', q });
export const LAYOUTS = [
  { id: 'b10', count: 10, title: '10 bands', devices: 'Apple Music on a Mac, Windows and most music players', max: 12, step: 0.5,
    bands: BANDS.map((f) => pk(f)) },
  { id: 'b9', count: 9, title: '9 bands', devices: 'Samsung Galaxy phones', max: 10, step: 1,
    bands: [63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000].map((f) => pk(f)) },
  { id: 'b6', count: 6, title: '6 bands', devices: 'Spotify', max: 12, step: 0.5,
    bands: [60, 150, 400, 1000, 2400, 15000].map((f) => pk(f, 1)) },
  { id: 'b5', count: 5, title: '5 bands', devices: 'Android’s built-in equaliser and apps that use it', max: 12, step: 1,
    bands: [60, 230, 910, 3600, 14000].map((f) => pk(f, 0.96)) },
  { id: 'b3', count: 3, title: '3 bands', devices: 'Bass, mid and treble: cars, TVs and speakers', max: 10, step: 1,
    bands: [{ f: 100, type: 'lowshelf', label: 'Bass' }, { f: 1000, type: 'peaking', q: 0.7, label: 'Mid' }, { f: 10000, type: 'highshelf', label: 'Treble' }] }
];
export const L10 = LAYOUTS[0];
export const layoutById = (id) => LAYOUTS.find((l) => l.id === id) || L10;
/** Short fader label for a band: "Bass", "63", "2.4k". */
export const bandLabel = (b) => b.label || (b.f >= 1000 ? (b.f / 1000) + 'k' : String(b.f));
/** Spoken label: "Bass", "63 Hz", "2.4 kHz". */
export const bandHz = (b) => b.label || (b.f >= 1000 ? (b.f / 1000) + ' kHz' : b.f + ' Hz');

// Filter maths runs on its own offline context so the live audio graph is never disturbed.
const calcCtx = new OAC(1, 128, 44100);
const calcSets = {};
function calcFilters(L) {
  if (!calcSets[L.id]) {
    calcSets[L.id] = L.bands.map((b) => {
      const f = calcCtx.createBiquadFilter();
      f.type = b.type; f.frequency.value = b.f;
      if (b.type === 'peaking') f.Q.value = b.q;
      return f;
    });
  }
  return calcSets[L.id];
}

/** Combined EQ response in dB at the given frequencies, for a layout (10 bands by default). */
export function responseDb(gains, freqs, L = L10) {
  const fq = freqs instanceof Float32Array ? freqs : Float32Array.from(freqs);
  const mag = new Float32Array(fq.length).fill(1);
  const m = new Float32Array(fq.length), ph = new Float32Array(fq.length);
  calcFilters(L).forEach((b, i) => {
    b.gain.value = gains[i] || 0;
    b.getFrequencyResponse(fq, m, ph);
    for (let k = 0; k < fq.length; k++) mag[k] *= m[k];
  });
  return Array.from(mag, (v) => 20 * Math.log10(Math.max(v, 1e-6)));
}

/* ---------- Fitting a layout to a target curve ----------
   Used to move a setting between layouts, to export to devices with other bands, and for auto
   fit. Weighted least squares on a 1/6-octave grid, refined a few times because neighbouring
   bands overlap, then clamped and rounded to the step size. */
export const FIT_F = Float32Array.from({ length: 57 }, (_, k) => 25 * Math.pow(2, k / 6));
const FIT_W = Array.from(FIT_F, (f) => (f < 40 || f > 12500 ? 0.35 : 1));
const basisCache = {};
function basis(L) {
  if (!basisCache[L.id]) {
    basisCache[L.id] = L.bands.map((_, i) => responseDb(L.bands.map((__, j) => (j === i ? 6 : 0)), FIT_F, L).map((v) => v / 6));
  }
  return basisCache[L.id];
}
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => row.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-9) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-9 ? 0 : row[n] / row[i]));
}
/** Round to the step, symmetrically (−0.5 → −1 with whole-dB steps). */
export const roundStep = (v, step) => (Math.sign(v) * Math.round(Math.abs(v) / step) * step) || 0;
/** Gains for layout L whose curve best matches target (dB at FIT_F). */
export function fitLayout(L, target, cap, step) {
  const B = basis(L), n = B.length;
  const clampAll = (g) => g.map((v) => Math.max(-cap, Math.min(cap, v)));
  const lsq = (resid) => {
    const A = B.map((bi) => B.map((bj) => bi.reduce((s, v, k) => s + FIT_W[k] * v * bj[k], 0)));
    for (let i = 0; i < n; i++) A[i][i] += 0.02;
    return solve(A, B.map((bi) => bi.reduce((s, v, k) => s + FIT_W[k] * v * resid[k], 0)));
  };
  let g = clampAll(lsq(Array.from(target)));
  for (let it = 0; it < 4; it++) {
    const r = responseDb(g, FIT_F, L);
    const d = lsq(Array.from(target, (t, k) => t - r[k]));
    g = clampAll(g.map((v, i) => v + d[i]));
  }
  return g.map((v) => roundStep(v, step));
}
/** Largest difference between two settings' curves from 40 Hz to 12 kHz, in dB. */
export function curveGap(gA, LA, gB, LB) {
  const a = responseDb(gA, FIT_F, LA), b = responseDb(gB, FIT_F, LB);
  let m = 0;
  for (let k = 0; k < FIT_F.length; k++) if (FIT_F[k] >= 40 && FIT_F[k] <= 12500) m = Math.max(m, Math.abs(a[k] - b[k]));
  return m;
}
/** Move a setting from one layout to another (closest match). */
export const convertGains = (g, from, to, step) => (from.id === to.id ? g.map((v) => roundStep(v, step)) : fitLayout(to, responseDb(g, FIT_F, from), to.max, step));

/** Rough perceived-loudness weighting (high-pass near 38 Hz plus a +4 dB shelf above ~1.7 kHz). */
export function kWeight(f) {
  const hp = Math.pow(f, 4) / (Math.pow(f, 4) + Math.pow(38, 4));
  const shelf = 1 + 1.512 * (f * f) / (f * f + 1700 * 1700);
  return hp * shelf;
}

/** Average power across FFT bins within ±halfOct octaves of f (falls back to interpolation). */
export function meanPower(powerArr, f, halfOct, binHz) {
  const lo = f * Math.pow(2, -halfOct), hi = f * Math.pow(2, halfOct);
  const k0 = Math.max(1, Math.ceil(lo / binHz)), k1 = Math.min(powerArr.length - 1, Math.floor(hi / binHz));
  if (k1 >= k0) {
    let s = 0;
    for (let k = k0; k <= k1; k++) s += powerArr[k];
    return s / (k1 - k0 + 1);
  }
  const x = f / binHz, ka = Math.max(1, Math.floor(x)), kb = Math.min(powerArr.length - 1, ka + 1), fr = x - ka;
  return powerArr[ka] * (1 - fr) + powerArr[kb] * fr;
}

/** Decode compressed audio into an AudioBuffer at 44.1 kHz. */
export function decode(arrayBuffer) {
  const oc = new OAC(2, 44100, 44100);
  return new Promise((resolve, reject) => {
    const p = oc.decodeAudioData(arrayBuffer, resolve, reject);
    if (p && p.then) p.then(resolve, reject);
  });
}

/**
 * Long-term average spectrum of a buffer, sampled with an analyser at regular points.
 * Returns density (linear power per CURVE_F point), avgDb (same in dB) and rel
 * (energy per octave band relative to the 64 Hz–8 kHz average).
 */
export async function analyse(buffer) {
  const sr = buffer.sampleRate, len = buffer.length, dur = len / sr;
  const oc = new OAC(1, len, sr);
  const src = oc.createBufferSource();
  src.buffer = buffer;
  const an = oc.createAnalyser();
  an.fftSize = 8192; an.smoothingTimeConstant = 0;
  src.connect(an); an.connect(oc.destination); src.start();
  const bins = an.frequencyBinCount, acc = new Float64Array(bins), tmp = new Float32Array(bins);
  let n = 0;
  const steps = Math.max(1, Math.min(90, Math.floor(dur / 0.25)));
  const quantum = 128 / sr, used = new Set();
  for (let i = 1; i <= steps; i++) {
    const t = Math.floor((i * dur / (steps + 1)) / quantum) * quantum;
    const key = t.toFixed(6);
    if (t <= 0 || t >= dur || used.has(key)) continue;
    used.add(key);
    oc.suspend(t).then(() => {
      an.getFloatFrequencyData(tmp);
      for (let k = 0; k < bins; k++) { const v = tmp[k]; if (isFinite(v)) acc[k] += Math.pow(10, v / 10); }
      n++;
      oc.resume();
    });
  }
  await oc.startRendering();
  if (!n) return null;
  const binHz = sr / an.fftSize;
  for (let k = 0; k < bins; k++) acc[k] /= n;
  const density = new Float64Array(N_CURVE), avgDb = new Float32Array(N_CURVE);
  CURVE_F.forEach((f, i) => {
    const p = meanPower(acc, f, 1 / 24, binHz);
    density[i] = p;
    avgDb[i] = 10 * Math.log10(Math.max(p, 1e-14));
  });
  const bandsDb = BANDS.map((fc) => {
    let s = 0;
    const lo = fc / Math.SQRT2, hi = fc * Math.SQRT2;
    for (let k = Math.max(1, Math.floor(lo / binHz)); k <= Math.min(bins - 1, Math.ceil(hi / binHz)); k++) {
      const f = k * binHz;
      if (f >= lo && f < hi) s += acc[k];
    }
    return 10 * Math.log10(Math.max(s, 1e-14));
  });
  const ref = bandsDb.slice(1, 9).reduce((a, b) => a + b, 0) / 8;
  return { density, avgDb, rel: bandsDb.map((v) => v - ref) };
}

/**
 * A song's balance for display: its average spectrum tilted by +3 dB per octave (so equal
 * energy in every octave reads as a flat line) and shifted so the 45 Hz–11 kHz average sits
 * at 0 dB. That puts the song, the typical song and the EQ curve on one dB scale.
 * Returns the curve at CURVE_F and the offset, which also places the live spectrum.
 */
export const tiltDb = (f) => 10 * Math.log10(f / 1000);
export function balanceCurve(avgDb) {
  const raw = Array.from(avgDb, (v, i) => v + tiltDb(CURVE_F[i]));
  // Light smoothing (about a fifth of an octave) so single notes don't read as features.
  const W = [1, 2, 3, 2, 1], db = new Float32Array(N_CURVE);
  let s = 0, c = 0;
  for (let i = 0; i < N_CURVE; i++) {
    let sum = 0, wsum = 0;
    for (let k = -2; k <= 2; k++) {
      const j = i + k;
      if (j < 0 || j >= N_CURVE) continue;
      sum += raw[j] * W[k + 2]; wsum += W[k + 2];
    }
    db[i] = sum / wsum;
    if (CURVE_F[i] >= 45 && CURVE_F[i] <= 11314) { s += raw[i]; c++; }
  }
  const offset = c ? s / c : 0;
  for (let i = 0; i < N_CURVE; i++) db[i] -= offset;
  return { db, offset };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Auto fit. dev is how far each octave band sits from a typical song (vsTypical).
 *  - sign −1, "even it out": moves the song towards the typical song both ways, cutting what it
 *    has too much of and filling in what it lacks. The lab compares with the song's own genre
 *    here, so a metal or classical recording isn't pulled towards a pop balance.
 *  - sign +1, "bring out its character": lifts only what the song has MORE of than typical. It
 *    never cuts what a song already lacks: exaggerating a gap (a metal mix's scooped mids, a
 *    dark master's missing treble) made songs sound thinner or duller, not more themselves.
 *    The lab compares with all music here, so what makes a genre sound like itself (a metal
 *    guitar's bite, a hip hop low end) counts as character too, not only the song's quirks.
 * FIT_AMOUNT sets how far. Differences under 0.5 dB are ignored, the 32 Hz and 16 kHz bands count
 * half (they vary most between songs and previews are least reliable there) and the curve stays
 * within ±cap.
 */
export const FIT_AMOUNT = { even: { gentle: 0.5, medium: 0.8, strong: 1 }, boost: { gentle: 0.6, medium: 1, strong: 1.6 } };
export function fitTargets(dev, sign, amount, cap) {
  const EDGE = [0.5, 1, 1, 1, 1, 1, 1, 1, 1, 0.5];
  return dev.map((d, i) => {
    if (sign > 0 && d <= 0) return 0;
    const mag = Math.max(0, Math.abs(d) - 0.5) * Math.sign(d);
    return clamp(sign * amount * mag * EDGE[i], -cap, cap);
  });
}
/** A curve on FIT_F through targets at the octave band centres (level beyond 32 Hz and 16 kHz). */
export function octaveCurve(t) {
  const lb = BANDS.map(Math.log2);
  return Array.from(FIT_F, (f) => {
    const x = Math.log2(f);
    if (x <= lb[0]) return t[0];
    if (x >= lb[9]) return t[9];
    let i = 0;
    while (x > lb[i + 1]) i++;
    const fr = (x - lb[i]) / (lb[i + 1] - lb[i]);
    return t[i] * (1 - fr) + t[i + 1] * fr;
  });
}
export function fitGains(dev, sign, amount, cap, L = L10, step = 0.5) {
  let g = fitLayout(L, octaveCurve(fitTargets(dev, sign, amount, cap)), cap, 0.01);
  // Bringing out never cuts, not even a little where the fit spills over next to a lift.
  if (sign > 0) g = g.map((v) => Math.max(0, v));
  // Neighbouring bands add up, so keep the combined curve, not just each band, within ±cap.
  const r = responseDb(g, FIT_F, L);
  let peak = 0;
  for (let k = 0; k < FIT_F.length; k++) if (FIT_F[k] >= 40 && FIT_F[k] <= 12500) peak = Math.max(peak, Math.abs(r[k]));
  if (peak > cap) g = g.map((v) => v * cap / peak);
  return g.map((v) => roundStep(v, step));
}

/*
 * Typical songs per genre, measured the same way as TYPICAL: the top 12 songs with previews on
 * each Deezer genre chart in November 2026. A song is compared with its own genre (from its
 * album on Deezer) when Earprint has measured that genre, so a metal song isn't judged against
 * pop. Twelve songs is a small sample, so these are a guide rather than a standard.
 */
export const GENRE_TYPICAL = {
  84: { // Country on Deezer
    id: 84, name: 'Country', noun: 'country song', songs: 12,
    rel: {
      med: [-0.9, 5.2, 5.1, 3.2, 2, 0.8, -2.2, -6.2, -7.7, -15.7],
      lo: [-6.7, 3.7, 3.4, 2.6, 1.6, -0.2, -2.6, -7.5, -8.9, -17.5],
      hi: [2, 5.4, 5.7, 4.1, 3.9, 2.2, -1.8, -4.8, -6.6, -14.1]
    },
    curve: {
      med: [-19.1, -15, -9.2, -4.3, -1.3, 2.5, 4.4, 5.9, 5.6, 6.1, 4.7, 4.1, 6.2, 7.2, 4.2, 4, 4.2, 2.9, 2.4, 2.8, 1.7, 3.9, 3.7, 3.6, 0.4, 1.5, 1.3, 2.2, 2.6, 2.7, 0.9, 1.4, 2.9, 0.4, 0.4, -1, -1.5, -1.1, -0.8, -2, -3.7, -3.3, -3.7, -4.4, -5.4, -6, -7.7, -7.9, -6.8, -7.3, -6.6, -7.1, -6.6, -8.1, -9.5, -11.8, -15.5, -29.9, -59.1, -59.3, -59.3],
      lo: [-22.8, -18.4, -14.2, -10.1, -7, -3.4, -0.3, 0.7, 2.7, 4.4, 4.5, 3.6, 3.9, 4, 2.7, 3.5, 2.7, 2.3, 1.1, 1.4, 0.8, 2, 2.5, 2.6, -1, 0.8, -0.3, 1.6, 1.6, 1.4, 0.2, -0.7, 1.7, -1, -1.6, -2.5, -1.8, -1.7, -2.5, -3.6, -4.7, -4.9, -5.5, -5.5, -6.9, -7.7, -8.3, -9.5, -7.6, -8.6, -8.5, -8.1, -7.7, -9, -10.8, -13.5, -18.3, -33.7, -67.9, -68.1, -68.1],
      hi: [-11.4, -7.8, -2.8, 0.9, 3.4, 4.5, 7.8, 7.1, 6.7, 6.9, 6.5, 6, 7.8, 8.6, 5.2, 4.4, 5, 3.9, 4.3, 3.4, 3.4, 5.2, 5.2, 4.1, 1.6, 3.2, 2.4, 3.3, 3.5, 3.1, 1.7, 2.3, 3.9, 2.4, 1.5, 0.6, -0.9, 0.3, -0.3, -0.9, -1.5, -1.7, -2.5, -3.3, -4.1, -4.2, -4.9, -5.7, -6.1, -5.5, -4.7, -6.1, -5.3, -5.9, -8, -10.5, -13.2, -25.7, -50.5, -50.7, -50.7]
    }
  },
  85: { // Alternative on Deezer
    id: 85, name: 'Alternative', noun: 'alternative song', songs: 12,
    rel: {
      med: [-0.5, 5.9, 4.2, 3.9, 4.6, 0.6, -3.1, -7.1, -9, -16.1],
      lo: [-7, 4.5, 3.6, 1.8, 2.9, -0.5, -4.3, -8.1, -10.8, -19.2],
      hi: [3, 6.7, 6.8, 5.1, 5.3, 2.9, -2.6, -5.9, -6.7, -14.1]
    },
    curve: {
      med: [-16.5, -14, -10.2, -5.6, -1.2, 2.3, 5.2, 4.9, 5.7, 6.4, 6.8, 6.8, 4.2, 5.7, 5.6, 4.1, 3.7, 4.1, 3.5, 3.8, 2.8, 2.3, 2.3, 3.4, 3.1, 3.3, 3.6, 3, 3.8, 2.9, 3.2, 1.7, 0.9, 0.1, 0.6, -0.4, -0.2, -1.8, -1.6, -3.4, -4.5, -5.2, -5.4, -6.4, -6.5, -6.9, -7.1, -7.3, -7.8, -7.6, -8, -8.5, -9.1, -8.5, -10, -12.5, -15.9, -28.1, -65.8, -66, -66],
      lo: [-20.8, -18.4, -15.8, -12.3, -6.3, -3.5, 0.6, 3.9, 3.9, 3.7, 2.5, 4.2, 2.2, 4.9, 3, 1.2, -0.2, 3.3, 2, 2.5, 2.3, 1, 0.2, 0.1, 0.2, 1.8, 1.7, 1.9, 2.3, 1.9, 0.8, 0.7, -0.2, -2.8, -2, -1.5, -1.1, -2.3, -3.4, -4.1, -5.9, -6, -7.6, -7.5, -7.8, -8.3, -8.7, -8.5, -9.1, -10.4, -10.7, -9.9, -9.8, -11, -12.7, -14.5, -19.3, -33.8, -71.2, -71.2, -71.2],
      hi: [-10.8, -6.3, -2.9, 0.6, 3.7, 6.7, 7.1, 8.6, 8.1, 7.5, 7.6, 8.4, 7.5, 6.8, 6.9, 5.5, 6.7, 5.5, 5.9, 5.2, 4.2, 3.3, 7, 6, 5.3, 5, 6.3, 3.9, 5.8, 5.5, 4.4, 2.7, 2.4, 1.9, 1.8, 1.9, 0.5, -0.5, -0.9, -2.5, -3.2, -3.4, -2.6, -4, -4.4, -5, -6.2, -5.7, -6.6, -6.2, -6.3, -6.1, -6.3, -6.6, -7.9, -10.1, -12.4, -22, -55.7, -54.4, -54.4]
    }
  },
  98: { // Classical on Deezer
    id: 98, name: 'Classical', noun: 'classical recording', songs: 12,
    rel: {
      med: [-15, -4.8, -0.6, 5.9, 8.3, 5.9, 2.8, -3, -15.1, -27.4],
      lo: [-19.8, -11.4, -1.5, 4.1, 5.9, 3.5, -0.8, -8, -21.6, -33.9],
      hi: [-11.5, -1.2, 0.6, 9.5, 12.1, 9.6, 4.3, -2.5, -7.8, -22.2]
    },
    curve: {
      med: [-20.8, -17.6, -14.4, -13.3, -15.1, -14.4, -10.6, -6.5, -8.9, -6.1, -1.6, -2.7, -3.3, -1.7, 0.6, -0.4, 0.4, 0.9, 3.8, 5.3, 7.6, 6.6, 7.6, 6.7, 8.3, 8.4, 9.3, 8.5, 8.5, 9.2, 6.7, 5.8, 4.9, 5.3, 6, 5.6, 4.7, 4.4, 3.7, 0.8, 1, 1.2, -0.3, -0.4, -3.7, -5.8, -7.1, -8, -10.6, -12.4, -12.3, -14.2, -15.4, -16.8, -19.2, -23.6, -27.9, -40.4, -57.6, -57.3, -57.3],
      lo: [-27.2, -24.5, -22.4, -21.8, -19.7, -18.6, -14.7, -11.5, -11.2, -12.2, -11.1, -8.3, -6.1, -5.1, -3.7, -3.1, -1, -2.7, 1.2, 4, 4.2, 2.5, 4, 3.6, 3.4, 4.9, 5.9, 4.4, 5.3, 6.2, 3.8, 3.9, 2.8, 3.7, 3.5, 3, 1.2, 0.8, 1, 0.2, -1.9, -2.3, -2.9, -3.2, -5.9, -8.2, -10.2, -14, -16.6, -18.3, -19.3, -20.8, -22.4, -25, -26.3, -27.6, -30.9, -46.7, -68.9, -68.8, -68.8],
      hi: [-8.1, -7.4, -7.7, -8.4, -10.7, -9.5, -7, -3.3, -0.4, -0.6, 1.1, -0.6, -0.7, 2.4, 3.7, 1.9, 1.1, 3.4, 7.6, 10, 10.9, 11.1, 12, 9.1, 9.7, 11.8, 12.6, 14.7, 14.6, 11.6, 13.6, 10.7, 10.3, 10, 8.7, 9.4, 8.2, 7, 5.8, 4.6, 2.5, 3.4, 2.8, 0.5, -1.8, -2.4, -3.8, -3.9, -4, -5.7, -6.4, -7.4, -8.6, -11, -13.6, -18.1, -23.1, -38.1, -48.9, -48.6, -48.6]
    }
  },
  106: { // Electro on Deezer
    id: 106, name: 'Electronic', noun: 'electronic track', songs: 12,
    rel: {
      med: [2.1, 7.7, 4.2, 2.2, 1, -0.6, -4, -6.3, -5.6, -12.7],
      lo: [0.1, 6, 3.5, 1.1, 0.5, -1.4, -4.6, -8, -8.2, -14.5],
      hi: [7.6, 10.9, 6.4, 4, 3.6, 0.6, -3, -4.9, -4.3, -11.5]
    },
    curve: {
      med: [-9.9, -6.3, -2.9, 0.7, 2.4, 5.1, 7.2, 9.5, 9.1, 8.6, 7.6, 6.7, 7.2, 6, 4.9, 5.9, 3.6, 2.7, 2.7, 2.5, 2.4, 3.2, 2.5, 1, 0.6, 1.3, 2.4, 1.8, 0.9, 0.5, 0.4, -0.2, 0.1, 0.6, -0.7, -2.5, -2.5, -1.8, -3.5, -3.3, -4.4, -5.2, -5.6, -5.8, -5.9, -6.1, -6.1, -6, -6.1, -5.4, -5.6, -4.7, -4.1, -4.9, -6.2, -8.4, -12.4, -23.6, -47.2, -47.2, -47.2],
      lo: [-15.7, -13.7, -10.6, -5.4, 1.4, 4, 5.3, 7.1, 6.8, 6.6, 6.1, 5.1, 3.7, 3.6, 4, 4.3, 2.3, 2.1, 1.1, 1.3, -0.1, 1.3, -0.9, 0.3, -1.3, -0.6, -0.1, 0.9, -1.2, -2.3, -2.4, -3.1, -1, -1.4, -1.9, -3.4, -2.8, -3.1, -4.4, -4.9, -6.2, -6.5, -6.4, -6.8, -7.2, -9.5, -8.6, -9.3, -8.1, -7.4, -8.2, -7.8, -6.9, -8, -10, -11.5, -14.4, -26.3, -61.4, -62.4, -62.4],
      hi: [-6.2, -1.8, 1.4, 4.3, 8.3, 11.3, 11.8, 11.4, 12.2, 11, 9.5, 9.3, 9.6, 7.6, 7.7, 7.7, 6.7, 4.8, 5.3, 5.1, 3.7, 5.4, 3.5, 2, 1.9, 2.1, 3.6, 4.8, 2.3, 2.2, 1, 0.3, 0.5, 3, 0, -0.6, -1.1, -1.1, -2.4, -2, -3.3, -4.6, -4.3, -4.5, -5.2, -5, -5.3, -3.9, -4.8, -4, -3.6, -3.7, -3.8, -3.9, -5.5, -8, -9.6, -17.9, -43.6, -43.4, -43.4]
    }
  },
  113: { // Dance on Deezer
    id: 113, name: 'Dance', noun: 'dance track', songs: 12,
    rel: {
      med: [-1.4, 5.7, 3.5, 1.5, 0.6, -0.1, -1.7, -4.2, -5.6, -13.1],
      lo: [-5.8, 4.5, 2.3, -0.1, 0, -1.6, -3.2, -5.2, -7.2, -17.2],
      hi: [0.4, 8.8, 5.5, 2.7, 1.4, 1.3, -0.2, -3, -4, -12.2]
    },
    curve: {
      med: [-19.5, -16.4, -12.8, -6.4, -0.8, 2.5, 4.6, 6.2, 7.4, 6.6, 5.3, 5, 4.4, 2.6, 4.2, 4.9, 3.2, 2.8, 3.2, 1.7, 1.4, 1, 0.8, 0.7, 0.9, -1, -1, 0.7, 0.9, -0.7, 0.3, 1.1, -0.5, 0, -0.2, -2.8, 0, -1.8, -1.2, -1.3, -2.8, -3.9, -2.2, -2.6, -3.6, -3.9, -4.4, -4.8, -5.3, -5, -5.2, -5.4, -5.9, -7, -8, -9.2, -11.3, -23.1, -55.2, -55.3, -55.3],
      lo: [-22.9, -21, -16.7, -11.7, -6.4, -1.8, 1.6, 2.6, 4.8, 5.1, 4.1, 4.2, 2.1, 1.3, 2.7, 4.3, 2.1, 1.4, 0.9, 0, -0.2, -0.2, 0.1, -2.1, -0.7, -1.9, -2.1, -1, -0.4, -2.2, -1.7, -1.4, -1.9, -2, -1.1, -4.4, -3, -2.8, -3.2, -3, -3.9, -5.1, -3.6, -4.4, -5, -5.1, -5.6, -6.1, -6.1, -5.6, -5.8, -6.6, -7.3, -9.3, -11, -13, -17.3, -31.7, -63, -63.2, -63.2],
      hi: [-14.5, -12.3, -8.8, -4.5, -0.6, 4.7, 9, 11, 10.2, 7.5, 7.2, 8.1, 6.9, 4.6, 5.6, 6.3, 5, 4.6, 5.2, 2.7, 2.4, 2.2, 2.1, 2.3, 2.2, -0.2, -0.3, 1, 3.7, 0.8, 1.5, 1.8, 1.2, 1.4, 1.5, -0.9, 1.4, 0.2, 0.5, 0, -0.5, -1.6, -0.7, -1.9, -2.1, -1.9, -1.9, -2.5, -3, -3.2, -3.3, -3.9, -3.9, -3.8, -5.6, -8.2, -10.1, -19.6, -48.5, -48.6, -48.6]
    }
  },
  116: { // Rap/Hip Hop on Deezer
    id: 116, name: 'Hip hop', noun: 'hip hop song', songs: 12,
    rel: {
      med: [0.9, 7.2, 4.1, 1.8, 1, -0.5, -1.6, -4.9, -6.7, -17],
      lo: [-1.6, 5.9, 2.6, -0.1, -0.2, -1.9, -3, -6.3, -8.5, -18.5],
      hi: [3.8, 7.9, 6.3, 2.7, 1.8, 0.3, -0.4, -3, -6, -15.3]
    },
    curve: {
      med: [-9.9, -7, -4.3, 0.1, 1.8, 4.3, 6.9, 8.4, 8.3, 8.3, 7.1, 5.2, 5.1, 5.4, 4.5, 3.4, 3.6, 1.9, 1.2, 2.7, 2.8, 1.3, 0.6, 1, 1.3, 1.2, 0.5, 0.6, 0.2, 1.4, -0.1, -0.6, -1.3, -0.1, -1.1, -0.9, -1.2, -0.9, -1.8, -2.1, -2, -1.5, -3.3, -4, -3.9, -4.3, -4.9, -5.7, -6.6, -5.7, -5.4, -6.3, -7.3, -7.4, -10.3, -12.5, -16.4, -30.5, -53.1, -53, -53],
      lo: [-12.2, -9.6, -8.1, -6.6, -0.5, 1.6, 4, 5.7, 6.1, 6.4, 6, 3.7, 3.6, 4.2, 4, 2.6, 1.9, -0.5, -1.1, 1.1, -1.9, 0.2, -0.9, 0.2, -2.8, -0.6, -0.1, -1.4, -2.2, -0.9, -1.7, -2.7, -2.4, -0.8, -2.4, -1.6, -2.7, -2.2, -3.8, -3.4, -3.4, -4.3, -5.3, -5, -4.6, -5.9, -7.6, -7.9, -7.2, -8.4, -9.7, -7.4, -9.3, -9.4, -12, -15.3, -21, -31.9, -55.9, -55.9, -55.9],
      hi: [-7.1, -3.5, -0.9, 1.8, 5, 7.7, 9.2, 9.4, 9.9, 9.6, 8.6, 6.7, 7, 6.5, 6.1, 8.9, 6.7, 3.6, 4.4, 3.7, 3.8, 2.5, 2.5, 3.1, 2.8, 2.3, 2.6, 2.7, 1.3, 3.1, 1, 1.5, -0.4, 0.9, -0.1, 1.4, 0.6, 0.7, -0.1, 0, -0.5, -0.5, -1.7, -2.2, -1.5, -3.7, -4.3, -4, -4.6, -4.1, -4.3, -3.8, -5.2, -7, -8.9, -11.3, -14.9, -26.9, -49.7, -49.9, -49.9]
    }
  },
  129: { // Jazz on Deezer
    id: 129, name: 'Jazz', noun: 'jazz track', songs: 12,
    rel: {
      med: [-4.6, 6, 5.1, 4.2, 4.2, 1.1, -3.2, -7.3, -9.2, -16.9],
      lo: [-12.4, 2.3, 3.3, 2.3, 2.1, -0.1, -5.4, -9.5, -10.5, -22.4],
      hi: [-1.7, 8.2, 7.4, 5.5, 5.5, 3.2, -2.5, -3.9, -7.6, -11.5]
    },
    curve: {
      med: [-24, -21.4, -16.9, -11.3, -5.5, -0.2, 3.5, 5.4, 6.1, 6.9, 6.9, 7.7, 7, 6.3, 6.3, 5.2, 4.2, 2.8, 3.2, 4.4, 3.8, 3.7, 5, 3.6, 2.3, 3.4, 4, 2.5, 2.5, 4.2, 2.7, 2.1, 1.7, 0.1, -0.4, -0.4, -1.1, -2.3, -2.7, -3, -5, -4.8, -5.4, -5.4, -7.1, -8.1, -6.5, -5.8, -6.5, -7.5, -7.6, -8.8, -9.7, -9.9, -9.8, -12.9, -15.3, -26.5, -66.8, -66.7, -66.7],
      lo: [-26.3, -23.9, -20.9, -17.5, -12.8, -8.1, -4.6, -2.2, -1.6, 1.4, 3, 3.1, 3.8, 4.7, 3.6, 2.4, 3.1, -0.1, 1.8, 1, 2.4, 1.4, 2.1, 1.6, 0.4, 1.4, 2.2, 0.8, 1.1, 1.9, -0.3, 0.8, 0.4, -0.9, -3.7, -1.4, -2.8, -5.2, -3.7, -5.4, -7.3, -8.4, -7.5, -7.8, -7.7, -9, -11.2, -9.1, -9.3, -9.6, -10.1, -9.2, -10.9, -12.4, -13.9, -18.3, -25.8, -45.9, -69.1, -68.9, -68.9],
      hi: [-17.2, -13.5, -10.6, -7.3, -2.1, 2.2, 5.6, 7.8, 8.5, 8.9, 8.8, 9.6, 9.3, 10.6, 9.7, 8.2, 7.1, 5.1, 4.7, 7.3, 5.3, 5.9, 7.2, 5.8, 5.9, 6.7, 6.6, 4, 7.3, 5.7, 4.6, 4, 4.2, 2.1, 2.2, 1.1, 0.8, -0.8, -0.5, -1.5, -3.1, -3.5, -3.2, -3, -3.9, -4.1, -3.7, -5, -5.3, -5.7, -6.5, -6.3, -8, -7.8, -7.7, -7.8, -8.9, -20.3, -62.9, -63, -63]
    }
  },
  132: { // Pop on Deezer
    id: 132, name: 'Pop', noun: 'pop song', songs: 12,
    rel: {
      med: [0.4, 4.7, 3.4, 3.3, 2.4, 2.4, -1.3, -5.2, -8.1, -15.9],
      lo: [-5.7, 2.1, 1.4, 1.9, 1.8, 0.9, -2.8, -5.9, -10.8, -17.5],
      hi: [2.6, 6.6, 4.5, 4.1, 3.8, 3.1, 0.4, -4.7, -6.7, -15.1]
    },
    curve: {
      med: [-15.4, -9.8, -5, -0.7, 2.4, 4.3, 5.8, 6.5, 5.4, 5.7, 4.2, 3.8, 5.8, 4.7, 2.3, 2.9, 3.1, 0.1, 1.9, 0.8, 1, 4, 3.9, 2.2, 4.5, 3, 1.1, 1.8, 2.5, 2.2, 2.4, 3, 1.9, 1.7, 0.7, -0.8, 0, -0.2, 0.4, -0.6, -2.8, -3.3, -3.3, -3.1, -4.5, -3.8, -5.1, -6.7, -7.4, -7.1, -7, -7, -6.6, -6.2, -8.8, -12.5, -15.5, -30.4, -60.8, -60.8, -60.8],
      lo: [-20.8, -18.5, -14.5, -9.3, -5.2, -1, 1.5, 2.1, 3.8, 3, 2.7, 1.5, 3.3, 3.3, -0.2, 1.7, 0.7, -0.6, -0.2, -0.7, -1.4, 1.8, 1.6, 1.8, 0.6, 0.8, -1.1, -1.2, -0.7, 0.6, 1.4, 0.8, 1.1, -0.4, -0.6, -3.7, -2.2, -1.8, -1.8, -2.6, -3.8, -4.7, -4.1, -4.7, -5.6, -5.1, -5.8, -7.9, -9.2, -10.1, -9.8, -10.7, -8.8, -7.3, -10.6, -13.3, -16.8, -32.1, -63.8, -63.8, -63.8],
      hi: [-10.9, -6, -2, 2.3, 4.8, 6.7, 9.3, 9.1, 7.9, 6.5, 6.1, 5.5, 6.5, 5.9, 3.6, 4, 6, 2.4, 2.6, 2.3, 2.6, 5.3, 5.7, 6.3, 5.9, 4.5, 2.8, 3.1, 4.5, 3.6, 3.4, 3.9, 3.7, 3, 1.9, 0.5, 1.9, 1.5, 1.8, 2.4, -0.7, -2.2, -2.3, -2.6, -3.4, -3.2, -4.1, -6.1, -6.5, -6.5, -6.3, -6.1, -5.8, -5.6, -7.9, -11, -13.4, -25.9, -50.4, -50.4, -50.4]
    }
  },
  144: { // Reggae on Deezer
    id: 144, name: 'Reggae', noun: 'reggae song', songs: 12,
    rel: {
      med: [-2.5, 5.6, 4.2, 4.2, 3.1, -0.2, -2.9, -5, -5.2, -12],
      lo: [-8.6, 5.3, 0.9, 2.5, 2.1, -2.3, -3.4, -6.4, -8.8, -18],
      hi: [1.6, 6.5, 5.7, 5.3, 3.9, 0.6, -1.8, -3.6, -4.1, -10.2]
    },
    curve: {
      med: [-16.5, -13.9, -10.4, -5.1, -0.9, 2.1, 4.7, 5.5, 6.4, 5.7, 7.1, 7, 4.2, 4.6, 4.7, 4.4, 3.5, 2.5, 3.6, 4.8, 5.6, 3.2, 3, 2.8, 1.5, 2.3, 3.9, 1.7, 2.7, 2.1, 1.2, 1.4, -0.3, -1, -2.6, -2.5, -2.4, -1.4, -1.8, -3.3, -3.1, -3.2, -2.7, -4.3, -4.8, -3.9, -4.4, -5.4, -6.5, -5.4, -3.8, -5.1, -5.6, -5.6, -6.8, -7.5, -10.9, -26.9, -65.4, -65.2, -65.2],
      lo: [-21.5, -18, -16.9, -15.1, -9.7, -4.3, 0.2, 3.3, 4.8, 3.9, 3.9, 1.1, 1, 2.4, -0.7, 1.6, -1.1, 1.4, 2, 1.4, 2.6, 1.5, -0.1, -0.8, 1, -0.4, -0.2, 0.2, 0.4, 0.9, -0.1, -3.2, -2.1, -2.9, -5.6, -3.4, -3.5, -2.6, -2.5, -4.5, -4.4, -4, -4.8, -7.4, -6.1, -5.2, -6.3, -7.7, -7.3, -8.3, -7.4, -9.1, -8.7, -7.6, -10.8, -13.9, -14.8, -31.7, -69.6, -69.7, -69.7],
      hi: [-12.8, -8, -4.2, -0.8, 3.3, 5.2, 7.3, 7.9, 7.8, 8.1, 8.5, 9.6, 8.2, 7.5, 7.2, 5.6, 5.3, 4, 4.6, 7.2, 7.4, 4.5, 4.8, 5.5, 4.3, 5.4, 5.2, 3.8, 3.6, 3.2, 6.1, 2.7, 0.7, 1.6, 0.5, -1.7, 0.4, 0.4, -1.1, -2.3, -1.9, -1.8, -1.6, -2.6, -3, -2.2, -3.2, -2.8, -2.2, -3.2, -2.7, -2.7, -3, -3, -3.8, -5.5, -8.1, -19.9, -47.3, -47.5, -47.5]
    }
  },
  152: { // Rock on Deezer
    id: 152, name: 'Rock', noun: 'rock song', songs: 12,
    rel: {
      med: [-9.3, 2.9, 2.9, 1.8, 1.7, 0.4, -0.8, -2.8, -6.5, -14.4],
      lo: [-10.7, 1.2, 1.6, 1.2, 0.9, 0, -2.1, -3.1, -7.4, -17.2],
      hi: [-7.1, 3.4, 3.2, 2.5, 2.5, 2.3, 0.6, -2, -4.7, -12.7]
    },
    curve: {
      med: [-26.1, -22.1, -17.9, -12.5, -8.6, -5.6, -3, 0.2, 2.1, 4.5, 4.6, 2.7, 2.3, 2.5, 2.5, 2.5, 2.3, 2.4, 4, 1.1, 0.8, 1.7, 1.4, 0.3, 0.6, 1.4, 1.7, 1.3, 1.4, 1, 2.9, 1.2, -0.1, 0.2, 0.2, -0.2, 0, 0.5, -0.5, -0.9, -0.1, -0.1, -0.8, -1.3, -1.6, -2.9, -4.3, -4.4, -4.7, -5.2, -5.8, -6.3, -7.2, -7.9, -8.4, -10.2, -13.3, -26.3, -65.1, -65.2, -65.2],
      lo: [-28.3, -24.1, -19.7, -14.8, -10, -6.5, -4.3, -1.5, 1.3, 2.4, 2.7, 1.5, 0.7, 0.4, 0.7, 1.3, 1.2, 1.2, 2, 0.4, 0.1, 0.5, -0.6, -0.2, -1, 0.8, 0.2, -0.2, -0.2, 0.4, 0.4, -0.1, -1.6, -2.5, -1, -0.6, -0.8, -1.3, -2.5, -2.9, -2.2, -2.8, -1.5, -1.6, -2.5, -4.1, -4.5, -5.2, -5.9, -5.9, -6.5, -7.1, -7.7, -8.7, -11.1, -13.4, -15.9, -29.4, -70.2, -70.5, -70.5],
      hi: [-19.9, -16.3, -13.2, -9, -6.1, -3.9, -0.3, 3.4, 5, 5.8, 5.6, 4.3, 3.6, 4.7, 4.3, 3.9, 3.6, 3.7, 4.4, 3.9, 1.6, 4.3, 4.5, 2, 1.9, 2.6, 3, 2.8, 3.3, 2.4, 3.3, 2.9, 2.5, 1.9, 1.1, 0.8, 1.1, 1.8, 0.5, 1.1, 0.8, 1.4, 0.5, -0.7, -0.9, -1.2, -2.6, -2.2, -2.2, -3, -3.9, -5.8, -6.2, -6.1, -6.8, -9, -11.1, -23.3, -56.5, -56.7, -56.7]
    }
  },
  153: { // Blues on Deezer
    id: 153, name: 'Blues', noun: 'blues song', songs: 12,
    rel: {
      med: [-7.6, 1.9, 4.8, 5.4, 3.9, 2.5, 0.7, -7.6, -10.7, -18.6],
      lo: [-15.4, -1.1, 3, 3.7, 3.4, 1.7, -2.8, -9.3, -14.2, -23.9],
      hi: [-5.9, 5.4, 6.9, 7.3, 4.8, 3.5, 1.2, -3.8, -8.8, -16.9]
    },
    curve: {
      med: [-16.4, -15.8, -14.5, -12.3, -8.3, -3.9, -2.9, -0.6, 2.4, 4.6, 1, 3.6, 5.8, 4.9, 5.9, 3.4, 4.7, 4.4, 6.7, 4.2, 3.9, 6.5, 6.5, 4.2, 4.7, 3.9, 4.4, 2.9, 2.3, 4.4, 3.5, 2.3, 3.3, 3.4, 0.3, 1.9, 1, 2.3, 2.3, -0.7, -1.1, -2.7, -4.1, -5.1, -6.8, -7.8, -8.2, -9.5, -9.9, -9.7, -9.5, -11, -10, -10.1, -11.2, -14.4, -18.8, -33.7, -67.9, -67.7, -67.7],
      lo: [-25.9, -22.6, -18.3, -15.2, -13.9, -11.9, -8.4, -3.9, -2, -1.2, -0.6, 0.6, 2.9, 3.6, 3.2, 2.7, 1.2, 1, 3.8, 2.7, 2.3, 2.9, 1.8, 3.4, 2.8, 2.7, 0.1, 1.4, 1.4, 3.1, 2, 0.1, 1, 0.4, -0.3, -1.7, -0.3, -1.3, -3.1, -3.2, -2.7, -4.5, -6.6, -6.5, -8.5, -8.9, -9.9, -10.7, -12.6, -12.5, -12.5, -12.6, -12.2, -12.5, -16.2, -19.4, -22.2, -37.9, -69.8, -69.6, -69.6],
      hi: [-10.3, -7, -5.9, -4.7, -3.3, -2, 0.7, 5.4, 6.1, 6.5, 6.9, 6.7, 8, 5.9, 9.5, 6.2, 6.8, 6.2, 9.6, 7.9, 6.4, 7.8, 8.5, 5.8, 7.4, 5.4, 6.9, 5, 4.8, 4.8, 7.2, 6, 5.6, 5.3, 2, 4, 3.8, 3.4, 4.2, 1, 0.7, -0.7, 0.1, -2.1, -2.3, -2.6, -7.6, -7.7, -7.9, -7.7, -8.4, -7.9, -7.3, -9.2, -10.7, -12.5, -15.3, -26.1, -61.4, -61.3, -61.3]
    }
  },
  165: { // R&B on Deezer
    id: 165, name: 'R&B', noun: 'R&B song', songs: 12,
    rel: {
      med: [-1, 5.8, 4.7, 2.9, 2.5, 0.8, -2.2, -6.1, -8.8, -17.6],
      lo: [-3, 3.9, 3.2, 1.2, 2, 0.2, -3, -7, -10.2, -19],
      hi: [4.9, 9.4, 6.1, 3.5, 3.3, 2.6, -0.8, -4.8, -7.8, -13.9]
    },
    curve: {
      med: [-15.6, -13.5, -7.8, -2.5, 0.7, 3.2, 7.5, 8.7, 7.5, 6.6, 5.8, 6.4, 5.9, 5.9, 5.4, 4.4, 3.9, 3.2, 3, 2.4, 2.3, 3.6, 2.8, 1.9, 2.2, 1.6, 2.2, 2.5, 2.2, 2.6, 2.2, 2.1, 1.5, 0.4, -0.6, -0.3, 0.1, -0.4, -0.1, -2.3, -4, -5.1, -5.7, -4.6, -5.1, -5.1, -6.1, -7.2, -7.8, -7.5, -8, -8.2, -8, -8.5, -10.8, -14.2, -16.5, -26.6, -64.8, -64.9, -64.9],
      lo: [-20.6, -16.2, -12.6, -8.2, -4, 0.9, 2.9, 3.3, 2.5, 3.9, 3, 4.1, 3.5, 3.7, 4.3, 3.1, 2.3, 1.4, 1, 0, -0.3, 0.5, 1.5, 0.6, -0.5, 0.3, -0.3, 1.2, 0.4, 1.8, 1.5, 0.3, -0.4, -0.1, -1.8, -1.7, -1.6, -2.3, -2.1, -3.2, -5.1, -6.4, -6.8, -6.5, -6.6, -6.5, -6.3, -8.3, -8.7, -9.6, -9.4, -9.7, -10, -9.4, -12.3, -15, -17.7, -28.9, -71.8, -71.9, -71.9],
      hi: [-13, -8.5, -5.2, -0.7, 4, 9, 10.7, 11.4, 10.4, 8.7, 7.3, 6.7, 7.1, 7.9, 6.8, 5, 4.7, 6.7, 3.8, 4.4, 3.6, 4.8, 3.8, 2.6, 3.3, 4.7, 2.8, 3.8, 4.4, 4.3, 2.9, 4.1, 3.7, 1.2, 1.2, 1.5, 1, 2, 1.3, 0.6, -1.7, -3.6, -3.6, -1.3, -3.8, -4.1, -5.2, -6.1, -6.9, -6.7, -6.9, -7.4, -7.4, -7.2, -8.2, -10, -12.5, -24.4, -52.2, -52.4, -52.4]
    }
  },
  169: { // Soul & Funk on Deezer
    id: 169, name: 'Soul and funk', noun: 'soul or funk song', songs: 12,
    rel: {
      med: [-1.2, 5.8, 4.1, 3.3, 2.6, 0.3, -2.3, -4.9, -6.2, -15.1],
      lo: [-12.4, -1.6, 2.4, 1.7, 1.4, -2.1, -5, -8.7, -8.4, -18.6],
      hi: [6.7, 7.4, 6.8, 5.4, 4.1, 1.8, -0.2, -1.4, -5.3, -12.8]
    },
    curve: {
      med: [-12, -9.4, -6, -4.5, -0.7, 2.7, 4.9, 5.6, 5, 5, 5.8, 6.3, 5.2, 5.4, 4.6, 5.2, 3.5, 2.5, 2.1, 3.2, 4.3, 3.4, 2.9, 4.1, 3.2, 2.7, 2.9, 2.9, 1.8, 1.1, 1, 0.4, 1.8, 0, -0.2, -2.7, -1.7, -2, -0.9, -3.9, -3.5, -2.6, -4.6, -5.2, -4.6, -5.9, -5.6, -3.8, -5.5, -5.4, -5, -6, -7.7, -8.9, -10.3, -12, -12.7, -25, -66.1, -66, -66],
      lo: [-23.3, -19.4, -17, -14.9, -12, -8.1, -4, -2.4, -1.4, -0.1, -0.1, 1.2, 0.8, 2.1, 1, 2.7, 1.8, 0.9, -0.2, 1.7, 2, 1.5, 0.8, 1, 0.3, 1.3, 0.9, 1.1, 0.5, -1.1, 0.1, -1.5, -2.3, -2, -4, -3.9, -4.2, -3.8, -3.8, -5.7, -6.6, -6.8, -8.3, -8.1, -8.4, -6.7, -7.8, -7.7, -7.5, -7.5, -7.5, -8.3, -9.5, -10.9, -12.7, -16.2, -18.5, -34.5, -69, -69.6, -69.6],
      hi: [-8.3, -4.5, -1.7, 4, 8.1, 10.2, 10.4, 9.3, 7.9, 8.1, 8, 8.3, 8.6, 8, 8, 6.6, 5.4, 4.7, 4.4, 5.2, 6.3, 5.9, 5.8, 5.7, 5.4, 4, 5.8, 5.4, 3.9, 2.7, 3.4, 2.5, 3.9, 2.5, 0.5, 1, 1.4, 0.9, 0.8, -0.2, -0.9, -1.3, -0.9, -0.8, -0.6, -0.9, -2.2, -2.5, -2.7, -4.3, -3, -5, -6.5, -7, -8.7, -7.1, -10.4, -20.1, -57.8, -58.2, -58.2]
    }
  },
  173: { // Films/Games on Deezer
    id: 173, name: 'Film and games', noun: 'film or game soundtrack', songs: 12,
    rel: {
      med: [-7.3, 2.2, 2.8, 2.5, 2.7, 2.5, -0.2, -4.5, -7, -17.1],
      lo: [-14.1, -2.2, 0.7, 1.1, 1.3, 1.6, -4.1, -8.2, -8.9, -19.8],
      hi: [-2.4, 7.8, 4.8, 5.5, 7.7, 3.9, 1, -3, -5, -15.4]
    },
    curve: {
      med: [-20, -16.7, -14.7, -12.3, -8.3, -3.3, -0.7, 0.8, 2.2, 4.4, 4.7, 2.8, 2.9, 2.6, 1.9, 2.4, 2.3, 2.1, 3.3, 3.7, 2, 1, 1.8, 1.2, 1.1, 2.3, 1.5, 2.6, 4, 3.2, 5, 4.1, 2.7, 1.7, 1.3, 0.2, 0.4, -0.1, 0.4, -1, -1.1, -1.8, -1.8, -2.6, -2.9, -2.7, -5.8, -6.3, -6, -4.7, -4.6, -6.1, -7.7, -9.8, -11.2, -13.3, -15.2, -27.8, -64.1, -63.8, -63.8],
      lo: [-25.4, -24.7, -20.7, -16.9, -13.2, -10.6, -6.1, -1.8, -1.4, -0.1, 1.4, -0.2, 1.1, 0.9, -1.9, -0.4, 0.9, 0.5, 0.3, 0.6, 0.7, 0.1, 1.4, -0.3, -1.2, 0.4, -0.3, 1.6, 0.6, 1, 2.4, 2.6, 0.8, 1, 0.2, -1.2, -2.6, -2.5, -3, -3, -4.7, -6, -6.4, -6.5, -7.7, -7.2, -7.7, -8.4, -6.5, -7, -8.5, -7.1, -9.9, -10.8, -13.2, -17.2, -17.8, -32.8, -67.8, -68.5, -68.5],
      hi: [-16.2, -12.6, -9.5, -5.7, -3.7, 1.7, 5.6, 9.2, 9.5, 9.5, 7.4, 6.3, 5.6, 4.3, 4.7, 5.6, 5.3, 5.5, 4, 6.5, 6.1, 5.4, 6.2, 7.1, 3.8, 7, 3.7, 4.8, 6.8, 5.9, 6.4, 6.3, 5.3, 3.6, 2.6, 2.1, 3.6, 2.7, 2, 0.1, 0.3, 0.2, -0.4, -1, -1.1, -1.5, -3.4, -4.7, -4.9, -3.8, -3.6, -3.8, -5, -7.4, -8.7, -9.8, -13.5, -24.6, -58.2, -58, -58]
    }
  },
  197: { // Latin Music on Deezer
    id: 197, name: 'Latin', noun: 'Latin song', songs: 12,
    rel: {
      med: [-1.2, 5.6, 3.7, 3.1, 2, 0.9, -2.2, -5.6, -7.2, -13.8],
      lo: [-5.3, 4.3, 2.4, 0.9, 1.5, -0.1, -3.1, -6.5, -8.1, -16.5],
      hi: [2.9, 6.9, 4.5, 4.6, 2.5, 2.7, -1.2, -3.9, -5.3, -11.7]
    },
    curve: {
      med: [-16.1, -11.3, -7.7, -4.2, -0.3, 2.7, 5.8, 7.4, 7.7, 7.2, 5.6, 4.1, 4.9, 4.3, 3.7, 4.1, 2.4, 3.3, 2.3, 0.9, 1.1, 3.3, 2.8, 3.6, 2.2, 1.5, 0.1, 0.9, 1.5, 2.5, 2.7, 2.2, 0, 0, 0.3, -0.7, -0.8, -0.5, -2.2, -2.7, -2.5, -2.9, -3.6, -3.4, -4.3, -5.7, -7.4, -7.3, -6.5, -6.8, -6.9, -5.9, -6.4, -7.5, -8.4, -9.4, -12.5, -26, -50.3, -50.1, -50.1],
      lo: [-18.6, -15.2, -12.7, -8.7, -4.9, -1.6, 1.1, 5.2, 4.4, 5.1, 3.5, 3.5, 4.2, 3.1, 1.4, 2.6, 1.5, 0.5, 0.1, -0.1, -0.3, 1.1, 0.4, 1.4, -0.9, -0.1, -0.8, -1.1, -0.1, 1.4, 0.6, 1, -1.8, -1, -0.4, -2.1, -2.8, -2, -3.7, -3.5, -3.2, -3.7, -4.8, -4.5, -5.8, -6.9, -8.8, -8.6, -7.5, -7.3, -7.5, -6.8, -7.4, -8.8, -10, -12, -15.6, -29.7, -60.3, -60.4, -60.4],
      hi: [-12, -7, -4.3, -0.3, 3.1, 6.6, 8.9, 8.3, 8.7, 8.3, 6.9, 5.1, 5.3, 6.1, 5.2, 5, 3.1, 4.4, 4.4, 3.6, 3.9, 5.1, 4.8, 4.3, 2.7, 4.2, 0.8, 3.1, 3.3, 3.3, 4.2, 4.9, 1.1, 0.8, 1.5, 0.1, 0.1, 0.7, -0.6, -0.7, -1.7, -0.7, -2.2, -2.5, -3.1, -4.5, -4.3, -5.2, -4.3, -4.7, -4.2, -4.8, -4.4, -5, -5.6, -8.5, -10.5, -20.9, -45.4, -45.1, -45.1]
    }
  },
  464: { // Metal on Deezer
    id: 464, name: 'Metal', noun: 'metal song', songs: 12,
    rel: {
      med: [-10.3, 2.6, 3.2, 2.2, 1, 0.2, 0.2, -2.8, -6.8, -14.3],
      lo: [-17, 1, 1.9, 0.4, -0.4, -0.3, -2.2, -4.2, -7.7, -17.3],
      hi: [-6.9, 4.7, 5.2, 3.2, 3.3, 1.2, 1.5, -1.6, -5.6, -12.3]
    },
    curve: {
      med: [-25.6, -23.7, -21.5, -17.4, -10.8, -6, -3.8, -0.1, 1.8, 3.5, 4.2, 5.2, 4.7, 4.1, 4.8, 2.5, 3.1, 3.2, 4.5, 3, 1.8, 0.5, 1.5, -0.3, -0.7, 2, 1.8, 0.6, 1.4, 0.4, -0.2, 1.5, 0.9, -1.9, -0.3, -0.2, -1.4, 0, 0, 1.1, 2, -0.2, -1.6, -0.9, -1.5, -3.3, -4.1, -4.3, -4.7, -5.6, -6.3, -5.8, -6.3, -8.3, -8.5, -10.4, -13.1, -26, -60.2, -60.8, -60.8],
      lo: [-28.8, -25.4, -23.1, -20.1, -16.8, -12.5, -6.4, -2.1, 0.4, 1.8, 2.3, 0.9, 2.4, 2.2, 2.7, 0.3, 1.1, 1.4, 2.1, 1.3, -0.7, -0.2, -0.7, -0.8, -1.5, 0.4, 0, -1.3, -0.9, -1.6, -1.5, 0.6, -0.4, -2.6, -3.3, -1.9, -3.1, -1.7, -1.6, -1.8, -1.5, -2.7, -3, -2.4, -4.1, -4.2, -5, -5.8, -6.5, -6.4, -7.1, -6.6, -7.5, -9.5, -11.3, -13.2, -15.8, -29.4, -66.8, -66.7, -66.7],
      hi: [-18.8, -14.4, -10.2, -6.4, -4.8, -3.7, -0.3, 2, 4.1, 5.5, 6.5, 6.9, 6.9, 6.3, 5.7, 6, 7.6, 4.1, 5.9, 4.8, 3.4, 1.8, 2.8, 2.5, 0.1, 2.6, 3, 2, 2.7, 3.5, 2.6, 2.6, 1.7, -0.3, 1.5, 1, 1.9, 1.7, 1.5, 2, 2.8, 2.6, 0.6, -0.3, 1.4, -1.6, -2.8, -3, -4, -4.6, -5.2, -5.2, -5.4, -5.2, -6.7, -8.2, -11.5, -22.7, -51.1, -51.3, -51.3]
    }
  },
  466: { // Folk on Deezer
    id: 466, name: 'Folk', noun: 'folk song', songs: 12,
    rel: {
      med: [-9, 1, 4.9, 6.1, 6.5, 2, -2.4, -6.3, -10.1, -20.7],
      lo: [-26.8, -12.2, 1.9, 5.2, 3.5, -0.8, -3.8, -9, -11.7, -27.8],
      hi: [-2, 7.4, 8.2, 11, 8.9, 4.3, 1.2, -3.4, -7.6, -18.2]
    },
    curve: {
      med: [-27.2, -24.4, -21.1, -16.5, -8.9, -4.4, -1.1, -0.1, -0.1, -1.2, -2.3, 0.1, 3.8, 4.6, 4.5, 4, 5.1, 5.7, 7.5, 8.2, 8.1, 7.3, 6.7, 6.9, 6.6, 7.7, 7.1, 4.5, 5.1, 5.3, 3.2, 2.3, 1.6, 2.7, 1.1, -1, 0, -0.3, 0.3, -2.7, -3.4, -2.4, -3.4, -5, -4.7, -7.1, -7, -7.5, -7.8, -7.3, -9.2, -9.1, -9.2, -11.4, -13.4, -15.8, -20.8, -39.2, -65.2, -65.2, -65.2],
      lo: [-29.4, -27, -25, -24.1, -23.7, -23.4, -22.3, -22.8, -20.7, -19.1, -16, -7.7, -1.6, 2.2, 2.9, 0.8, 1.6, 4.2, 5.8, 6.5, 5, 3.9, 3.9, 0.6, 1.7, 3.2, 4.6, 3.1, 4, 1.9, 2.1, 0.3, 0.6, -0.6, 0.2, -2.2, -2.3, -2.3, -2.1, -4, -4.5, -6, -5.5, -6, -8, -9.7, -10.3, -12.1, -10.3, -9.9, -10.5, -10.9, -12.6, -12.1, -18, -23.8, -28.5, -43.2, -69.3, -69.3, -69.3],
      hi: [-23.6, -20.4, -15.8, -11, -4.7, 2, 4.2, 6.2, 9, 6.8, 8.4, 9.6, 9.3, 6, 9.4, 8.2, 8.2, 7.5, 9.8, 10, 10.6, 10, 10.2, 11, 9.9, 10.4, 7.8, 8.1, 6.5, 7.8, 5.6, 4.8, 4.4, 5.2, 2.6, 4.2, 3.7, 4.4, 1.7, 1.3, 0, 1.2, 0, -2.5, -2.6, -3.4, -4.3, -3.8, -4.1, -5.3, -5.9, -5.4, -5.6, -8.8, -11.4, -14.1, -16.5, -27.6, -62.7, -62.5, -62.5]
    }
  }
};
