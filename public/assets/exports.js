// Export formats for real apps. Each was checked against the app's own documentation:
// - Music app on a Mac: 10 bands at 32 Hz … 16 kHz plus a preamp slider.
// - Spotify: six bands at 60, 150, 400 Hz, 1, 2.4 and 15 kHz; sliders are dragged by hand.
// - Equalizer APO: "Preamp:" and "Filter n: ON PK Fc … Hz Gain … dB Q …" lines paste straight into config.txt.
// - Wavelet (Android): imports a GraphicEQ file that must use exactly these 127 frequencies.
import { BANDS, Q, CURVE_F, responseDb } from './dsp.js';

export const FORMATS = [
  { id: 'apple', label: 'Apple Music (Mac)' },
  { id: 'spotify', label: 'Spotify' },
  { id: 'apo', label: 'Equalizer APO' },
  { id: 'wavelet', label: 'Wavelet' }
];

const SPOTIFY_F = [60, 150, 400, 1000, 2400, 15000];
const WAVELET_F = [20, 21, 22, 23, 24, 26, 27, 29, 30, 32, 34, 36, 38, 40, 43, 45, 48, 50, 53, 56, 59, 63, 66, 70, 74, 78, 83, 87, 92, 97, 103, 109, 115, 121, 128, 136, 143, 151, 160, 169, 178, 188, 199, 210, 222, 235, 248, 262, 277, 292, 309, 326, 345, 364, 385, 406, 429, 453, 479, 506, 534, 565, 596, 630, 665, 703, 743, 784, 829, 875, 924, 977, 1032, 1090, 1151, 1216, 1284, 1357, 1433, 1514, 1599, 1689, 1784, 1885, 1991, 2103, 2221, 2347, 2479, 2618, 2766, 2921, 3086, 3260, 3443, 3637, 3842, 4058, 4287, 4528, 4783, 5052, 5337, 5637, 5955, 6290, 6644, 7018, 7414, 7831, 8272, 8738, 9230, 9749, 10298, 10878, 11490, 12137, 12821, 13543, 14305, 15110, 15961, 16860, 17809, 18812, 19871];

const hz = (f) => (f >= 1000 ? (f / 1000) + ' kHz' : f + ' Hz');
const signed = (v, d = 1) => (v > 0 ? '+' : '') + v.toFixed(d);
const halfStep = (v) => Math.max(-12, Math.min(12, Math.round(v * 2) / 2));
const fileSafe = (s) => (s || 'Custom').replace(/[^\w\- ]+/g, '').trim() || 'Custom';

/** Largest boost anywhere in the combined curve, rounded up to 0.1 dB. */
function headroom(gains) {
  const peak = Math.max(0, ...responseDb(gains, CURVE_F));
  return Math.ceil(peak * 10) / 10;
}

function spotifyVisual(values) {
  const cols = values.map((v, i) => {
    const pos = (v + 12) / 24 * 100;
    return '<div class="spot-col"><span class="spot-val">' + signed(v) + '</span>' +
      '<span class="spot-track" aria-hidden="true"><span class="spot-zero"></span><span class="spot-knob" style="bottom:' + pos.toFixed(1) + '%"></span></span>' +
      '<span class="spot-lab">' + hz(SPOTIFY_F[i]).replace(' ', '&nbsp;') + '</span></div>';
  }).join('');
  return '<div class="spot" role="img" aria-label="Where to set each of Spotify\'s six sliders">' + cols + '</div>';
}

/**
 * Build one export. Returns { text, note, copy, download?: { filename, text }, visual? }.
 */
export function buildExport(id, gains, name) {
  const label = fileSafe(name);
  if (id === 'spotify') {
    const values = responseDb(gains, SPOTIFY_F).map(halfStep);
    return {
      visual: spotifyVisual(values),
      text: SPOTIFY_F.map((f, i) => hz(f).padEnd(9) + signed(values[i]) + ' dB').join('\n'),
      note: 'Spotify’s sliders can’t take typed values, so drag each one to match the picture. You’ll find the equaliser in Spotify’s settings under Playback or Audio quality, depending on your device. Its six sliders cover the same curve more coarsely, so treat this as a close match.',
      copy: true
    };
  }
  if (id === 'apo') {
    const pre = headroom(gains);
    const text = 'Preamp: ' + (-pre).toFixed(1) + ' dB\n' +
      BANDS.map((f, i) => 'Filter ' + (i + 1) + ': ON PK Fc ' + f + ' Hz Gain ' + gains[i].toFixed(1) + ' dB Q ' + Q.toFixed(2)).join('\n');
    return {
      text,
      note: 'Equalizer APO (Windows): paste these lines into config.txt in Equalizer APO’s config folder and save. The preamp line turns the overall level down by the largest boost so nothing distorts.',
      copy: true,
      download: { filename: 'Earprint ' + label + '.txt', text: text + '\n' }
    };
  }
  if (id === 'wavelet') {
    const r = responseDb(gains, WAVELET_F);
    const text = 'GraphicEQ: ' + WAVELET_F.map((f, i) => f + ' ' + (Math.round(r[i] * 10) / 10)).join('; ');
    return {
      text,
      note: 'Wavelet (Android): download this file, then in Wavelet open AutoEq, choose Import and pick it. Wavelet shows the file name as the profile name and evens out the volume itself. Imports are meant for headphone correction, so Wavelet uses this in place of a headphone profile you’ve picked there.',
      copy: false,
      download: { filename: 'Earprint ' + label + '.txt', text: text + '\n' }
    };
  }
  // Apple Music (Mac) and other 10-band equalisers.
  const pre = headroom(gains);
  const lines = ['Preamp'.padEnd(9) + (pre ? '-' + pre.toFixed(1) : '0.0') + ' dB']
    .concat(BANDS.map((f, i) => hz(f).padEnd(9) + signed(gains[i]) + ' dB'));
  return {
    text: lines.join('\n'),
    note: 'Music app on a Mac: open the Window menu, choose the equaliser, then set each slider and the preamp as close to these values as you can. The same numbers work in most 10-band equalisers that use these frequencies.',
    copy: true
  };
}
