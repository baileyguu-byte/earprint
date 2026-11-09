// EQ cheat sheet for listening. The frequency ranges follow common mixing practice (see the
// front page's further reading); the wording is Earprint's own. A listening EQ moves every
// instrument in a band at once, so these describe what you'll hear change, not one instrument.

/** One entry per fader, 32 Hz to 16 kHz. */
export const BAND_INFO = [
  { name: 'Deep sub-bass', what: 'Felt more than heard: the lowest synth bass, 808 tails and pipe organ. Many earbuds barely play it.', more: 'rumble that uses up headroom', less: 'no floor under the bass' },
  { name: 'Sub-bass', what: 'The thump of the kick drum and the weight of the bass line.', more: 'boomy', less: 'no punch' },
  { name: 'Bass', what: 'Body of the bass guitar, the knock of the kick and warmth in low voices.', more: 'bloated', less: 'thin' },
  { name: 'Upper bass', what: 'Fullness: snare body and the low notes of guitar and piano.', more: 'muddy', less: 'cold' },
  { name: 'Low mids', what: 'The body of most instruments and voices.', more: 'boxy, like cardboard', less: 'hollow' },
  { name: 'Mids', what: 'Where melodies and the tone of voices sit.', more: 'honky or nasal', less: 'distant' },
  { name: 'Upper mids', what: 'Snare snap, guitar bite and vocal clarity.', more: 'harsh', less: 'muffled' },
  { name: 'Presence', what: 'Consonants and the attack of picks and drums. Ears are most sensitive around here.', more: 'shouty and tiring', less: 'veiled' },
  { name: 'Brilliance', what: 'Cymbals, hi-hats and “s” sounds.', more: 'sharp and hissy', less: 'dull' },
  { name: 'Air', what: 'Shimmer, breath and space. Song previews are MP3 files that lose most of this range.', more: 'hiss', less: 'closed-in' }
];

/**
 * Quick fixes: each click nudges the selected setting by delta (dB per band, 32 Hz…16 kHz).
 * Small steps on purpose, so two or three clicks is a big change.
 */
export const FIXES = [
  { id: 'boomy', label: 'Boomy', hint: 'Bass rings on and blurs the beat', delta: [-1, -2, -1.5, 0, 0, 0, 0, 0, 0, 0] },
  { id: 'muddy', label: 'Muddy', hint: 'Thick and unclear, everything blurs together', delta: [0, 0, -0.5, -2, -1, 0, 0, 0, 0, 0] },
  { id: 'boxy', label: 'Boxy', hint: 'Like it was recorded in a cardboard box', delta: [0, 0, 0, -0.5, -2, -0.5, 0, 0, 0, 0] },
  { id: 'nasal', label: 'Nasal', hint: 'Honky, as if heard through a phone', delta: [0, 0, 0, 0, -0.5, -2, -0.5, 0, 0, 0] },
  { id: 'harsh', label: 'Harsh', hint: 'Edgy and tiring even at normal volume', delta: [0, 0, 0, 0, 0, 0, -1, -2, -0.5, 0] },
  { id: 'sibilant', label: 'Sharp “s” sounds', hint: 'S and T sounds hiss or spit', delta: [0, 0, 0, 0, 0, 0, 0, -0.5, -2, -0.5] },
  { id: 'dull', label: 'Dull', hint: 'No sparkle, like a blanket over the speakers', delta: [0, 0, 0, 0, 0, 0, 0, 0.5, 1.5, 2] },
  { id: 'thin', label: 'Thin', hint: 'Lacks body and warmth', delta: [0, 1, 2, 1, 0, 0, 0, 0, 0, 0] },
  { id: 'punch', label: 'Lacks punch', hint: 'Kick and bass feel soft', delta: [0, 2, 1, 0, 0, 0, 0.5, 0, 0, 0] },
  { id: 'vocals', label: 'Vocals buried', hint: 'Voices sit behind the instruments', delta: [0, 0, 0, -0.5, 0, 0.5, 1.5, 1, 0, 0] }
];
