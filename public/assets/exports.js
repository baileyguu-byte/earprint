// Export formats for real apps and devices. Each was checked against the app's own documentation:
// - Music app on a Mac: 10 bands at 32 Hz … 16 kHz plus a preamp slider.
// - Samsung Galaxy (One UI): Custom equaliser, 9 bands at 63 Hz … 16 kHz, whole dB from −10 to +10.
// - Spotify: six bands at 60, 150, 400 Hz, 1, 2.4 and 15 kHz; sliders are dragged by hand.
// - Android's built-in equaliser: five bands at 60, 230, 910 Hz, 3.6 and 14 kHz.
// - Bass, mid and treble tone controls: frequencies vary by maker; cars often count in steps.
// - Equalizer APO: "Preamp:" and "Filter n: ON PK|LSC|HSC Fc … Hz Gain … dB Q …" lines paste into config.txt.
// - Wavelet (Android): imports a GraphicEQ file that must use exactly these 127 frequencies.
// A setting made with other bands is converted to the device's bands (closest match).
import { CURVE_F, responseDb, layoutById, convertGains, curveGap, bandLabel, bandHz } from './dsp.js';

export const FORMATS = [
  { id: 'apple', label: 'Apple Music (Mac)', layout: 'b10' },
  { id: 'samsung', label: 'Samsung Galaxy', layout: 'b9' },
  { id: 'spotify', label: 'Spotify', layout: 'b6' },
  { id: 'android', label: 'Android 5-band', layout: 'b5' },
  { id: 'tone', label: 'Car or speaker', layout: 'b3' },
  { id: 'apo', label: 'Equalizer APO' },
  { id: 'wavelet', label: 'Wavelet' }
];
/** The export format that matches a layout, so the lab can suggest it. */
export const formatForLayout = (id) => (FORMATS.find((f) => f.layout === id) || FORMATS[0]).id;

const WAVELET_F = [20, 21, 22, 23, 24, 26, 27, 29, 30, 32, 34, 36, 38, 40, 43, 45, 48, 50, 53, 56, 59, 63, 66, 70, 74, 78, 83, 87, 92, 97, 103, 109, 115, 121, 128, 136, 143, 151, 160, 169, 178, 188, 199, 210, 222, 235, 248, 262, 277, 292, 309, 326, 345, 364, 385, 406, 429, 453, 479, 506, 534, 565, 596, 630, 665, 703, 743, 784, 829, 875, 924, 977, 1032, 1090, 1151, 1216, 1284, 1357, 1433, 1514, 1599, 1689, 1784, 1885, 1991, 2103, 2221, 2347, 2479, 2618, 2766, 2921, 3086, 3260, 3443, 3637, 3842, 4058, 4287, 4528, 4783, 5052, 5337, 5637, 5955, 6290, 6644, 7018, 7414, 7831, 8272, 8738, 9230, 9749, 10298, 10878, 11490, 12137, 12821, 13543, 14305, 15110, 15961, 16860, 17809, 18812, 19871];

const signed = (v, d = 1) => (v > 0 ? '+' : '') + v.toFixed(d);
const fmtDb = (v, step) => signed(v, step >= 1 ? 0 : 1);
const fileSafe = (s) => (s || 'Custom').replace(/[^\w\- ]+/g, '').trim() || 'Custom';

/** Largest boost anywhere in the combined curve, rounded up to 0.1 dB. */
function headroom(gains, L) {
  const peak = Math.max(0, ...responseDb(gains, CURVE_F, L));
  return Math.ceil(peak * 10) / 10;
}

/** A picture of the device's sliders, for apps where you drag them by hand. */
function sliderVisual(values, L, range, step, what) {
  const cols = values.map((v, i) => {
    const pos = (Math.max(-range, Math.min(range, v)) + range) / (2 * range) * 100;
    return '<div class="spot-col"><span class="spot-val">' + fmtDb(v, step) + '</span>' +
      '<span class="spot-track" aria-hidden="true"><span class="spot-zero"></span><span class="spot-knob" style="bottom:' + pos.toFixed(1) + '%"></span></span>' +
      '<span class="spot-lab">' + bandLabel(L.bands[i]) + '</span></div>';
  }).join('');
  return '<div class="spot" style="grid-template-columns:repeat(' + values.length + ',minmax(0,1fr))" role="img" aria-label="Where to set each of ' + what + '’s sliders">' + cols + '</div>';
}

/**
 * Build one export of a setting (gains on layout L, step size step).
 * Returns { text, note, copy, download?: { filename, text }, visual?, match? }.
 */
export function buildExport(id, gains, name, L, step) {
  const label = fileSafe(name);
  const fmt = FORMATS.find((f) => f.id === id) || FORMATS[0];

  if (id === 'apo') {
    const pre = headroom(gains, L);
    const lines = L.bands.map((b, i) => {
      const g = 'Gain ' + gains[i].toFixed(1) + ' dB';
      if (b.type === 'lowshelf') return 'Filter ' + (i + 1) + ': ON LSC Fc ' + b.f + ' Hz ' + g + ' Q 0.71';
      if (b.type === 'highshelf') return 'Filter ' + (i + 1) + ': ON HSC Fc ' + b.f + ' Hz ' + g + ' Q 0.71';
      return 'Filter ' + (i + 1) + ': ON PK Fc ' + b.f + ' Hz ' + g + ' Q ' + b.q.toFixed(2);
    });
    const text = 'Preamp: ' + (-pre).toFixed(1) + ' dB\n' + lines.join('\n');
    return {
      text,
      note: 'Equalizer APO (Windows): paste these lines into config.txt in Equalizer APO’s config folder and save. It uses exactly the bands you shaped in the lab. The preamp line turns the overall level down by the largest boost so nothing distorts.',
      copy: true,
      download: { filename: 'Earprint ' + label + '.txt', text: text + '\n' }
    };
  }
  if (id === 'wavelet') {
    const r = responseDb(gains, WAVELET_F, L);
    const text = 'GraphicEQ: ' + WAVELET_F.map((f, i) => f + ' ' + (Math.round(r[i] * 10) / 10)).join('; ');
    return {
      text,
      note: 'Wavelet (Android): download this file, then in Wavelet open AutoEq, choose Import and pick it. It reproduces the exact curve you shaped in the lab. Wavelet shows the file name as the profile name and evens out the volume itself. Imports are meant for headphone correction, so Wavelet uses this in place of a headphone profile you’ve picked there.',
      copy: false,
      download: { filename: 'Earprint ' + label + '.txt', text: text + '\n' }
    };
  }

  // Devices with fixed bands: use the setting as it is, or its closest match on their bands.
  const T = layoutById(fmt.layout);
  const tStep = T.id === L.id ? step : (id === 'apple' || id === 'spotify' ? 0.5 : 1);
  const values = T.id === L.id ? gains.slice() : convertGains(gains, L, T, tStep);
  let match = '';
  if (T.id !== L.id) {
    const gap = curveGap(gains, L, values, T);
    match = gap < 0.75
      ? 'Converted from your ' + L.count + '-band setting; it comes out almost the same.'
      : 'Converted from your ' + L.count + '-band setting: the closest match on ' + T.count + ' bands, within about ' + (Math.round(gap * 2) / 2) + ' dB. Switch the lab to ' + T.title + ' to hear exactly what you’ll get.';
  }

  if (id === 'samsung') {
    return {
      visual: sliderVisual(values, T, 10, tStep, 'the Samsung equaliser'),
      text: T.bands.map((b, i) => bandHz(b).padEnd(9) + fmtDb(values[i], 1) + ' dB').join('\n'),
      note: 'Samsung Galaxy: Settings › Sounds and vibration › Sound quality and effects › Equaliser › Custom, then drag each slider to match. Connect your earbuds or headphones first: Samsung keeps a separate equaliser for each output, and locks the 63 and 125 Hz sliders on the phone’s own speaker. Dolby Atmos and Adapt Sound change the sound too, so turn them off while you compare.',
      copy: true, match
    };
  }
  if (id === 'spotify') {
    return {
      visual: sliderVisual(values, T, 12, tStep, 'Spotify'),
      text: T.bands.map((b, i) => bandHz(b).padEnd(9) + fmtDb(values[i], tStep) + ' dB').join('\n'),
      note: 'Spotify’s sliders can’t take typed values, so drag each one to match the picture. You’ll find the equaliser in Spotify’s settings under Playback or Audio quality, depending on your device.',
      copy: true, match
    };
  }
  if (id === 'android') {
    return {
      visual: sliderVisual(values, T, 12, tStep, 'the Android equaliser'),
      text: T.bands.map((b, i) => bandHz(b).padEnd(9) + fmtDb(values[i], tStep) + ' dB').join('\n'),
      note: 'Many Android music apps use the phone’s built-in five-band equaliser at 60 Hz, 230 Hz, 910 Hz, 3.6 kHz and 14 kHz. If your app’s sliders show other frequencies, use the closest ones, or the Wavelet export for an exact curve.',
      copy: true, match
    };
  }
  if (id === 'tone') {
    return {
      visual: sliderVisual(values, T, 10, tStep, 'your bass, mid and treble controls'),
      text: T.bands.map((b, i) => b.label.padEnd(8) + fmtDb(values[i], tStep) + ' dB').join('\n'),
      note: 'Car stereos, TVs and speakers: set Bass, Mid and Treble to these values. Many cars count in steps rather than dB, and a step is usually 1 to 2 dB: if yours runs to ±10 or more, try these numbers as steps; if it only runs to ±5, try about half. Then fine-tune by ear, with bass boost, loudness and sound modes turned off.',
      copy: true, match
    };
  }
  // Apple Music (Mac) and other 10-band equalisers.
  const pre = headroom(values, T);
  const lines = ['Preamp'.padEnd(9) + (pre ? '-' + pre.toFixed(1) : '0.0') + ' dB']
    .concat(T.bands.map((b, i) => bandHz(b).padEnd(9) + signed(values[i]) + ' dB'));
  return {
    text: lines.join('\n'),
    note: 'Music app on a Mac: open the Window menu, choose the equaliser, then set each slider and the preamp as close to these values as you can. The same numbers work in most 10-band equalisers that use these frequencies.',
    copy: true, match
  };
}
