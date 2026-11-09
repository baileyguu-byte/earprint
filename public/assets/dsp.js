// Audio maths shared by the lab: EQ bands, filter responses, song analysis and decoding.

export const AC = window.AudioContext || window.webkitAudioContext;
export const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;

// Octave bands matching the Music app on a Mac (and most 10-band graphic equalisers).
export const BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const BAND_LABELS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
export const BAND_NAMES = ['deep sub-bass', 'sub-bass', 'bass', 'upper bass', 'low mids', 'mids', 'upper mids', 'presence', 'brilliance', 'air'];
export const Q = 1.41;
export const RANGE = 12;

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
