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
/** How a song's octave balance differs from the median song, band by band (dB). */
export const vsTypical = (rel) => rel.map((v, i) => v - TYPICAL.rel.med[i]);

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

// Filter maths runs on its own offline context so the live audio graph is never disturbed.
const calcCtx = new OAC(1, 128, 44100);
const calcFilters = BANDS.map((f) => {
  const b = calcCtx.createBiquadFilter();
  b.type = 'peaking'; b.frequency.value = f; b.Q.value = Q;
  return b;
});

/** Combined EQ response in dB at the given frequencies. */
export function responseDb(gains, freqs) {
  const fq = freqs instanceof Float32Array ? freqs : Float32Array.from(freqs);
  const mag = new Float32Array(fq.length).fill(1);
  const m = new Float32Array(fq.length), ph = new Float32Array(fq.length);
  calcFilters.forEach((b, i) => {
    b.gain.value = gains[i];
    b.getFrequencyResponse(fq, m, ph);
    for (let k = 0; k < fq.length; k++) mag[k] *= m[k];
  });
  return Array.from(mag, (v) => 20 * Math.log10(Math.max(v, 1e-6)));
}

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
 * Auto fit. dev is how far each band sits from the typical song (vsTypical). sign -1 leans the
 * sound towards the typical song ("even it out"), +1 exaggerates the difference ("bring out its
 * character"). Differences under 1 dB are ignored, the 32 Hz and 16 kHz bands count half (they
 * vary most and are where previews are least reliable) and every band stays within ±cap.
 * Neighbouring bands overlap, so the gains are refined until the combined curve hits the
 * targets at each band centre. Returns gains rounded to 0.5 dB.
 */
export function fitGains(dev, sign, strength, cap) {
  const EDGE = [0.5, 1, 1, 1, 1, 1, 1, 1, 1, 0.5];
  const target = dev.map((d, i) => {
    const mag = Math.max(0, Math.abs(d) - 1) * Math.sign(d);
    return clamp(sign * strength * mag * EDGE[i], -cap, cap);
  });
  let g = target.slice();
  for (let it = 0; it < 14; it++) {
    const r = responseDb(g, BANDS);
    g = g.map((v, i) => clamp(v + 0.6 * (target[i] - r[i]), -cap, cap));
  }
  return g.map((v) => Math.round(v * 2) / 2 || 0);
}
