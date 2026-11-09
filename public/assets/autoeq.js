// Headphone corrections from AutoEq (github.com/jaakkopasanen/AutoEq, MIT licence).
// tools/autoeq_build.py turns AutoEq's recommended results (one measurement per model, from the
// most accurate source) into a small search index plus data files of 250 models each, served
// from this site. Nothing is requested from AutoEq, GitHub or the measurement sites.
//
// Each correction is AutoEq's ten-filter parametric EQ that moves the model towards a target:
// the Harman curve for over-ear headphones, AutoEq's in-ear target (based on Harman's research)
// for earphones, or a version of them adjusted for a particular measurement rig.

const BASE = '/assets/autoeq/';
const TARGET_TEXT = {
  'Harman over-ear 2018': 'the Harman target for over-ear headphones',
  'AutoEq in-ear': 'AutoEq’s in-ear target, based on Harman’s research',
  'JM-1 with Harman treble filter': 'a Harman-style target for this measurement rig',
  'LMG 5128 0.6': 'a Harman-style target for this measurement rig'
};
const FORM_TEXT = { 'over-ear': 'Over-ear', 'in-ear': 'In-ear', earbud: 'Earbud' };
const TYPES = { p: 'peaking', l: 'lowshelf', h: 'highshelf' };

let indexP = null;
const shards = {};

/** Load the model list once. Resolves to { list, sources, forms, targets, count, commit, date }. */
export function loadIndex() {
  if (!indexP) {
    indexP = fetch(BASE + 'index.json').then((r) => {
      if (!r.ok) throw new Error('The headphone list didn’t load (' + r.status + ').');
      return r.json();
    }).then((d) => {
      d.items = d.list.map(([name, s, f, t], i) => ({
        i, name, source: d.sources[s], form: d.forms[f], target: d.targets[t],
        key: name + '|' + d.sources[s],
        norm: norm(name), tight: norm(name).replace(/ /g, '')
      }));
      return d;
    }).catch((e) => { indexP = null; throw e; });
  }
  return indexP;
}

const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Models matching a search. Every word must appear (spaces and dashes don't matter, so
 * "wh1000xm4" finds "WH-1000XM4"). Names that start with the search come first, then plain
 * model names before variants in brackets, then shorter names.
 */
export function search(d, q, limit = 40) {
  const nq = norm(q), words = nq.split(' ').filter(Boolean), tq = nq.replace(/ /g, '');
  if (!tq) return { items: [], total: 0 };
  const hits = [];
  for (const it of d.items) {
    const ok = words.every((w) => it.norm.includes(w)) || it.tight.includes(tq);
    if (!ok) continue;
    let rank = it.norm.startsWith(nq) || it.tight.startsWith(tq) ? 0 : (' ' + it.norm).includes(' ' + words[0]) ? 1 : 2;
    if (it.name.includes('(')) rank += 0.5;
    hits.push([rank, it.name.length, it]);
  }
  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].name.localeCompare(b[2].name));
  return { items: hits.slice(0, limit).map((h) => h[2]), total: hits.length };
}

/** The correction for one model: { preamp, specs: [{ type, f, q, gain }] }. */
export async function correction(d, it) {
  const s = Math.floor(it.i / d.shard);
  if (!shards[s]) {
    shards[s] = fetch(BASE + 'eq-' + String(s).padStart(2, '0') + '.json').then((r) => {
      if (!r.ok) throw new Error('The correction didn’t load (' + r.status + ').');
      return r.json();
    }).catch((e) => { delete shards[s]; throw e; });
  }
  const row = (await shards[s])[it.i % d.shard];
  if (!row) throw new Error('That model’s correction is missing.');
  return { preamp: row[0], specs: row.slice(1).map(([t, f, gain, q]) => ({ type: TYPES[t], f, gain, q })) };
}

export const formText = (form) => FORM_TEXT[form] || 'Headphones';
export const targetText = (t) => TARGET_TEXT[t] || 'a Harman-style target';
