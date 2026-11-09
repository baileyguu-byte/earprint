"""Build Earprint's compact headphone-correction data from a checkout of the AutoEq repository.

Reads AutoEq's list of recommended results (one measurement per model, the most accurate source)
and each model's ParametricEQ.txt, and writes:
  <out>/index.json    names, measurement source, form and data shard for every model
  <out>/eq-NN.json    preamp and filters for 250 models each, fetched only when one is picked
  <out>/LICENSE.txt   AutoEq's MIT licence, which must travel with the data

Usage: python3 -I autoeq_build.py <autoeq checkout> <output folder> <commit> <commit date>
"""
import json
import os
import re
import sys
import urllib.parse

repo, out, commit, date = sys.argv[1:5]
results = os.path.join(repo, 'results')

# Targets AutoEq uses for its precomputed results (dbtools/db.ipynb, "Update Results").
# Key: (source, form, rig or None). Values are short codes, explained in the index.
TARGETS = {
    'harman-oe': 'Harman over-ear 2018',
    'autoeq-ie': 'AutoEq in-ear',
    'jm1-harman': 'JM-1 with Harman treble filter',
    'lmg-5128': 'LMG 5128 0.6',
}


def target_for(source, form, rig):
    if form == 'over-ear':
        if source == 'Rtings' and rig and '5128' in rig:
            return 'lmg-5128'
        if source == 'HypetheSonics':
            return 'lmg-5128'
        return 'harman-oe'
    if form == 'earbud':
        if source == 'Rtings' and rig and '5128' in rig:
            return 'lmg-5128'
        if source in ('HypetheSonics',):
            return 'lmg-5128'
        if source in ('Regan Cipher', 'Super Review'):
            return 'harman-oe'
        return 'autoeq-ie'
    # in-ear
    if rig and ('4620' in rig or '5128' in rig):
        return 'jm1-harman'
    if source == 'HypetheSonics' and rig and 'RA0045' in rig:
        return 'harman-oe'
    return 'autoeq-ie'


LINE = re.compile(r'^- \[(.+)\]\(\./(.+)\)\s*$')
FILT = re.compile(r'^Filter\s+\d+:\s+ON\s+(PK|LSC|HSC)\s+Fc\s+([\d.]+)\s+Hz\s+Gain\s+(-?[\d.]+)\s+dB\s+Q\s+([\d.]+)\s*$')
PRE = re.compile(r'^Preamp:\s+(-?[\d.]+)\s+dB\s*$')

entries, skipped = [], []
with open(os.path.join(results, 'README.md'), encoding='utf-8') as fh:
    for raw in fh:
        m = LINE.match(raw.strip())
        if not m:
            continue
        name, rel = m.group(1), urllib.parse.unquote(m.group(2))
        parts = rel.split('/')
        if len(parts) != 3:
            skipped.append((name, 'path ' + rel))
            continue
        source, rigform, folder = parts
        form = next((f for f in ('over-ear', 'in-ear', 'earbud') if rigform.endswith(f)), None)
        if not form:
            skipped.append((name, 'form ' + rigform))
            continue
        rig = rigform[:-len(form)].strip() or None
        path = os.path.join(results, source, rigform, folder, folder + ' ParametricEQ.txt')
        if not os.path.isfile(path):
            skipped.append((name, 'no ParametricEQ.txt'))
            continue
        pre, filters, bad = None, [], False
        with open(path, encoding='utf-8') as pf:
            for ln in pf:
                ln = ln.strip()
                if not ln:
                    continue
                pm, fm = PRE.match(ln), FILT.match(ln)
                if pm:
                    pre = float(pm.group(1))
                elif fm:
                    t, fc, g, q = fm.group(1), float(fm.group(2)), float(fm.group(3)), float(fm.group(4))
                    if not (10 <= fc <= 24000 and -30 <= g <= 30 and 0.05 <= q <= 20):
                        bad = True
                    filters.append([{'PK': 'p', 'LSC': 'l', 'HSC': 'h'}[t], round(fc), round(g, 1), round(q, 2)])
                else:
                    bad = True
        if pre is None or not filters or bad:
            skipped.append((name, 'unexpected ParametricEQ.txt'))
            continue
        entries.append({'name': name.strip(), 'source': source, 'form': form, 'rig': rig,
                        'target': target_for(source, form, rig), 'pre': pre, 'filters': filters})

# Sort by name (case-insensitive) so shards are stable for a given commit.
entries.sort(key=lambda e: (e['name'].lower(), e['source']))
names = [e['name'] for e in entries]
dupes = {n for n in names if names.count(n) > 1}

sources = sorted({e['source'] for e in entries}, key=str.lower)
forms = ['over-ear', 'in-ear', 'earbud']
targets = list(TARGETS)
SHARD = 250

os.makedirs(out, exist_ok=True)
index = {
    'v': 1,
    'from': 'AutoEq (github.com/jaakkopasanen/AutoEq), results/README.md recommended list',
    'commit': commit,
    'date': date,
    'count': len(entries),
    'shard': SHARD,
    'sources': sources,
    'forms': forms,
    'targets': [TARGETS[t] for t in targets],
    # [name, source index, form index, target index]; an entry's data is in eq-<i // shard>.json at i % shard
    'list': [[e['name'], sources.index(e['source']), forms.index(e['form']), targets.index(e['target'])] for e in entries],
}
with open(os.path.join(out, 'index.json'), 'w', encoding='utf-8') as fh:
    json.dump(index, fh, ensure_ascii=False, separators=(',', ':'))

nshards = (len(entries) + SHARD - 1) // SHARD
for s in range(nshards):
    chunk = entries[s * SHARD:(s + 1) * SHARD]
    # Each row: [preamp, [type, fc, gain, q], ...] in the same order as the index.
    rows = [[e['pre']] + e['filters'] for e in chunk]
    with open(os.path.join(out, 'eq-%02d.json' % s), 'w', encoding='utf-8') as fh:
        json.dump(rows, fh, separators=(',', ':'))

print('entries', len(entries), 'skipped', len(skipped), 'shards', nshards, 'duplicate names', len(dupes))
for n, why in skipped[:20]:
    print('  skipped:', n, '-', why)
print('sources', sources)
from collections import Counter
print('forms', Counter(e['form'] for e in entries))
print('targets', Counter(e['target'] for e in entries))
print('filters per entry', Counter(len(e['filters']) for e in entries))
print('types', Counter(f[0] for e in entries for f in e['filters']))
print('max |gain|', max(abs(f[2]) for e in entries for f in e['filters']), 'preamp range', min(e['pre'] for e in entries), max(e['pre'] for e in entries))
