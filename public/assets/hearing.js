// Hearing and age: how sensitivity typically changes with age, and Earprint's gentle compensation.
//
// The numbers come from ISO 7029:2017 (Acoustics — Statistical distribution of hearing thresholds
// related to age and gender), Formula (1) and Table 1: for otologically normal people, the median
// hearing threshold at age Y differs from age 18 by ΔH = α · (Y − 18)^β dB, for ages 18 to 80 and
// frequencies 125 Hz to 8 kHz. Above 70 the standard gives 3–8 kHz for information only.
// Real people vary widely around the median, and noise exposure adds to it.

export const ISO_F = [125, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000];
const ALPHA = {
  m: [2.50e-6, 1.39e-4, 4.59e-4, 5.70e-4, 7.02e-4, 1.09e-3, 1.56e-3, 2.54e-3, 3.40e-3, 4.53e-3, 5.06e-3],
  f: [6.16e-4, 3.98e-4, 2.61e-4, 2.25e-4, 2.21e-4, 2.53e-4, 3.12e-4, 4.88e-4, 7.37e-4, 1.47e-3, 2.53e-3]
};
const BETA = {
  m: [3.841, 2.832, 2.537, 2.512, 2.494, 2.446, 2.404, 2.350, 2.325, 2.315, 2.328],
  f: [2.451, 2.568, 2.708, 2.775, 2.805, 2.813, 2.792, 2.728, 2.660, 2.539, 2.439]
};
export const AGE_MIN = 18, AGE_MAX = 80;
export const SEXES = { any: 'everyone', f: 'women', m: 'men' };

/** Median hearing change from age 18 at each ISO_F frequency, in dB (positive = less sensitive). */
export function medianShift(age, sex = 'any') {
  const y = Math.max(AGE_MIN, Math.min(AGE_MAX, Number(age) || AGE_MIN)) - 18;
  const one = (s) => ISO_F.map((_, i) => (y > 0 ? ALPHA[s][i] * Math.pow(y, BETA[s][i]) : 0));
  if (sex === 'm' || sex === 'f') return one(sex);
  const m = one('m'), f = one('f');
  return m.map((v, i) => (v + f[i]) / 2);
}

/** The change at any frequency: interpolated in octaves, held below 125 Hz and above 8 kHz. */
export function shiftAt(shifts, f) {
  if (f <= ISO_F[0]) return shifts[0];
  const n = ISO_F.length;
  if (f >= ISO_F[n - 1]) return shifts[n - 1];
  let i = 0;
  while (f > ISO_F[i + 1]) i++;
  const t = Math.log2(f / ISO_F[i]) / Math.log2(ISO_F[i + 1] / ISO_F[i]);
  return shifts[i] * (1 - t) + shifts[i + 1] * t;
}

/*
 * Compensation. You already set the volume for the music's core, so only the difference from
 * the 500 Hz–1 kHz region needs EQ, and only where hearing is weaker (never a cut). Hearing aids
 * give back a third to a half of a loss, because at normal listening levels the ear's loudness
 * growth makes up for part of it and full gain sounds harsh, so Earprint does the same:
 * gentle = a third, stronger = a half. It eases off above 8 kHz, where the standard stops and
 * a boost helps least, and never goes past the cap (+6 dB, the lab's guide).
 */
export const AGE_AMOUNT = { gentle: 1 / 3, strong: 1 / 2 };
const smoothCap = (x, cap) => x / Math.pow(1 + Math.pow(x / cap, 4), 0.25);
export function ageLift(age, sex, amount, freqs, cap = 6) {
  const k = AGE_AMOUNT[amount] || 0;
  const sh = medianShift(age, sex);
  const ref = (shiftAt(sh, 500) + shiftAt(sh, 1000)) / 2;
  return Array.from(freqs, (f) => {
    if (!k) return 0;
    const ease = f <= 8000 ? 1 : Math.max(0.5, 1 - 0.5 * Math.log2(f / 8000));
    return smoothCap(k * Math.max(0, shiftAt(sh, f) - ref) * ease, cap);
  });
}

/** Rounded summary numbers for the explanations. */
export function ageSummary(age, sex) {
  const sh = medianShift(age, sex);
  return {
    age: Math.max(AGE_MIN, Math.min(AGE_MAX, Math.round(age))),
    clamped: age > AGE_MAX,
    low: Math.round(Math.max(shiftAt(sh, 250), shiftAt(sh, 500), shiftAt(sh, 1000))),
    k4: Math.round(shiftAt(sh, 4000)),
    k8: Math.round(shiftAt(sh, 8000))
  };
}
