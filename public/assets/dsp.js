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
 * A typical song, measured with analyse() below: 679 popular songs, the 40 highest with previews
 * on each of 17 Deezer genre charts in November 2026 (at most two per artist; one chart gave 39),
 * 30-second previews. They are the same songs as GENRE_TYPICAL below, pooled.
 * med is the median song, lo and hi the 25th and 75th percentiles, so half of all songs sit
 * between lo and hi. Only these numbers are kept, never the audio.
 *  - rel: energy per octave band relative to the 64 Hz–8 kHz average (same as analyse().rel)
 *  - curve: the balance at 1/6-octave steps from 22.6 Hz (see balanceCurve)
 */
export const TYPICAL = {
  id: 0, name: 'All music', noun: 'song',
  songs: 679,
  rel: {
    med: [-5.4, 4.2, 3.8, 3, 2.8, 1, -1.5, -5, -7.6, -16],
    lo: [-12.2, 1.3, 2, 1.4, 1.2, -0.4, -3.2, -7.2, -10.4, -20.5],
    hi: [-0.1, 6.9, 5.5, 5.3, 4.6, 2.8, 0.3, -3.1, -5.2, -12.4]
  },
  curve: {
    f0: 32 / Math.SQRT2,
    perOct: 6,
    med: [-19.3, -16.5, -13.2, -9.8, -5.1, -1.4, 1.2, 3.3, 4.5, 4.8, 4.9, 4.6, 4.7, 4.6, 4.3, 3.5, 3.1, 3, 3.1, 2.8, 2.7, 2.8, 2.8, 2.6, 2.1, 2.4, 2.4, 2.4, 2.5, 2.4, 2.3, 1.6, 1.2, 0.8, 0.2, -0.2, -0.2, -0.3, -1, -1.6, -2.2, -2.7, -3.2, -3.7, -4.1, -4.6, -5.6, -6, -6.3, -6.3, -6.5, -6.7, -7.2, -8.4, -9.9, -12, -14.7, -31.3, -61.4, -61.2, -61.2],
    lo: [-25.1, -22.7, -19.8, -16.3, -12.2, -8.4, -5.1, -2.4, 0.2, 1.2, 2, 2.1, 2.2, 2.2, 1.7, 1.2, 0.9, 0.8, 0.9, 0.7, 0.4, 0.4, 0.6, 0.2, -0.1, 0.1, 0.2, 0.4, 0.3, 0.2, 0.1, -0.3, -0.7, -1.2, -1.6, -2.2, -2.2, -2.1, -3, -3.5, -4.3, -4.8, -5.5, -5.7, -6.2, -7, -7.8, -8.4, -8.7, -9, -9.5, -9.8, -10.2, -11.7, -13.5, -16.2, -19.8, -38.5, -68.8, -68.5, -68.5],
    hi: [-13.1, -9.9, -6.9, -3.4, 1, 3.7, 6.3, 7.9, 8, 7.7, 7.3, 7.1, 6.9, 7.1, 6.5, 5.6, 5.6, 5.5, 5.6, 5.4, 5.5, 5.7, 5.6, 5.3, 5.1, 5.1, 5.2, 5, 5.1, 4.6, 4.6, 3.8, 3.5, 3.2, 2.2, 1.9, 1.9, 1.7, 1, 0.6, 0.2, -0.4, -1.1, -1.2, -1.7, -2.4, -3.6, -3.8, -4.1, -4.1, -4.2, -4.4, -4.7, -5.7, -6.6, -8.5, -10.5, -25, -50.2, -50.3, -50.3]
  }
};
/** Frequency of point k on the TYPICAL.curve grid. */
export const typicalF = (k) => TYPICAL.curve.f0 * Math.pow(2, k / TYPICAL.curve.perOct);
/**
 * How a song's octave balance differs from the median song of a reference, band by band (dB).
 * Level is arbitrary and only the shape matters, so the differences are centred on the bands
 * that carry most of a song's loudness: each band counts by LOUD_W (most from 500 Hz to 4 kHz,
 * little in the bass, nothing at 32 Hz and 16 kHz), and no band pulls the centre by more than
 * CENTRE_CLIP dB however far out it is. Before the November 2026 audit the centre was the plain
 * 64 Hz–8 kHz average that analyse() uses, so a song with no bass at all read as 5 dB too strong
 * everywhere else and "even it out" turned the whole rest of it down.
 */
const LOUD_W = [0, 0.3, 0.6, 0.9, 1, 1, 1, 1, 0.6, 0], LOUD_SUM = LOUD_W.reduce((a, b) => a + b, 0);
export const CENTRE_CLIP = 6;
export function vsTypical(rel, ref = TYPICAL) {
  const d = rel.map((v, i) => v - ref.rel.med[i]);
  let c = 0;
  for (let k = 0; k < 12; k++) c += d.reduce((s, v, i) => s + LOUD_W[i] * clamp(v - c, -CENTRE_CLIP, CENTRE_CLIP), 0) / LOUD_SUM;
  return d.map((v) => v - c);
}
/**
 * How much songs normally differ from a reference in each band: half the width of the range
 * that holds the middle half of its songs. Never under NOISE_DB, which is about how far a
 * 30-second preview's balance sits from the rest of its own song: across 739 previews measured
 * in November 2026, the two halves of a preview differed by a median of 1.0 to 1.4 dB per band
 * (1.7 dB at 32 Hz).
 */
export const NOISE_DB = 1.5;
export const refSpread = (ref = TYPICAL) => ref.rel.hi.map((h, i) => Math.max(NOISE_DB, (h - ref.rel.lo[i]) / 2));
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

/**
 * Response in dB of any list of filters: [{ type: 'peaking' | 'lowshelf' | 'highshelf', f, q, gain }].
 * Used for your setup (headphone correction and age compensation). Shelves have the usual
 * slope of 1, the same as Q 0.71, which is what AutoEq and Equalizer APO use for shelves.
 */
const specNodes = [];
export function specsResponseDb(specs, freqs) {
  const fq = freqs instanceof Float32Array ? freqs : Float32Array.from(freqs);
  const mag = new Float32Array(fq.length).fill(1);
  const m = new Float32Array(fq.length), ph = new Float32Array(fq.length);
  specs.forEach((s, i) => {
    const b = specNodes[i] || (specNodes[i] = calcCtx.createBiquadFilter());
    b.type = s.type; b.frequency.value = s.f; b.Q.value = s.q || Math.SQRT1_2; b.gain.value = s.gain;
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
 * Long-term average spectrum of a buffer, sampled with analysers at regular points.
 * Returns density (linear power per CURVE_F point), avgDb (same in dB) and rel
 * (energy per octave band relative to the 64 Hz–8 kHz average).
 *
 * Stereo is measured as the average power of the left and right channels, because each ear
 * hears its own channel. Mixing to mono first (what one analyser does) cancels whatever differs
 * between the channels, so wide mixes read up to 8 dB too dark in the top octaves.
 */
export async function analyse(buffer) {
  const sr = buffer.sampleRate, len = buffer.length, dur = len / sr;
  const oc = new OAC(1, len, sr);
  const src = oc.createBufferSource();
  src.buffer = buffer;
  const mk = () => { const a = oc.createAnalyser(); a.fftSize = 8192; a.smoothingTimeConstant = 0; return a; };
  const ans = [];
  if (buffer.numberOfChannels >= 2) {
    const split = oc.createChannelSplitter(2), sink = oc.createGain();
    sink.gain.value = 0; sink.connect(oc.destination);
    src.connect(split);
    for (let c = 0; c < 2; c++) { const a = mk(); split.connect(a, c); a.connect(sink); ans.push(a); }
  } else {
    const a = mk(); src.connect(a); a.connect(oc.destination); ans.push(a);
  }
  src.start();
  const bins = ans[0].frequencyBinCount, acc = new Float64Array(bins), tmp = new Float32Array(bins);
  let n = 0;
  const steps = Math.max(1, Math.min(90, Math.floor(dur / 0.25)));
  const quantum = 128 / sr, used = new Set();
  for (let i = 1; i <= steps; i++) {
    const t = Math.floor((i * dur / (steps + 1)) / quantum) * quantum;
    const key = t.toFixed(6);
    if (t <= 0 || t >= dur || used.has(key)) continue;
    used.add(key);
    oc.suspend(t).then(() => {
      for (const an of ans) {
        an.getFloatFrequencyData(tmp);
        for (let k = 0; k < bins; k++) { const v = tmp[k]; if (isFinite(v)) acc[k] += Math.pow(10, v / 10) / ans.length; }
      }
      n++;
      oc.resume();
    });
  }
  await oc.startRendering();
  if (!n) return null;
  const binHz = sr / 8192;
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
/**
 * Where a recording's sound stops, if it stops short: the lowest frequency from 8 kHz up where
 * the level falls by CUT_DROP dB or more within about a fifth of an octave. Lossy encoders drop
 * everything above a fixed frequency (Deezer's 30-second MP3 previews stop at about 16 kHz),
 * while music fades gradually, a few dB per sixth of an octave at most. Returns the frequency in
 * Hz, or null when the sound carries on to 17 kHz or beyond (the highest the 20 Hz–20 kHz CURVE_F
 * grid can test), as it does in a lossless file.
 */
export const CUT_DROP = 20;
export function soundCutoff(avgDb) {
  const n = avgDb.length;
  const mean = (a, b) => { let s = 0; for (let j = a; j <= b; j++) s += avgDb[j]; return s / (b - a + 1); };
  for (let i = 4; i < n - 6; i++) {
    if (CURVE_F[i] < 8000) continue;
    const below = mean(i - 4, i);
    if (below - mean(i + 2, i + 6) < CUT_DROP) continue;
    let j = i;
    while (j < n - 1 && avgDb[j + 1] > below - 10) j++;
    return CURVE_F[j];
  }
  return null;
}

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
 *
 * Four rules keep a suggestion to what a measurement can support (November 2026 audit, which
 * ran both fits over 739 previews):
 *  - Ordinary differences count for little. Songs of one kind differ by a few dB in every band,
 *    and a 30-second preview differs from the rest of its own song by 1 to 2 dB, so acting on
 *    every difference fitted the EQ to chance. A difference is scaled by z²/(1 + z²), where z is
 *    the difference over that band's usual spread (refSpread): half strength at the edge of the
 *    range that holds half of all songs, 80% at twice that, nearly all of it beyond.
 *  - Nothing is boosted where there's nothing to boost. A band more than FILL_FULL dB under
 *    typical is usually an instrument the song doesn't have (no bass guitar, a 1930s recording
 *    with no treble), so "even it out" fades its lift out, reaching none at FILL_NONE dB under.
 *    Before, 23% of songs got 3 dB or more of lift in a band at least 10 dB under typical,
 *    which only raised rumble and hiss.
 *  - Neighbouring bands never end up more than MAX_STEP dB apart. A steeper step usually comes
 *    from one passage of the preview and sounds unnatural.
 *  - The 32 Hz and 16 kHz bands count half: they vary most between songs and previews are least
 *    reliable there.
 * FIT_AMOUNT sets how far, and the curve stays within ±cap. "Even it out" at Medium now removes
 * all of what's left after the first rule (it was 80% of every difference), which keeps its
 * strength on clear faults about where it was. Its lifts are FILL_GAIN of that: cutting an excess
 * is safe, while a lift bets that the range holds music and not noise.
 */
export const FIT_AMOUNT = { even: { gentle: 0.6, medium: 1, strong: 1.3 }, boost: { gentle: 0.6, medium: 1, strong: 1.6 } };
export const FILL_FULL = 6, FILL_NONE = 12, FILL_GAIN = 0.8, MAX_STEP = 6;
export function fitTargets(dev, sign, amount, cap, spread = refSpread()) {
  const EDGE = [0.5, 1, 1, 1, 1, 1, 1, 1, 1, 0.5];
  const t = dev.map((d, i) => {
    if (sign > 0 && d <= 0) return 0;
    const z = d / spread[i];
    let v = sign * amount * d * (z * z / (1 + z * z)) * EDGE[i];
    if (sign < 0 && d < 0) v *= FILL_GAIN * clamp((FILL_NONE + d) / (FILL_NONE - FILL_FULL), 0, 1);
    return clamp(v, -cap, cap);
  });
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < t.length - 1; i++) {
      const over = Math.abs(t[i + 1] - t[i]) - MAX_STEP;
      if (over > 0) { const h = over / 2 * Math.sign(t[i + 1] - t[i]); t[i] += h; t[i + 1] -= h; }
    }
  }
  return t;
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
export function fitGains(dev, sign, amount, cap, L = L10, step = 0.5, ref = TYPICAL) {
  let g = fitLayout(L, octaveCurve(fitTargets(dev, sign, amount, cap, refSpread(ref))), cap, 0.01);
  // Bringing out never cuts, not even a little where the fit spills over next to a lift.
  if (sign > 0) g = g.map((v) => Math.max(0, v));
  // Neighbouring bands add up, so keep the combined curve, not just each band, within ±cap.
  const r = responseDb(g, FIT_F, L);
  let peak = 0;
  for (let k = 0; k < FIT_F.length; k++) if (FIT_F[k] >= 40 && FIT_F[k] <= 12500) peak = Math.max(peak, Math.abs(r[k]));
  if (peak <= cap) return g.map((v) => roundStep(v, step));
  // Scaled down to the cap: round towards zero, so rounding can't push the curve back over it.
  return g.map((v) => (Math.trunc(v * cap / peak / step + 1e-9 * Math.sign(v)) * step) || 0);
}

/*
 * Typical songs per genre, measured the same way as TYPICAL: the 40 highest songs with previews
 * on each Deezer genre chart in November 2026, at most two per artist. A song is compared with
 * its own genre (from its album on Deezer, or from the artist's other albums) when Earprint has
 * measured that genre, so a metal song isn't judged against pop.
 *
 * Forty songs put a median within about half a dB. The first version used the top 12, which was
 * within about 1 dB at best and let one odd week through: Deezer's classical chart opens with
 * Christmas pop every November, and half of that sample was Brenda Lee and Dean Martin. Songs
 * that clearly aren't the genre (those, here) are left out by hand.
 */
export const GENRE_TYPICAL = {
  84: { // Country on Deezer
    id: 84, name: 'Country', noun: 'country song', songs: 40,
    rel: {
      med: [-3.7, 3.9, 4.1, 3.8, 2.5, 0.9, -1.2, -5.5, -7.8, -16.8],
      lo: [-8.4, 2.9, 2.4, 3.1, 1.8, 0.1, -2.1, -6.5, -9.7, -19],
      hi: [-0.7, 4.7, 5.2, 5.3, 4, 1.7, -0.6, -4.9, -7, -14.8]
    },
    curve: {
      med: [-16.3, -13.5, -10.9, -6.6, -2.2, -1.5, 1, 3.2, 4.8, 5.2, 4.4, 3.7, 5.3, 4, 3.7, 3.6, 3.7, 2.9, 4.3, 4.4, 3, 4.3, 3.8, 3.2, 2.2, 2.5, 1.9, 2.2, 2.4, 2.3, 1.9, 1.6, 1.2, 0.5, 0, -0.5, -0.4, -0.3, -0.6, -1, -1.5, -2.4, -3.2, -4.2, -4.4, -5.2, -6.5, -6.7, -6.9, -7.6, -7, -7.3, -7.2, -8.9, -10.5, -12.8, -16.5, -32.8, -60.9, -60.6, -60.6],
      lo: [-20.5, -18.3, -15.4, -12.3, -8.3, -4.8, -1.3, 0, 2.4, 4, 3.2, 2.3, 3, 2.7, 1.4, 2.3, 1.6, 1.7, 2.3, 2.1, 0.9, 1.4, 2.2, 1.7, 0.6, 1.4, 0.7, 0.5, 1.3, 0.4, 0.4, 0.9, -0.7, -0.6, -1.6, -1.5, -1.5, -1.2, -1.8, -2.1, -3.1, -3.6, -5, -5.2, -5.9, -6.6, -8.4, -8.5, -8.2, -8.8, -9, -8.7, -9.1, -10.6, -12.3, -15, -19.9, -37.6, -70.8, -70.5, -70.5],
      hi: [-11.6, -8, -4.2, -0.5, 1, 2.8, 4.1, 5.5, 6, 6.1, 6, 5.2, 6.4, 6.6, 5.4, 4.7, 5.7, 5.1, 6, 6.3, 6, 5.5, 5.6, 4.4, 4.6, 4.3, 3.4, 4.6, 3.9, 3.8, 3.3, 2.8, 2.9, 2, 1.6, 0.7, 0.4, 1.1, 0.4, 0.2, -0.3, -1.1, -2.5, -2.4, -3.5, -3.9, -4.9, -5.5, -5.5, -6.1, -5.4, -6.1, -6, -6.4, -8.8, -10.5, -13.3, -29.3, -54.2, -54.4, -54.4]
    }
  },
  85: { // Alternative on Deezer
    id: 85, name: 'Alternative', noun: 'alternative song', songs: 40,
    rel: {
      med: [-4.7, 4.4, 4.2, 3, 3.5, 0.9, -2.3, -5.7, -7.6, -15.5],
      lo: [-9.8, 1.3, 2.9, 1.7, 1.9, 0.1, -3.9, -8.2, -10.2, -18.6],
      hi: [0.4, 6.2, 6.3, 4.8, 4.8, 2.1, -0.5, -3.7, -6.3, -12.9]
    },
    curve: {
      med: [-18.9, -16.3, -13.6, -9.7, -5.4, -0.5, 2, 3.7, 4.4, 4.4, 5.1, 4.9, 4.4, 5.8, 5.2, 3.2, 3.4, 4.1, 3.6, 2.7, 2.6, 2.5, 2.8, 2.6, 2.4, 2.6, 3, 2.8, 3.1, 3.3, 3.2, 1.8, 0.5, 0.9, -0.1, 0.3, -0.4, -1.5, -1.7, -3, -3, -3.7, -4, -3.9, -4.3, -5, -6.4, -6.5, -6.6, -6, -6.9, -7.5, -7.6, -8.5, -10.3, -11.7, -13.8, -31.8, -63.6, -63.3, -63.3],
      lo: [-21.6, -19.2, -16.8, -13.7, -9.4, -6.3, -4.1, -1.1, 0.1, 1.4, 1.1, 0.9, 2.4, 3.5, 2.6, 1.1, 1.4, 2.5, 1.1, 1.1, 1.7, 0.9, 1.2, 0.5, 0, 1.1, 1.3, 1.4, 1.3, 1.5, 0.8, 0, -0.7, -1.2, -1.6, -1.4, -1.9, -2, -3.1, -3.8, -5, -5.3, -5.8, -6.8, -7.2, -7.3, -8.3, -8.5, -8.2, -8.1, -8.9, -9.9, -9.7, -11.1, -11.8, -14.2, -18.6, -37, -69.3, -69, -69],
      hi: [-14.3, -10.8, -6.9, -4.2, 0.5, 4.1, 5.8, 6.6, 7.1, 6.6, 7.8, 7.8, 6.7, 7.6, 7.3, 4.5, 6.8, 6.2, 6, 4.3, 5.1, 5.2, 5.6, 5.1, 5.1, 4.2, 5.2, 3.9, 6.7, 5.6, 4.7, 3.4, 3.2, 2.5, 1.3, 2.3, 0.9, 1.1, 0.3, -0.5, -1.6, -1.4, -2.2, -2.3, -2.7, -3, -4.9, -4.7, -5.5, -5.2, -6, -6, -5.7, -6.6, -7.3, -9.2, -10.5, -26.3, -55.7, -54.3, -54.3]
    }
  },
  98: { // Classical on Deezer
    id: 98, name: 'Classical', noun: 'classical recording', songs: 40,
    rel: {
      med: [-15.9, -2.5, 5.3, 9.8, 12.9, 7.5, 0.3, -8.4, -22.6, -32.3],
      lo: [-21.6, -10.9, 0.8, 7.3, 10, 4.8, -4.1, -14.6, -26.4, -37.7],
      hi: [-10.6, 3.5, 8.9, 13.3, 15.9, 9.9, 3.7, -5.1, -17.6, -27.4]
    },
    curve: {
      med: [-17.2, -15.8, -15.5, -14.9, -15.3, -15.2, -12.3, -9.4, -6.7, -5.2, -1.2, 1.5, 3.2, 5.8, 6.7, 4.2, 6.7, 6.4, 6.8, 7.1, 8.5, 8.5, 11.9, 10.7, 11.3, 13.3, 13.7, 13.3, 12.6, 9.8, 7.9, 9.4, 9.3, 6.9, 5.3, 3.6, 2.9, 3, 2.9, 1.8, 1.2, -1.6, -3.3, -3.7, -5.1, -8, -11.3, -13.8, -15.9, -18.2, -20, -21.4, -22.2, -23.2, -25.5, -26.3, -27.1, -42.9, -54.8, -54.5, -54.5],
      lo: [-25.4, -23.9, -22.4, -21.2, -19.2, -19.4, -18, -16.1, -14.2, -11.4, -8.1, -7.2, -2.2, -4.1, 1.5, -1.3, 0.1, 0.7, 2.2, 5, 4.6, 5, 7.4, 8.3, 8.1, 10.2, 10, 8.2, 9.4, 6.4, 5.2, 5.9, 5.9, 2.8, 1.9, 0.6, -1, 0, -2.5, -3.3, -6.4, -7.4, -11.8, -11, -12.9, -13.4, -16.1, -19, -20.2, -23, -24.3, -25, -26.5, -27.9, -29.8, -31.5, -33.9, -48, -57.7, -57.4, -57.4],
      hi: [-8.7, -8.4, -9.1, -9.5, -8.9, -8.3, -5.9, -4, 0.3, 1.4, 4.9, 6.6, 8.4, 11.1, 10.9, 7.7, 12, 13.6, 12.6, 11.9, 14.5, 14.4, 15.5, 16, 15.9, 17.2, 17.8, 17.1, 15.6, 12.8, 11.4, 11.2, 12, 10.1, 8.3, 8.5, 6.9, 5.7, 5.7, 4.5, 4, 1.8, 0.2, -0.1, -1.6, -4.8, -8.7, -11.3, -12.8, -14, -15.2, -16.6, -18.1, -19.6, -20.9, -22.2, -23.7, -40.4, -47.2, -46.9, -46.9]
    }
  },
  106: { // Electro on Deezer
    id: 106, name: 'Electronic', noun: 'electronic track', songs: 40,
    rel: {
      med: [-0.6, 6.5, 3.8, 1.8, 1, -0.5, -2.7, -4.4, -5.5, -13],
      lo: [-6.6, 3.1, 2.1, 0.4, 0.2, -1.4, -3.6, -6.4, -7.6, -18.1],
      hi: [3.7, 8.7, 5.4, 4.8, 4, 1.1, -0.9, -2.7, -3.9, -11.2]
    },
    curve: {
      med: [-17.9, -15.4, -10.9, -6.8, 0, 3.5, 5.6, 7.3, 7.1, 6.9, 6.2, 5.5, 5, 4, 4.3, 4.3, 3.4, 3.3, 2.9, 1.9, 1.3, 2, 1.9, 0.1, 0.3, 1, 1.9, 1.4, 1.4, 0.4, 1, 0.3, -0.1, -0.8, -1.1, -2.1, -1.6, -1.3, -2.4, -2.7, -3.1, -3.9, -3.4, -3.7, -4.1, -4.7, -4.1, -4.2, -4.4, -4.1, -4.3, -4.7, -4.9, -5.8, -7.3, -9, -11.6, -28.2, -52, -51.2, -51.2],
      lo: [-24.6, -22.2, -18.3, -13.8, -7.7, -2.5, 0.3, 3.3, 4, 4, 3.3, 2.6, 2.8, 1.7, 2, 1.3, 1.1, 1.2, 1, -0.3, -0.6, -0.5, -1.8, -1.6, -1.5, -1, -1, 0.2, -0.8, -1.2, -2, -1.9, -1.2, -2.7, -2.7, -3.6, -3, -3, -3.6, -3.6, -4.1, -5.1, -5.6, -5.7, -6.1, -6.7, -7.2, -8, -7.9, -6.9, -6.6, -6.2, -7.4, -9.6, -12, -14.3, -15.9, -33, -63.1, -62.6, -62.6],
      hi: [-10.7, -7.2, -3.8, 0.1, 4.3, 7.5, 9.5, 10.2, 10.5, 9.3, 8.4, 8.2, 7.7, 7, 6.4, 6.4, 6.3, 5.3, 5.7, 4.5, 3, 6, 4.6, 3.3, 2.7, 3.4, 4, 4.6, 3.9, 2.1, 3.6, 1.6, 1, 2, 1.4, 0.3, -0.2, -0.1, -0.4, -1, -1.4, -1.5, -0.6, -1.1, -2.2, -2, -3, -2.5, -2.1, -2.4, -2.9, -3.2, -3.4, -3.9, -5.5, -7.4, -9.3, -22.6, -43.2, -43.2, -43.2]
    }
  },
  113: { // Dance on Deezer
    id: 113, name: 'Dance', noun: 'dance track', songs: 40,
    rel: {
      med: [-1.7, 6.1, 3.6, 1.7, 1.1, -0.2, -1.9, -3.7, -4.2, -12.2],
      lo: [-8.1, 3.6, 1.8, 0.1, 0, -1.5, -3.9, -5, -6, -15],
      hi: [2.4, 7.8, 4.9, 3, 1.8, 0.9, -0.4, -2.7, -2.9, -10.8]
    },
    curve: {
      med: [-19.5, -16.4, -12.2, -7.3, -0.9, 2.6, 5.1, 7, 7.1, 6.4, 5.8, 4.6, 4.9, 4.8, 4.3, 3.9, 2.8, 2.5, 2.6, 2, 1.1, 1.1, 0.8, 0.4, 0.8, 0.2, 0.1, 0.4, 0.4, -0.3, -0.6, 0.4, 0, 0.3, -0.6, -1.4, -1.5, -1.2, -1.8, -1.7, -2.1, -3.5, -3.3, -3.4, -3.4, -3.2, -3.8, -3.7, -3.8, -3.8, -3.5, -3.7, -3.9, -4.7, -6, -8.3, -10.7, -25.9, -49.3, -49.2, -49.2],
      lo: [-23.6, -21.3, -17.4, -14, -7.7, -3.8, 0.6, 3.2, 4.5, 4.2, 3.8, 3.4, 2.2, 1.3, 1.7, 0.6, 1.4, 0.8, 1.7, 0.2, -0.4, -0.3, -0.9, -1.1, -1.4, -0.9, -1.3, -1.7, -1.8, -2, -1.7, -1.6, -0.9, -2.3, -2.2, -3.2, -2.9, -3, -3.4, -3.8, -4.2, -5, -4.5, -5.2, -5.2, -5.1, -5.5, -5.5, -4.8, -5.1, -5.4, -5.9, -5.2, -6.8, -8.4, -11.1, -14.6, -31.6, -56.9, -56.8, -56.8],
      hi: [-14.5, -11.9, -7.2, -2.6, 4.2, 6.5, 9.3, 10.3, 9.6, 8.9, 7.4, 6.6, 6.2, 6.3, 6.1, 5.3, 4.7, 3.9, 4.3, 4, 3.3, 3.4, 2.2, 1.8, 2.1, 1.8, 2.1, 1.2, 2.9, 1.6, 0.9, 2.2, 0.8, 1.8, 1, 0.4, 0.5, 0.5, -0.1, 0, -1.3, -1.3, -1.6, -1.6, -1.7, -2.2, -2, -2.1, -2.3, -2.4, -1.7, -2, -2.3, -3.3, -4.7, -7, -9.6, -22.4, -40.7, -40.4, -40.4]
    }
  },
  116: { // Rap/Hip Hop on Deezer
    id: 116, name: 'Hip hop', noun: 'hip hop song', songs: 40,
    rel: {
      med: [-0.4, 6.7, 3.6, 0.8, 1.3, 0.1, -1.7, -4.2, -5.1, -12.4],
      lo: [-5.5, 5.2, 1.8, -0.4, 0.1, -1.3, -3.7, -5.7, -7.1, -17.6],
      hi: [3.7, 8.2, 5.3, 2, 2.3, 1, -0.2, -3.3, -3.7, -10.2]
    },
    curve: {
      med: [-16.1, -14.4, -10.5, -7.4, 0, 3.4, 6.6, 8.2, 7.5, 7.3, 6.4, 5, 5.2, 4.8, 4.4, 3.9, 3.2, 2.3, 1.6, 1.4, 0.7, 0.3, -0.4, 1, 1.8, 0.9, 0.7, 1.2, 0.8, 1.5, 0.5, 0.3, -0.8, 0.2, -0.3, -0.5, -0.5, -0.7, -1.7, -1.5, -1.7, -1.5, -3.2, -3.6, -3.2, -4.4, -4.6, -5.1, -4.9, -4, -4.3, -5.2, -4.8, -5.5, -6.8, -8.4, -11.3, -25.6, -51.3, -51.1, -51.1],
      lo: [-20.2, -16.6, -13.7, -12, -7, -1.2, 3.7, 5.3, 5.5, 4.4, 4.3, 3.5, 3.3, 2.3, 1.6, 1, 1.1, -0.2, -1, -0.4, -1.6, -1.6, -2.1, -1.9, -1.6, -1.7, -0.4, -0.5, -0.9, 0.1, -0.8, -1.2, -1.5, -1.2, -2, -2.2, -2.9, -2.6, -3.1, -3.7, -4.6, -4.3, -4.9, -4.6, -5.2, -5.4, -7, -6.6, -6.3, -6.9, -6.4, -6.4, -7.8, -8.9, -11.6, -13.1, -15.8, -32.3, -62.8, -62.6, -62.6],
      hi: [-9.1, -6.1, -3.6, 0, 4.5, 7.8, 8.7, 10.1, 9.9, 8.8, 8.3, 6.8, 6.8, 6.9, 5.8, 4.8, 5.1, 3.4, 3.2, 3.3, 3, 1.9, 2.3, 2.7, 2.8, 2.4, 2.9, 3.5, 2.7, 3, 2.1, 1.2, 1.4, 0.9, 0.7, 2, 1.3, 1, 0.3, 0.5, -0.1, -0.7, -1.3, -1.4, -1.7, -3.3, -3.5, -3.3, -3.4, -2.8, -2.7, -2.5, -3.1, -4.3, -5.2, -6.1, -8.5, -22.4, -45.2, -45.5, -45.5]
    }
  },
  129: { // Jazz on Deezer
    id: 129, name: 'Jazz', noun: 'jazz track', songs: 40,
    rel: {
      med: [-3.3, 5.2, 3.5, 3.4, 3.3, 0.8, -2.7, -5.3, -8.4, -14],
      lo: [-8.5, 2.1, 2.5, 2.2, 1.5, -1.1, -3.8, -8.1, -10.7, -17.6],
      hi: [-0.5, 7.6, 5.6, 5.2, 5.8, 3.2, -0.6, -3, -6.3, -10.8]
    },
    curve: {
      med: [-17.2, -14.2, -11.7, -7.5, -2.7, 0.7, 2.2, 4, 5.4, 6, 5.6, 5.9, 5.6, 5.7, 4.6, 3.5, 3.1, 2.6, 2.7, 3.3, 3.3, 3.3, 3, 4, 2.8, 3, 3.4, 3.4, 3.2, 2.6, 1, 1.3, 1.1, 0.3, -0.5, -0.4, -1.4, -1.5, -2.5, -2.4, -2.9, -3.3, -3.5, -3.7, -4.3, -4.4, -5.8, -6.2, -6.6, -6.5, -7.1, -8.5, -8.9, -9.4, -8.6, -10.3, -11.7, -25.8, -64.9, -64.6, -64.6],
      lo: [-24.6, -22.3, -18.7, -14.1, -7.4, -4.4, -1.3, 1.1, 3.2, 3, 3.2, 2.7, 3.6, 3.8, 2.7, 1.7, 1.2, 0.6, 0.4, 1.9, 2.1, 1.7, 0.9, 1.8, 0.5, 1.5, 1.8, 0.4, 0.6, -0.1, -0.6, -0.3, -0.9, -1.8, -2.6, -2.7, -3.8, -3.9, -4.2, -4.6, -5.5, -5.7, -6.2, -6.7, -7.1, -8.3, -9.1, -8.6, -9.2, -8.7, -10.1, -10.2, -10.4, -11.1, -12.9, -13.6, -15.9, -37, -70.2, -69.9, -69.9],
      hi: [-11.1, -8.9, -6.9, -2.3, 1, 3.6, 6.2, 7.3, 7.7, 8.2, 8.1, 7.9, 7.5, 8.1, 6.4, 5.4, 4.3, 4.8, 4.2, 5.8, 5.2, 5.3, 5.6, 5.4, 5.2, 6.2, 6.3, 5.5, 6.3, 4.7, 4.2, 2.8, 3.8, 2.4, 1.8, 1.3, 1, 0.4, -0.4, -1, -1, -1.8, -1.6, -0.4, -1.7, -2.2, -3.8, -4.7, -5, -5, -5.1, -5.8, -5.6, -6.6, -6.3, -6.4, -8.3, -21.8, -56.5, -55.8, -55.8]
    }
  },
  132: { // Pop on Deezer
    id: 132, name: 'Pop', noun: 'pop song', songs: 40,
    rel: {
      med: [-1.7, 5.2, 3.3, 2.7, 2.7, 1.1, -2, -5.4, -7.1, -15.7],
      lo: [-6, 3.6, 1.4, 1.2, 2, 0.1, -3.5, -7.2, -8.9, -17.5],
      hi: [1.3, 7.5, 4.3, 4.4, 3.8, 2.1, -0.9, -4.5, -6.2, -14]
    },
    curve: {
      med: [-16.8, -13.4, -10.1, -5.8, -1.3, 2, 4.1, 5.9, 6.3, 5.9, 5.1, 5.2, 5.4, 4.4, 3.9, 3.1, 2.4, 1.5, 2.6, 1.5, 2.3, 2, 3.4, 2.6, 2.6, 2.8, 2.3, 1.9, 2.1, 1.9, 2.3, 1.9, 2, 0.6, -0.4, -1.5, -1.5, -0.4, -1.3, -2, -3.1, -3.2, -3.9, -4.2, -4.6, -4.4, -5.7, -6.6, -6.8, -6.7, -7, -6.6, -6.5, -7.1, -9.3, -11.6, -14.4, -31.7, -52, -51.7, -51.7],
      lo: [-21.8, -19.2, -15.5, -12, -6, -1.5, 0.9, 1.5, 3.8, 4.4, 3.7, 3.3, 3.7, 3.1, 1.8, 1.3, 0.7, -0.1, -0.3, -0.1, 0.9, -0.8, 1, 1.2, 0.4, 1.4, 1, 0.3, -0.1, 0.3, 0.8, -0.2, 0.5, -0.9, -1.4, -3, -2.4, -1.6, -2.3, -3.3, -4.7, -5.5, -5.9, -5.9, -6.1, -6.3, -6.4, -7.4, -7.7, -8.2, -8.5, -8.1, -8.2, -8.9, -10.8, -13.2, -17, -35.8, -63.8, -62.9, -62.9],
      hi: [-13.1, -9.5, -4.9, 0.7, 2.2, 4.4, 7.9, 8.8, 8.4, 8.7, 7.7, 6.7, 7, 6.1, 5.1, 4, 3.3, 4.4, 4.6, 3.4, 4.1, 5.6, 5.4, 3.8, 4.5, 4.1, 4, 4, 4.6, 3.7, 3.8, 3.3, 3.2, 2.1, 1.4, 1, 1.9, 0.4, 0.2, -0.6, -1.1, -2.2, -2.7, -2.2, -3.2, -3.2, -4.2, -4.7, -5.9, -5.9, -5.8, -5.6, -4.7, -5.2, -7, -10.2, -12.8, -28.2, -47.8, -47.7, -47.7]
    }
  },
  144: { // Reggae on Deezer
    id: 144, name: 'Reggae', noun: 'reggae song', songs: 40,
    rel: {
      med: [-7.4, 5.1, 4.2, 2.2, 1.8, 0.5, -0.6, -4.3, -6.9, -15.1],
      lo: [-13.3, 3.3, 1.7, 0.6, 0.7, -1, -2.5, -5.6, -10.2, -21.1],
      hi: [-0.9, 7.2, 5.8, 3.7, 3.3, 2.1, 0.1, -2.9, -4.8, -11.4]
    },
    curve: {
      med: [-22.9, -19.8, -16.1, -12.7, -7.3, -3.1, 1, 3.9, 5.3, 5.8, 6.8, 6.9, 5.1, 5.7, 4.5, 3, 3.8, 2.8, 2.6, 2.2, 2, 0.8, 2.5, 1.2, 0.6, 0.4, 1.9, 1.5, 2.2, 2, 1.8, 1.8, 0, -0.3, 0.4, -0.5, -0.1, 0.7, -0.4, -1.5, -2, -1.7, -2.4, -3.8, -3.3, -3.4, -5.2, -6.2, -5.9, -6.2, -6.5, -6.9, -6.9, -7.5, -8.6, -11.6, -14.5, -32.3, -66.2, -66, -66],
      lo: [-27, -24.9, -23.5, -19.6, -13.1, -8.6, -3.5, 0, 2.7, 3.9, 3.8, 4, 2.1, 3.2, 1, 1.1, 0.1, -0.3, 0.6, 1.5, -1.1, -0.6, -0.2, -1.5, -1.1, -0.9, -1.1, -0.4, -1, 0.7, -0.9, -1.1, -1.7, -1.9, -1.7, -1.8, -1.9, -1.3, -1.8, -3.4, -3.5, -3.6, -4.1, -5.1, -5.1, -5.3, -6.6, -8, -8.4, -8.6, -9.8, -9.9, -10.2, -12.7, -13.5, -16.5, -20.9, -38.8, -69.5, -69.2, -69.2],
      hi: [-15.2, -11.9, -7.8, -3.3, 0.5, 3.1, 5.8, 8.2, 8.5, 8.1, 9.7, 8.3, 6.8, 7.1, 7.6, 5.6, 5.6, 5.3, 4.6, 4, 5, 3.8, 3.8, 4.4, 3.6, 3.7, 3.8, 2.8, 3.8, 3.8, 4, 4, 2.3, 2.6, 2.2, 1.8, 1.8, 2, 0.6, 0.8, 0.4, 0.1, -0.7, -1.2, -1.6, -2, -2.5, -2.7, -2.9, -3.3, -3.6, -4, -5, -5.9, -5.6, -6.8, -8.5, -23.9, -56.7, -56.5, -56.5]
    }
  },
  152: { // Rock on Deezer
    id: 152, name: 'Rock', noun: 'rock song', songs: 40,
    rel: {
      med: [-11.2, 1.5, 3, 3.1, 3.4, 1.3, -0.4, -3.3, -6.9, -14],
      lo: [-15.1, -1.1, 2.3, 1.3, 1.3, 0.7, -2, -5.1, -8.3, -17.7],
      hi: [-9.5, 2.8, 4, 5.1, 4.3, 2.5, 1.1, -2.1, -4.9, -11.4]
    },
    curve: {
      med: [-26.1, -22.7, -19.5, -15.8, -10.9, -7, -4.2, -1.9, 0, 1.4, 3, 2.3, 3.2, 3.7, 3.9, 3.4, 2.5, 2.6, 3.6, 2.9, 2, 2.6, 2.3, 2.2, 2.2, 2.4, 1.3, 2.6, 2.7, 3.3, 2.8, 2.3, 1.8, 1.5, 0.6, 0.5, 0.5, 0.6, 0.2, -0.6, -0.1, -0.3, -1.6, -1.7, -1.2, -3.2, -4.4, -4.7, -4.2, -5.3, -5.1, -6.1, -7, -8.1, -9.4, -9.9, -11.8, -28, -65.6, -65.3, -65.3],
      lo: [-27.9, -24.8, -22.5, -19.7, -14.6, -10.3, -8.1, -4.9, -1.9, -0.3, 0.5, 0.5, 1.7, 2.3, 2.7, 1.5, 0.6, 0.6, 1.1, -0.2, -0.3, 0.4, 0.8, 0.6, 0.1, 0.6, -0.4, 0.8, 0.2, 0.7, 1, 0.3, -0.1, 0.1, -0.8, -0.7, -0.6, -0.6, -2, -2.1, -2.9, -3.3, -3.6, -4.9, -4.1, -5.1, -6.2, -6.2, -6.1, -6.6, -7.4, -8.9, -8.1, -10, -12.2, -13.7, -17.1, -33, -69.9, -69.6, -69.6],
      hi: [-21.9, -19.5, -17.2, -13.5, -9.5, -5.4, -2, 0.4, 2.7, 4.4, 4.6, 4.9, 4.9, 5.2, 5.4, 4.5, 4.4, 4.9, 6, 5.2, 4.9, 5.2, 4.6, 4.9, 3.8, 4.3, 5.1, 4.8, 5.2, 4.8, 5.2, 3.3, 3, 3.6, 1.9, 1.8, 2.4, 2, 2.1, 1.5, 1.3, 1.3, 0, -0.2, 0.3, -1.1, -3.3, -3, -3.1, -3.1, -3.9, -4.6, -5.4, -6.1, -6.4, -7.3, -8.6, -22.5, -58.7, -60.6, -60.6]
    }
  },
  153: { // Blues on Deezer
    id: 153, name: 'Blues', noun: 'blues song', songs: 40,
    rel: {
      med: [-8, 2.3, 4.4, 3.5, 3.6, 2.2, -0.5, -5.4, -10, -18.9],
      lo: [-15.1, -0.1, 2.3, 1.9, 2.6, 1.3, -1.8, -7.4, -12.9, -25.3],
      hi: [-5.2, 5, 6.4, 5.6, 4.9, 3.9, 0.8, -3.6, -8.1, -15.9]
    },
    curve: {
      med: [-21.9, -18.5, -15.6, -13.5, -8.1, -4.2, -1.5, 0.3, 1.7, 2.1, 3.9, 4, 4.9, 4.4, 4.1, 4.4, 4.3, 3.2, 3.3, 3.2, 3.7, 3.2, 3.3, 4.1, 2.5, 3.1, 4.2, 2.3, 2.8, 4, 3, 2.2, 2.4, 2.3, 1.4, 1.8, 1.1, 1.1, 0.4, -0.7, -0.6, -2.2, -3.2, -3.6, -4.6, -5.3, -7.1, -7.5, -7.9, -8.2, -8.6, -10, -10.8, -11.9, -13, -14.9, -18.9, -36.2, -68, -67.8, -67.8],
      lo: [-26.3, -23.3, -20.2, -17.3, -14.7, -12.4, -8.5, -4.5, -2.4, -0.7, 0.6, 2, 1.7, 2.1, 2.7, 1, 0.9, 1.6, 2, 1.7, 1.8, 0.9, 1.9, 1.3, 0.7, 0.7, 2.1, 1.4, 1.4, 1.5, 1.1, 1.2, 0.6, 0.6, -0.1, 0.1, -0.2, -0.7, -0.7, -2.1, -2.6, -3.7, -5.2, -5.2, -6.4, -7.8, -8.9, -9.5, -10.1, -11.3, -12, -12.9, -13.7, -16, -18.4, -20.9, -24.5, -46.8, -70.3, -70.1, -70.1],
      hi: [-14.2, -13.2, -11.5, -7.9, -3.9, -1.5, 1.4, 3, 4.9, 4.7, 5.6, 6, 7.1, 7.4, 6.2, 6, 6.7, 5.7, 6.7, 5, 6, 6.4, 5.8, 5.4, 5.6, 5.7, 6.1, 6, 5.6, 5.5, 5.9, 4, 4.3, 4.5, 3.3, 3.5, 2.3, 2.4, 2.2, 1.2, 0.6, 0.1, -0.2, -0.9, -1.2, -2.7, -4.6, -4.8, -5.5, -6.2, -6.7, -6.6, -7.4, -8.9, -10.1, -12.4, -15.1, -28.2, -60.1, -59.8, -59.8]
    }
  },
  165: { // R&B on Deezer
    id: 165, name: 'R&B', noun: 'R&B song', songs: 40,
    rel: {
      med: [0.6, 6.3, 4.7, 3.4, 3, 0.3, -2.9, -5.9, -7.4, -16.5],
      lo: [-4.2, 3.7, 2.8, 1.8, 2.2, -1.5, -4.5, -7.6, -9.6, -19.1],
      hi: [5, 8.2, 6, 5.5, 4.3, 1.4, -1.7, -4.6, -5.6, -12.8]
    },
    curve: {
      med: [-16, -14.5, -10.3, -4.4, 1, 4.3, 7.1, 7.2, 7.1, 6.6, 5.2, 5.2, 5.8, 5.2, 4.9, 4.3, 3.6, 3.5, 2.7, 2.5, 3.2, 3.8, 3, 2.3, 2.6, 3.4, 2.8, 3.2, 2.7, 2.8, 2.6, 1.2, 0, -0.5, -2.2, -2, -1.8, -1.4, -1.9, -2.9, -3.7, -4.2, -5, -4.7, -4.9, -5.5, -5.9, -6.4, -6.8, -7.1, -6.9, -7.1, -7.2, -7.7, -10.3, -12.9, -15.7, -32, -59.6, -59.5, -59.5],
      lo: [-21.9, -18.4, -14.9, -12.8, -4.7, 0.3, 2.9, 2.4, 3.7, 4.3, 4, 3.2, 3.6, 2.5, 3.4, 3.3, 2.1, 1.6, 0.8, 1.6, 0.6, 1.9, 1.1, 1, 0.1, 0.9, 2.2, 0.7, 0.9, 1.5, 0, -1, -2.1, -1.9, -3.7, -3.1, -3.8, -3.1, -3.6, -3.9, -5.1, -5.9, -6.8, -6.3, -6.3, -7.5, -7.3, -8.2, -8.9, -9.2, -8.9, -8.9, -9.2, -9.8, -11.9, -15.3, -18.9, -40.4, -69.2, -68.9, -68.9],
      hi: [-7.3, -4.4, -1, 1, 7, 9.1, 9.7, 10.7, 9.5, 8.5, 6.2, 7.1, 7.5, 7, 6.5, 6.9, 4.9, 5.6, 5.1, 4.8, 6.2, 5.6, 5.8, 5, 4.1, 4.8, 4.2, 4.3, 4.3, 4.1, 4.2, 3.3, 1.8, 0.9, 0, -0.5, 0.3, -0.3, -0.6, -1.8, -2.9, -2.7, -2.5, -3.1, -3.8, -4.3, -4.5, -5.5, -5.1, -4.6, -4.5, -4.8, -5.1, -6.1, -7.4, -8.9, -11.4, -27.6, -53.9, -54, -54]
    }
  },
  169: { // Soul & Funk on Deezer
    id: 169, name: 'Soul and funk', noun: 'soul or funk song', songs: 40,
    rel: {
      med: [-3.4, 5.3, 4.6, 3.8, 3.4, 0.9, -2.5, -6.5, -7.9, -16.4],
      lo: [-12.4, 1.3, 3, 2.2, 1.7, -0.6, -5.3, -8, -9.8, -22],
      hi: [1.1, 7.1, 6.2, 5.3, 4.5, 2.7, -1.1, -4.8, -6.1, -13.3]
    },
    curve: {
      med: [-18.8, -17.3, -14.6, -10.1, -5.5, 0.6, 3.8, 4.6, 5.3, 5.8, 5.2, 6.2, 5.3, 6.4, 6.1, 4.5, 4.8, 4, 3.2, 3.8, 4.2, 3.7, 4.1, 4.2, 4.1, 3.4, 2.2, 3, 3.1, 1.9, 1.9, 0.8, 1.8, 1, 0.2, -1.1, -1.3, -1.2, -2.3, -3.5, -3.8, -4.6, -5.5, -5.9, -5.1, -6.3, -6.8, -7, -6.9, -7.3, -6.7, -7.3, -7.7, -8.9, -9.9, -12.2, -14.4, -34.8, -69.7, -69.6, -69.6],
      lo: [-23.8, -22, -18.9, -15.6, -12.3, -8.1, -5.3, -2, 1.7, 1.9, 3, 3.3, 2.6, 3, 2.8, 2.8, 2.6, 1.7, 1.6, 1.8, 1.3, 1.9, 2.2, 2.9, 1, 0.7, 0.8, 1.6, 0.8, -0.9, 0.7, -0.9, -0.6, -1, -1.6, -3.6, -3.6, -3.7, -4.1, -5.2, -5.7, -6.5, -7.4, -7.1, -7.7, -8.3, -8.7, -7.8, -8.1, -8.5, -8.9, -9.4, -10.2, -11.9, -14.7, -18.2, -21.4, -39.7, -71.5, -71.2, -71.2],
      hi: [-12.9, -9.3, -4.2, -1, 2.6, 5.8, 7.7, 8.7, 8.1, 8, 8.2, 8.3, 8, 8.3, 8.1, 6.3, 5.9, 5.8, 5.1, 5.9, 6, 5.7, 5.5, 5.4, 5.9, 5, 6.2, 4.9, 4.4, 3.1, 3.8, 3.8, 4.2, 2.8, 2, 1.1, 1.8, 1, -0.8, -1.5, -2.4, -3, -3.2, -3.1, -3.4, -4.4, -4.2, -3.2, -4.5, -4.5, -4.6, -5.1, -6.1, -7.3, -8.3, -9.5, -11.5, -27, -61.3, -61.2, -61.2]
    }
  },
  173: { // Films/Games on Deezer
    id: 173, name: 'Film and games', noun: 'film or game soundtrack', songs: 39,
    rel: {
      med: [-5, 3.5, 2.9, 2.3, 2.5, 2.2, -0.4, -4.8, -7.2, -15.9],
      lo: [-12.7, 1.2, 1.5, 1.3, 1.4, 0.7, -2.7, -6.9, -10.5, -20.2],
      hi: [-0.9, 7.2, 4.9, 3.1, 3.7, 3.9, 1.1, -2.8, -5.4, -14]
    },
    curve: {
      med: [-19.6, -16.6, -12.4, -10.7, -5.2, -1.2, 1.7, 2.8, 5, 4.6, 5.3, 4.3, 3.9, 3.8, 3.9, 2.6, 2.2, 2.6, 2.2, 2, 1.2, 1.7, 2.4, 2.6, 1.6, 2.4, 2.2, 2.6, 2.4, 2.8, 3.7, 2.8, 2.6, 2.6, 0.8, 0.1, 1, 0.9, -0.7, -1.3, -2, -1.8, -2.6, -3.5, -3.3, -4, -5.6, -6.1, -6.2, -6, -6.3, -6.3, -7.7, -8.6, -9.9, -12.3, -14.1, -30.1, -66.7, -66.7, -66.7],
      lo: [-23.4, -21.7, -19.2, -15.9, -12.1, -8.8, -5.8, -2.6, 0.1, 2.1, 2.2, 0.7, 1.5, 1.3, 1.7, 0.7, 0, 0.7, 0.5, 0, -0.4, -0.3, 1, 0.2, 0, 0.5, 0.8, 0.4, -0.4, 0.4, 1.7, 0.6, 0.8, 0.5, -1.2, -1.3, -1.6, -1.4, -2.8, -3.4, -3.6, -4.9, -5.6, -5.1, -6.1, -6.4, -7.1, -9.1, -10.2, -10.7, -10.7, -9.5, -9.8, -11.2, -12.9, -16.9, -19.8, -36.4, -69.5, -69.2, -69.2],
      hi: [-13.6, -9.7, -5.6, -3, -0.4, 2.2, 6.3, 8.6, 8.8, 8.6, 7.4, 6.6, 6.8, 6.1, 5.7, 5.4, 4.4, 4.5, 3.9, 4.1, 4.4, 3.9, 4.2, 4.7, 4.4, 3.9, 3.7, 5.1, 6.2, 4.9, 6.5, 5.1, 4.7, 4.2, 3.7, 2.9, 3.6, 3, 1.4, 1, 0.9, 0, -0.7, -1.5, -1.2, -1.7, -3.3, -4.6, -4.3, -4, -3.5, -4.5, -5.6, -6.5, -7.7, -9.4, -11.9, -26.2, -59.6, -59.4, -59.4]
    }
  },
  197: { // Latin Music on Deezer
    id: 197, name: 'Latin', noun: 'Latin song', songs: 40,
    rel: {
      med: [-2.7, 4.4, 2.2, 2.4, 2.5, 1.1, -1.2, -4.9, -7, -13.6],
      lo: [-9.2, 1.1, 1.3, 1.1, 1.4, -0.1, -2.6, -6, -9.1, -19],
      hi: [0.1, 7, 4.1, 4.5, 3.9, 2.6, 0.3, -3.2, -4.9, -11.9]
    },
    curve: {
      med: [-17, -14.3, -10.9, -7.4, -2.2, 1.4, 2.9, 5.4, 5, 5.3, 4.9, 4.5, 4.6, 3.8, 2.2, 3, 1.2, 1.4, 1.9, 1.8, 1.9, 2.6, 2.3, 2, 2.1, 1.7, 1.9, 2.8, 2.2, 2.4, 2.6, 2, 0.9, 0.5, 0.5, 0.3, -0.1, 0, -0.5, -0.9, -2.5, -2.5, -3.4, -3.4, -4.3, -4.7, -5.5, -5.6, -5.1, -5.7, -5.8, -5.6, -6.6, -6.9, -7.6, -9.5, -13, -29.6, -51.7, -51.6, -51.6],
      lo: [-21.5, -18.6, -16, -13.2, -9.6, -5.3, -2, -2.5, 0.2, 1.9, 2.2, 2.9, 3.3, 0.8, 0.3, 0.8, -0.5, -0.8, -0.6, 0.1, -0.5, 0.7, 1, -0.4, -0.6, 0, -0.1, 0.6, 0.5, 0.9, 1.6, -0.2, -0.7, -0.7, -0.7, -1.5, -1.2, -1.5, -2, -3, -3.6, -4.1, -4.5, -5, -6, -6.2, -6.9, -7.1, -6.8, -7.4, -8.1, -8.1, -9.4, -10, -11.6, -15.1, -18.2, -33.8, -68.7, -68.4, -68.4],
      hi: [-12.8, -8.9, -6.2, -2.4, 2.3, 4, 6.2, 7.7, 7.7, 7.4, 6.7, 6.2, 6, 6.3, 4.9, 4.6, 2.5, 3.4, 3.8, 4.7, 3.9, 5.5, 4.1, 3.8, 4.9, 3.9, 4.1, 5.2, 5.1, 3.7, 4.4, 4, 2.4, 2, 2.8, 2.4, 2, 1.8, 1.1, 0.7, 0.3, 0.1, -1.6, -2.1, -1.7, -2.3, -3.3, -3.7, -3.9, -3.5, -3.6, -3.7, -4.4, -5.2, -6.2, -8, -10.2, -23.8, -43.1, -42.8, -42.8]
    }
  },
  464: { // Metal on Deezer
    id: 464, name: 'Metal', noun: 'metal song', songs: 40,
    rel: {
      med: [-7.4, 2.6, 3.8, 1.3, 0.6, 0.2, 0.6, -1.8, -6.2, -14.2],
      lo: [-12.6, 0.5, 1, 0.3, -0.7, -0.8, -0.6, -2.8, -7.8, -18.3],
      hi: [-4.7, 3.7, 5.3, 2.9, 1.7, 2.1, 1.4, -0.8, -4.9, -11.8]
    },
    curve: {
      med: [-22.5, -19.8, -15.6, -11.9, -5.8, -3.9, -2.1, -0.3, 1.3, 2.8, 3.3, 4.3, 4.5, 4.6, 4.4, 2.8, 3.3, 2.1, 2.8, 1.9, 1.3, 1.1, 0.8, 0.1, -0.2, 0, 0.1, 0.4, 0.3, 1.4, 1, 0.8, 0.2, -0.4, 0.8, -0.1, 0.8, 1.6, 0.3, 1.2, 1, 0.4, -0.5, -0.2, -0.6, -1.5, -2.2, -3.3, -4, -5, -5.7, -5.7, -6.6, -8, -8.8, -10.1, -12.3, -29.5, -57.4, -57.4, -57.4],
      lo: [-27.5, -24.3, -21.6, -17.5, -13.2, -9.3, -6, -3.2, -0.4, 1.2, 2, 1.3, 2.6, 1.7, 0.9, 1.1, 0.3, 0.6, 1.1, 0.3, -0.5, -0.5, -1, -0.9, -1.5, -1.6, -1.6, -1.2, -0.8, -1.3, -1.2, -0.9, -1.2, -2, -2.2, -1.1, -1.3, -0.4, -0.9, -0.8, -0.2, -0.6, -1.5, -0.8, -2.1, -2.5, -3.6, -4.6, -5.2, -6.4, -7.2, -7.4, -8.1, -9.9, -11.7, -14.1, -16.9, -34.1, -65.6, -65.3, -65.3],
      hi: [-17.1, -14.1, -11, -7.1, -2.7, -1.2, 0.7, 1.7, 3.4, 4.6, 5.7, 5.8, 6.5, 6.4, 5.7, 5.6, 5.4, 4.3, 5.1, 3.9, 3.4, 2.1, 2.7, 1.6, 0.9, 2, 2, 1.7, 1.7, 2.9, 3.2, 3.2, 2.4, 2.3, 2, 2.1, 2.5, 2.7, 2.4, 2.4, 2.4, 2.3, 0.8, 1.4, 1.6, -0.1, -1.5, -2.3, -3, -3.6, -4.2, -4.6, -4.8, -5.8, -6.8, -8.1, -9.6, -24.5, -47.8, -47.8, -47.8]
    }
  },
  466: { // Folk on Deezer
    id: 466, name: 'Folk', noun: 'folk song', songs: 40,
    rel: {
      med: [-12.9, 1.2, 4.2, 6.7, 5.4, 2.8, -1.9, -6.4, -10.5, -19.7],
      lo: [-23.5, -7.3, 2.5, 4.8, 4, 1, -4, -8.6, -13.1, -25.3],
      hi: [-2.9, 5.8, 6.8, 9.3, 7.5, 4.5, 0.4, -4.3, -6.9, -16.6]
    },
    curve: {
      med: [-24.5, -22.2, -20.7, -16.5, -10.3, -8.6, -6, -4.5, -0.1, 1.9, 3, 4.3, 2.6, 4.4, 5, 2.9, 4, 5.6, 6.5, 7.3, 8, 7.2, 6.5, 6.4, 5.3, 5.4, 6.5, 5.3, 4.9, 3.8, 4.1, 2.5, 3.2, 3, 1.7, -0.3, 0.6, 0.1, -0.8, -1.7, -3.2, -2.9, -4.1, -5, -4.9, -5.7, -6.6, -7.6, -8.2, -8.2, -9.5, -8.8, -9.1, -11.4, -13, -15.4, -18.2, -38.6, -66.6, -66.4, -66.4],
      lo: [-28, -25.2, -23.3, -22.9, -21.9, -20, -18.7, -16.4, -14.7, -13.8, -10.4, -5.6, 0.9, 2.2, 2.3, 0.2, 1.4, 3.6, 4.4, 4.1, 4.8, 3.8, 4.1, 1.4, 1.8, 2.3, 3.1, 3.3, 2.9, 1.7, 2, 0.7, 0.5, -0.2, -0.8, -2.1, -1.7, -2, -2.5, -3.7, -4.6, -6.1, -5.7, -6.5, -7.1, -8.5, -9.6, -10.7, -12, -10.7, -11.3, -11.7, -12.3, -13.6, -17.7, -20.3, -24.7, -46, -69.3, -69.1, -69.1],
      hi: [-18.8, -16.8, -12.9, -8.7, -4, 1.6, 4.6, 5.4, 3.4, 5.4, 7.1, 6.5, 7.2, 6.9, 9, 6.5, 7.3, 8.6, 8.7, 10.8, 10.5, 9.3, 9.3, 8.4, 7.4, 8.9, 8.8, 7.9, 7.1, 7.1, 6.8, 4.9, 6, 5.8, 4, 1.8, 3.1, 3.2, 1.9, 0.6, -0.5, 0.1, -1.1, -2.4, -3.2, -3.4, -5, -5.3, -5.7, -5.8, -5, -5.1, -5.9, -8.9, -11, -12.1, -14, -30.2, -64, -63.7, -63.7]
    }
  }
};
