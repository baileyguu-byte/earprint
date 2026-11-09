// A short demo loop (drums, bass, pads and a pluck) synthesised offline, so the lab
// always has something to play even without a network connection.
import { OAC } from './dsp.js';

export async function makeDemo() {
  const sr = 44100, bpm = 104, beat = 60 / bpm, bars = 4, dur = bars * 4 * beat;
  const oc = new OAC(2, Math.ceil(dur * sr), sr);
  const out = oc.createGain();
  out.gain.value = 0.8;
  out.connect(oc.destination);

  const nb = oc.createBuffer(1, sr, sr);
  const nd = nb.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const env = (g, t, peak, a, d) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  };
  const kick = (t) => {
    const o = oc.createOscillator(), g = oc.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    env(g, t, 1, 0.003, 0.45);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.5);
  };
  const noise = (t, type, freq, q, level, decay) => {
    const s = oc.createBufferSource(); s.buffer = nb;
    const f = oc.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = oc.createGain(); env(g, t, level, 0.002, decay);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random() * 0.5); s.stop(t + decay + 0.03);
  };
  const snare = (t) => {
    noise(t, 'bandpass', 1900, 0.8, 0.6, 0.2);
    const o = oc.createOscillator(), g = oc.createGain();
    o.type = 'triangle'; o.frequency.value = 196;
    env(g, t, 0.35, 0.002, 0.12);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + 0.16);
  };
  const hat = (t, open) => noise(t, 'highpass', 7600, 0.7, open ? 0.16 : 0.1, open ? 0.24 : 0.045);
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
  const roots = [33, 29, 36, 31];

  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * 4 * beat;
    for (let b = 0; b < 4; b++) {
      const t = t0 + b * beat;
      if (b === 0 || b === 2) kick(t);
      if (b === 1 || b === 3) snare(t);
      hat(t, false); hat(t + beat / 2, b === 3);
    }
    if (bar % 2 === 1) kick(t0 + 2.5 * beat);
    for (let e = 0; e < 8; e++) {
      const t = t0 + e * beat / 2, m = roots[bar] + (e % 4 === 3 ? 12 : 0);
      const o = oc.createOscillator(), f = oc.createBiquadFilter(), g = oc.createGain();
      o.type = 'sawtooth'; o.frequency.value = mtof(m);
      f.type = 'lowpass'; f.Q.value = 3;
      f.frequency.setValueAtTime(1100, t); f.frequency.exponentialRampToValueAtTime(200, t + beat / 2);
      env(g, t, 0.3, 0.008, beat / 2 * 0.9);
      o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + beat / 2 + 0.02);
    }
    chords[bar].forEach((m) => [-7, 7].forEach((det) => {
      const o = oc.createOscillator(), f = oc.createBiquadFilter(), g = oc.createGain();
      o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
      f.type = 'lowpass'; f.frequency.value = 1900;
      g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.03, t0 + 0.3);
      g.gain.setValueAtTime(0.03, t0 + 4 * beat - 0.12); g.gain.linearRampToValueAtTime(0.0001, t0 + 4 * beat);
      o.connect(f); f.connect(g); g.connect(out); o.start(t0); o.stop(t0 + 4 * beat);
    }));
    for (let s = 0; s < 16; s++) {
      const t = t0 + s * beat / 4, m = chords[bar][s % 3] + 12 + (s % 8 === 7 ? 12 : 0);
      const o = oc.createOscillator(), f = oc.createBiquadFilter(), g = oc.createGain();
      o.type = 'square'; o.frequency.value = mtof(m);
      f.type = 'lowpass'; f.frequency.value = 4500;
      env(g, t, 0.045, 0.004, 0.15);
      o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + 0.18);
    }
  }

  const buf = await oc.startRendering();
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
  }
  const k = peak > 0 ? 0.89 / peak : 1;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
  return buf;
}
