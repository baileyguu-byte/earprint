// Small SVG charts for the lab, drawn at the size of their box so text stays a readable size.
// Both compare against the typical song: 0 dB is the median song and the grey range holds
// the middle half of all songs.
import { BAND_LABELS, BAND_NAMES, TYPICAL } from './dsp.js';

const sgn = (v, d = 1) => { const a = Math.abs(v).toFixed(d); return (+a === 0 ? '' : v > 0 ? '+' : '−') + a; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const hz = (i) => BAND_LABELS[i].replace('k', ' kHz') + (BAND_LABELS[i].includes('k') ? '' : ' Hz');
const rangeLo = (i, ref = TYPICAL) => ref.rel.lo[i] - ref.rel.med[i];
const rangeHi = (i, ref = TYPICAL) => ref.rel.hi[i] - ref.rel.med[i];
export const outside = (v, i, ref = TYPICAL) => v < rangeLo(i, ref) || v > rangeHi(i, ref);

/** Bar with a rounded end at the value and a square end on the baseline. */
function bar(x, w, y0, y1, r) {
  const up = y1 < y0, h = Math.abs(y1 - y0);
  r = Math.min(r, h, w / 2);
  if (h < 0.5) return '';
  if (up) return 'M' + x + ' ' + y0 + 'V' + (y1 + r) + 'Q' + x + ' ' + y1 + ' ' + (x + r) + ' ' + y1 + 'H' + (x + w - r) + 'Q' + (x + w) + ' ' + y1 + ' ' + (x + w) + ' ' + (y1 + r) + 'V' + y0 + 'Z';
  return 'M' + x + ' ' + y0 + 'V' + (y1 - r) + 'Q' + x + ' ' + y1 + ' ' + (x + r) + ' ' + y1 + 'H' + (x + w - r) + 'Q' + (x + w) + ' ' + y1 + ' ' + (x + w) + ' ' + (y1 - r) + 'V' + y0 + 'Z';
}

function frame(box, H) {
  const W = Math.max(220, Math.round(box.clientWidth || 400));
  const pad = { l: 6, r: 40, t: 14, b: 28 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b, cw = pw / 10;
  return { W, H, pad, pw, ph, cw };
}
function grid(f, Y, ticks) {
  let s = '';
  ticks.forEach((v) => {
    const y = Y(v).toFixed(1);
    s += '<line class="' + (v === 0 ? 'c-zero' : 'c-grid') + '" x1="' + f.pad.l + '" x2="' + (f.pad.l + f.pw) + '" y1="' + y + '" y2="' + y + '"/>';
    s += '<text class="c-ylab" x="' + (f.pad.l + f.pw + 6) + '" y="' + (+y + 3.5) + '">' + (v === 0 ? 'Typical' : sgn(v, 0)) + '</text>';
  });
  for (let i = 0; i < 10; i++) {
    s += '<text class="c-xlab" x="' + (f.pad.l + (i + 0.5) * f.cw).toFixed(1) + '" y="' + (f.H - 8) + '" text-anchor="middle">' + BAND_LABELS[i] + '</text>';
  }
  return s;
}
function hits(f) {
  let s = '';
  for (let i = 0; i < 10; i++) s += '<rect class="c-hit" data-i="' + i + '" x="' + (f.pad.l + i * f.cw).toFixed(1) + '" y="0" width="' + f.cw.toFixed(1) + '" height="' + (f.H - 4) + '"/>';
  return s;
}

/** Hover and tap tooltips: tipFor(i) returns the HTML for band i. */
function bindTips(box, f, tipFor) {
  let tip = box.querySelector('.c-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'c-tip'; tip.hidden = true; box.append(tip); }
  const svg = box.querySelector('svg');
  const show = (i) => {
    tip.innerHTML = tipFor(i);
    tip.hidden = false;
    const x = f.pad.l + (i + 0.5) * f.cw, tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(f.W - tw, x - tw / 2)) + 'px';
    svg.querySelectorAll('.c-hit').forEach((r) => r.classList.toggle('on', +r.dataset.i === i));
  };
  const hide = () => { tip.hidden = true; svg.querySelectorAll('.c-hit.on').forEach((r) => r.classList.remove('on')); };
  svg.querySelectorAll('.c-hit').forEach((r) => {
    r.addEventListener('pointerenter', () => show(+r.dataset.i));
    r.addEventListener('pointerdown', () => show(+r.dataset.i));
  });
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  box._hideTip = hide;
}

/** This song against a typical song (all music, or its genre): one bar per octave band. */
export function renderBalance(box, dev, ref = TYPICAL) {
  const f = frame(box, 210), lim = 15;
  const Y = (v) => f.pad.t + f.ph / 2 - Math.max(-lim, Math.min(lim, v)) / lim * (f.ph / 2);
  let s = '<svg width="' + f.W + '" height="' + f.H + '" viewBox="0 0 ' + f.W + ' ' + f.H + '" role="img" aria-label="How this song’s energy in each octave compares with a typical song">';
  for (let i = 0; i < 10; i++) {
    const x = f.pad.l + i * f.cw;
    s += '<rect class="c-range" x="' + (x + f.cw * 0.14).toFixed(1) + '" width="' + (f.cw * 0.72).toFixed(1) + '" y="' + Y(rangeHi(i, ref)).toFixed(1) + '" height="' + (Y(rangeLo(i, ref)) - Y(rangeHi(i, ref))).toFixed(1) + '" rx="3"/>';
  }
  s += grid(f, Y, [10, 0, -10]);
  for (let i = 0; i < 10; i++) {
    const v = dev[i], out = outside(v, i, ref), x = f.pad.l + i * f.cw, w = Math.min(22, f.cw * 0.42);
    s += '<path class="c-bar' + (out ? ' out' : '') + '" d="' + bar(+(x + (f.cw - w) / 2).toFixed(1), +w.toFixed(1), Y(0), Y(v), 4) + '"/>';
    if (out) {
      const ly = v >= 0 ? Y(v) - 5 : Y(v) + 13;
      s += '<text class="c-val" x="' + (x + f.cw / 2).toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle">' + sgn(v, 0) + '</text>';
    }
  }
  s += hits(f) + '</svg>';
  box.innerHTML = s;
  const what = ref === TYPICAL ? 'songs' : ref.noun + 's';
  bindTips(box, f, (i) => '<b>' + hz(i) + ' · ' + esc(cap(BAND_NAMES[i])) + '</b><span>' + sgn(dev[i]) + ' dB against a typical ' + esc(ref.noun) + '</span><span class="m">Half of all ' + esc(what) + ': ' + sgn(rangeLo(i, ref)) + ' to ' + sgn(rangeHi(i, ref)) + ' dB</span>');
}

/**
 * Your artists against the typical song: a line per artist (colour slots 1–5, in pick order)
 * and a heavier line for the average across them.
 */
export function renderArtists(box, series, avg) {
  const f = frame(box, 240), lim = 12;
  const Y = (v) => f.pad.t + f.ph / 2 - Math.max(-lim, Math.min(lim, v)) / lim * (f.ph / 2);
  const X = (i) => f.pad.l + (i + 0.5) * f.cw;
  const pts = (vals) => vals.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ');
  let s = '<svg width="' + f.W + '" height="' + f.H + '" viewBox="0 0 ' + f.W + ' ' + f.H + '" role="img" aria-label="Your artists’ balance in each octave compared with a typical song">';
  const up = [], down = [];
  for (let i = 0; i < 10; i++) { up.push(X(i).toFixed(1) + ',' + Y(rangeHi(i)).toFixed(1)); down.unshift(X(i).toFixed(1) + ',' + Y(rangeLo(i)).toFixed(1)); }
  s += '<polygon class="c-range" points="' + up.concat(down).join(' ') + '"/>';
  s += grid(f, Y, [10, 5, 0, -5, -10]);
  series.forEach((a) => {
    s += '<polyline class="c-line s' + a.slot + '" points="' + pts(a.dev) + '"/>';
    a.dev.forEach((v, i) => { s += '<circle class="c-pt s' + a.slot + '" cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="2.6"/>'; });
  });
  if (avg) {
    s += '<polyline class="c-avg" points="' + pts(avg) + '"/>';
    avg.forEach((v, i) => { s += '<circle class="c-avgpt" cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="4.5"/>'; });
  }
  s += hits(f) + '</svg>';
  box.innerHTML = s;
  bindTips(box, f, (i) => {
    let h = '<b>' + hz(i) + ' · ' + esc(cap(BAND_NAMES[i])) + '</b>';
    if (avg) h += '<span class="tr"><i class="sw avg"></i>Average<em>' + sgn(avg[i]) + '</em></span>';
    series.slice().sort((p, q) => q.dev[i] - p.dev[i]).forEach((a) => { h += '<span class="tr"><i class="sw s' + a.slot + '"></i>' + esc(a.name) + '<em>' + sgn(a.dev[i]) + '</em></span>'; });
    return h + '<span class="m">dB against the typical song</span>';
  });
}
