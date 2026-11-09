// Small line charts over a log frequency axis: the headphone correction, hearing and age (lab and
// front page). Drawn as SVG at the size of their box, with a crosshair and tooltip that snap to
// the nearest frequency on hover, touch or the arrow keys. No other imports, so the front page
// can use it without loading the lab's audio code.

const NS = 'http://www.w3.org/2000/svg';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const sgn = (v, d = 1) => { const a = Math.abs(v).toFixed(d); return (+a === 0 ? '' : v > 0 ? '+' : '−') + a; };
export const fText = (f) => (f >= 1000 ? (Math.round(f / 100) / 10) + ' kHz' : Math.round(f) + ' Hz');

/**
 * cfg: {
 *   height, fMin, fMax, xTicks: [[f, label]], yMin, yMax, yTicks: [v], yFmt(v),
 *   series: [{ label, freqs, values, cls, area?: true, end?: 'label at the line end' }],
 *   snap: frequencies the crosshair stops at, tipRows(k, f) -> [[cls, label, value text]],
 *   aria: 'what the chart shows'
 * }
 */
export function renderCurveChart(box, cfg) {
  const W = Math.max(200, Math.round(box.clientWidth || 360)), H = cfg.height || 160;
  const endW = cfg.series.some((s) => s.end) ? 52 : 0;
  const pad = { l: 4, r: 40 + endW, t: 10, b: 24 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  const lx = (f) => Math.log2(f / cfg.fMin) / Math.log2(cfg.fMax / cfg.fMin);
  const X = (f) => pad.l + Math.max(0, Math.min(1, lx(f))) * pw;
  const Y = (v) => pad.t + (cfg.yMax - Math.max(cfg.yMin, Math.min(cfg.yMax, v))) / (cfg.yMax - cfg.yMin) * ph;
  const fmt = cfg.yFmt || ((v) => (v === 0 ? '0 dB' : sgn(v, 0)));
  let s = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(cfg.aria || '') + '">';
  cfg.yTicks.forEach((v) => {
    const y = Y(v).toFixed(1);
    s += '<line class="' + (v === 0 ? 'c-zero' : 'c-grid') + '" x1="' + pad.l + '" x2="' + (pad.l + pw) + '" y1="' + y + '" y2="' + y + '"/>';
    s += '<text class="c-ylab" x="' + (pad.l + pw + endW + 6) + '" y="' + (+y + 3.5) + '">' + esc(fmt(v)) + '</text>';
  });
  cfg.xTicks.forEach(([f, label]) => {
    const x = X(f), anchor = x - pad.l < 16 ? 'start' : pad.l + pw - x < 16 ? 'end' : 'middle';
    s += '<text class="c-xlab" x="' + x.toFixed(1) + '" y="' + (H - 7) + '" text-anchor="' + anchor + '">' + esc(label) + '</text>';
  });
  const path = (sr) => sr.freqs.map((f, k) => (k ? 'L' : 'M') + X(f).toFixed(1) + ' ' + Y(sr.values[k]).toFixed(1)).join('');
  cfg.series.forEach((sr) => {
    if (sr.area) {
      const base = Y(Math.max(cfg.yMin, Math.min(cfg.yMax, 0))).toFixed(1);
      s += '<path class="cc-area ' + sr.cls + '" d="' + path(sr) + 'L' + X(sr.freqs[sr.freqs.length - 1]).toFixed(1) + ' ' + base + 'L' + X(sr.freqs[0]).toFixed(1) + ' ' + base + 'Z"/>';
    }
    s += '<path class="cc-line ' + sr.cls + '" d="' + path(sr) + '"/>';
  });
  cfg.series.forEach((sr) => {
    if (!sr.end) return;
    const n = sr.freqs.length - 1, x = X(sr.freqs[n]), y = Y(sr.values[n]);
    s += '<circle class="cc-end ' + sr.cls + '" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="4"/>';
    s += '<text class="c-val" x="' + (x + 8).toFixed(1) + '" y="' + (y + 3.5).toFixed(1) + '">' + esc(sr.end) + '</text>';
  });
  s += '<line class="cc-cross" x1="0" x2="0" y1="' + pad.t + '" y2="' + (pad.t + ph) + '" visibility="hidden"/>';
  s += '<rect class="c-hit" x="' + pad.l + '" y="0" width="' + pw + '" height="' + (H - 4) + '"/></svg>';
  box.innerHTML = s;
  if (!cfg.tipRows || !cfg.snap || !cfg.snap.length) return;

  // Crosshair and tooltip.
  const svg = box.querySelector('svg'), cross = svg.querySelector('.cc-cross');
  let tip = box.querySelector('.c-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'c-tip'; tip.hidden = true; box.append(tip); }
  let at = -1;
  const show = (k) => {
    at = k;
    const f = cfg.snap[k], x = X(f);
    cross.setAttribute('x1', x.toFixed(1)); cross.setAttribute('x2', x.toFixed(1));
    cross.setAttribute('visibility', 'visible');
    tip.innerHTML = '<b>' + esc(fText(f)) + '</b>' + cfg.tipRows(k, f).map(([cls, label, val]) =>
      '<span class="tr"><i class="lk ' + esc(cls) + '"></i>' + esc(label) + '<em>' + esc(val) + '</em></span>').join('');
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(W - tw, x - tw / 2)) + 'px';
  };
  const hide = () => { at = -1; cross.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  const nearest = (clientX) => {
    const r = svg.getBoundingClientRect(), fx = (clientX - r.left - pad.l) / pw;
    let best = 0, bd = Infinity;
    cfg.snap.forEach((f, k) => { const d = Math.abs(lx(f) - fx); if (d < bd) { bd = d; best = k; } });
    return best;
  };
  svg.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  svg.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  box.tabIndex = 0;
  box.onkeydown = (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    show(Math.max(0, Math.min(cfg.snap.length - 1, (at < 0 ? Math.floor(cfg.snap.length / 2) : at) + (e.key === 'ArrowRight' ? 1 : -1))));
  };
  box.onblur = hide;
  box.onfocus = () => { if (at < 0 && box.matches(':focus-visible')) show(Math.floor(cfg.snap.length / 2)); };
}
