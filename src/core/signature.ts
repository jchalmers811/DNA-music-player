import type { BeatId } from './drums';
import { findFirstStart, gcContent } from './genetics';
import { predictSecondaryStructure, propertyClass, proteinFrom, structureSummary } from './protein';
import type { ScaleId } from './types';

/**
 * Sound signature v1: every sequence chooses its own key, scale, instrument,
 * drum beat and tempo from properties of the sequence itself. The same
 * sequence always gets the same sound.
 *
 * Similar sequences should sound similar, so:
 * - each choice comes from a smooth property (GC content, amino-acid make-up …)
 *   rather than a checksum, so a one-base edit only nudges it;
 * - each list of options is ordered so neighbours sound alike, so a nudge
 *   across a cut-off lands on a related option, not a random one;
 * - cut-offs come from how the property is spread across typical human genes,
 *   so real genes use the whole range instead of bunching up.
 *
 * Bump SIGNATURE_VERSION and note it in the changelog whenever a sequence's
 * sound would change.
 */
export const SIGNATURE_VERSION = 1;

/** Kept in sync with InstrumentId in src/audio/instruments.ts (core stays free of Tone.js). */
export type SignatureInstrument = 'keys' | 'marimba' | 'bell' | 'pad';

export type SignatureSetting = 'key' | 'scale' | 'tempo' | 'instrument' | 'beat';

export interface SignatureReason {
  setting: SignatureSetting;
  /** The measured property, in plain words, e.g. "GC content 58%". */
  measure: string;
  /** How it compares with typical genes, e.g. "higher than most genes". */
  comparison: string;
  /** What it chose, e.g. "a brighter scale". */
  effect: string;
}

export interface SoundSignature {
  version: number;
  key: number;
  scale: ScaleId;
  tempo: number;
  instrument: SignatureInstrument;
  beat: BeatId;
  /** True when the sequence codes no real protein (no ATG, or under MIN_PROTEIN amino acids), so DNA-only properties were used instead. */
  dnaOnly: boolean;
  reasons: SignatureReason[];
}

/** Proteins shorter than this don't give reliable amino-acid statistics. */
export const MIN_PROTEIN = 30;

/** Bright → dark. Locrian is left out: it's too unsettled for a default. */
export const SCALE_ORDER: ScaleId[] = [
  'lydian',
  'major',
  'majorPentatonic',
  'mixolydian',
  'dorian',
  'minorPentatonic',
  'minor',
  'phrygian',
];

/** Circle of fifths starting at C: neighbouring keys share all but one note. */
export const FIFTHS = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

/** Light → heavy. "Off" is left out: a gene's sound always has drums. */
export const BEAT_ORDER: BeatId[] = [
  'shuffle',
  'steady',
  'dembow',
  'backbeat',
  'sequence',
  'tomGroove',
  'breakbeat',
  'dnb',
  'boomBap',
  'halftime',
  'trap',
];

/** Plucky and bright → smooth and flowing. */
export const INSTRUMENT_ORDER: SignatureInstrument[] = ['bell', 'marimba', 'keys', 'pad'];

export const TEMPO_MIN = 80;
export const TEMPO_MAX = 140;

/**
 * How each property is spread across real human genes: the value at every 5%
 * step (0%, 5%, … 100%), so each option covers an equal share of genes.
 * Measured with signatureTraits() on 795 human protein-coding genes, an even
 * spread through NCBI's RefSeq Select set (one transcript per gene), Nov 2026.
 */
export const GENE_QUANTILES = {
  gc: [0.3257, 0.3996, 0.4152, 0.4325, 0.4454, 0.4578, 0.4705, 0.4831, 0.506, 0.5179, 0.5315, 0.5474, 0.5621, 0.5768, 0.589, 0.602, 0.6189, 0.6365, 0.6546, 0.6766, 0.7389],
  gcSkew: [-0.4947, -0.1297, -0.0979, -0.0776, -0.0588, -0.0442, -0.0327, -0.0211, -0.0074, 0.0022, 0.0173, 0.0259, 0.0349, 0.0472, 0.0564, 0.0691, 0.0797, 0.0964, 0.1263, 0.1529, 0.3846],
  charged: [0.0357, 0.1488, 0.1731, 0.1912, 0.2077, 0.2181, 0.2277, 0.2347, 0.2418, 0.2474, 0.2538, 0.2611, 0.2689, 0.2743, 0.2824, 0.29, 0.2979, 0.309, 0.3224, 0.3453, 0.4844],
  hydrophobic: [0.0878, 0.2773, 0.2988, 0.3164, 0.3269, 0.3357, 0.3434, 0.3543, 0.3628, 0.3704, 0.3769, 0.3844, 0.3926, 0.399, 0.4058, 0.4143, 0.4257, 0.4386, 0.4581, 0.49, 0.5902],
  helixShare: [0, 0.2296, 0.3049, 0.3366, 0.3717, 0.3978, 0.422, 0.4423, 0.4599, 0.4801, 0.4949, 0.5069, 0.5256, 0.5433, 0.5587, 0.5769, 0.6101, 0.6469, 0.6986, 0.7706, 1],
};

/**
 * DNA-only fallbacks have no gene reference set, so they use a rough mean and
 * standard deviation for random-like sequence.
 */
export const DNA_ONLY_SPREAD = {
  positionSpread: { mean: 0.06, sd: 0.05 },
  meanRun: { mean: 1.36, sd: 0.08 },
  repeats: { mean: 0.1, sd: 0.12 },
};

type Calibrated = keyof typeof GENE_QUANTILES | keyof typeof DNA_ONLY_SPREAD;

/** Measured properties of a sequence; exposed for tests and the biology panel. */
export interface SignatureTraits {
  gc: number;
  gcSkew: number;
  proteinLength: number;
  charged: number;
  hydrophobic: number;
  helixShare: number;
  positionSpread: number;
  meanRun: number;
  repeats: number;
}

export function signatureTraits(seq: string): SignatureTraits {
  let g = 0;
  let c = 0;
  for (let i = 0; i < seq.length; i++) {
    if (seq[i] === 'G') g++;
    else if (seq[i] === 'C') c++;
  }
  const atg = findFirstStart(seq);
  // No ATG means no real protein to measure.
  const residues = atg >= 0 ? proteinFrom(seq, atg).residues : '';
  const n = residues.length || 1;
  let charged = 0;
  let hydrophobic = 0;
  for (const aa of residues) {
    const cls = propertyClass(aa);
    if (cls === 'positive' || cls === 'negative') charged++;
    else if (cls === 'hydrophobic') hydrophobic++;
  }
  const ss = structureSummary(predictSecondaryStructure(residues));
  const structured = ss.helix + ss.strand;
  return {
    gc: gcContent(seq),
    gcSkew: g + c ? (g - c) / (g + c) : 0,
    proteinLength: residues.length,
    charged: charged / n,
    hydrophobic: hydrophobic / n,
    helixShare: structured > 0 ? ss.helix / structured : 0.5,
    positionSpread: positionSpread(seq),
    meanRun: meanRunLength(seq),
    repeats: repeatShare(seq),
  };
}

/** Spread of GC content across the three codon positions (max − min). Coding DNA has a strong pattern. */
function positionSpread(seq: string): number {
  const gc = [0, 0, 0];
  const all = [0, 0, 0];
  for (let i = 0; i < seq.length; i++) {
    const b = seq[i];
    if (b === 'N') continue;
    all[i % 3]++;
    if (b === 'G' || b === 'C') gc[i % 3]++;
  }
  const f = gc.map((x, i) => (all[i] ? x / all[i] : 0));
  return Math.max(...f) - Math.min(...f);
}

/** Average length of runs of the same base (random DNA ≈ 1.33). */
function meanRunLength(seq: string): number {
  if (!seq.length) return 1;
  let runs = 1;
  for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) runs++;
  return seq.length / runs;
}

/** Share of 8-base words that have already appeared earlier in the sequence. */
function repeatShare(seq: string): number {
  const k = 8;
  if (seq.length < k + 1) return 0;
  const seen = new Set<string>();
  let repeated = 0;
  const total = seq.length - k + 1;
  for (let i = 0; i < total; i++) {
    const w = seq.slice(i, i + k);
    if (seen.has(w)) repeated++;
    else seen.add(w);
  }
  return repeated / total;
}

/** Normal CDF (Abramowitz–Stegun 7.1.26), accurate to ~1e-7. */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Where a value sits among typical genes, 0..1 (0.5 = average). */
export function percentile(trait: Calibrated, value: number): number {
  if (trait in DNA_ONLY_SPREAD) {
    const { mean, sd } = DNA_ONLY_SPREAD[trait as keyof typeof DNA_ONLY_SPREAD];
    return normalCdf((value - mean) / sd);
  }
  // Straight-line interpolation between the 5% steps: smooth, and never goes backwards.
  const q = GENE_QUANTILES[trait as keyof typeof GENE_QUANTILES];
  const last = q.length - 1;
  if (value <= q[0]) return 0;
  if (value >= q[last]) return 1;
  let i = 0;
  while (q[i + 1] < value) i++;
  const span = q[i + 1] - q[i];
  return (i + (span > 0 ? (value - q[i]) / span : 0)) / last;
}

/** Pick from an ordered list so each option covers an equal share of typical genes. */
function pick<T>(options: T[], p: number): T {
  return options[Math.min(options.length - 1, Math.floor(p * options.length))];
}

function compare(p: number, low: string, high: string, what = 'most genes'): string {
  if (p < 0.2) return `much ${low} than ${what}`;
  if (p < 0.4) return `${low} than ${what}`;
  if (p <= 0.6) return `about average`;
  if (p <= 0.8) return `${high} than ${what}`;
  return `much ${high} than ${what}`;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const brightness = (i: number, n: number) =>
  i < n * 0.25 ? 'a bright scale' : i < n * 0.5 ? 'a fairly bright scale' : i < n * 0.75 ? 'a darker scale' : 'a dark scale';

export function soundSignature(seq: string): SoundSignature {
  const t = signatureTraits(seq);
  const dnaOnly = t.proteinLength < MIN_PROTEIN;
  const reasons: SignatureReason[] = [];

  // Scale: higher GC → brighter (G–C pairs hold together more tightly).
  const pGc = percentile('gc', t.gc);
  const scaleIndex = SCALE_ORDER.length - 1 - Math.min(SCALE_ORDER.length - 1, Math.floor(pGc * SCALE_ORDER.length));
  reasons.push({
    setting: 'scale',
    measure: `GC content ${pct(t.gc)}`,
    comparison: compare(pGc, 'lower', 'higher'),
    effect: brightness(scaleIndex, SCALE_ORDER.length),
  });

  // Key: GC skew walks around the circle of fifths, with an average gene in C.
  const pSkew = percentile('gcSkew', t.gcSkew);
  const step = Math.min(11, Math.floor(pSkew * 12)) - 6;
  const key = FIFTHS[(step + 12) % 12];
  reasons.push({
    setting: 'key',
    measure: `G vs C balance ${t.gcSkew >= 0 ? '+' : ''}${t.gcSkew.toFixed(2)}`,
    comparison: compare(pSkew, 'more C-leaning', 'more G-leaning'),
    effect: step === 0 ? 'the home key, C' : `${Math.abs(step)} step${Math.abs(step) > 1 ? 's' : ''} ${step > 0 ? 'sharp' : 'flat'} of C on the circle of fifths`,
  });

  let pTempo: number;
  let pBeat: number;
  let pInst: number;
  if (!dnaOnly) {
    pTempo = percentile('charged', t.charged);
    reasons.push({
      setting: 'tempo',
      measure: `${pct(t.charged)} charged amino acids`,
      comparison: compare(pTempo, 'fewer', 'more', 'most proteins'),
      effect: pTempo < 0.4 ? 'a calmer tempo' : pTempo > 0.6 ? 'a livelier tempo' : 'a medium tempo',
    });
    pBeat = percentile('hydrophobic', t.hydrophobic);
    reasons.push({
      setting: 'beat',
      measure: `${pct(t.hydrophobic)} water-avoiding amino acids`,
      comparison: compare(pBeat, 'fewer', 'more', 'most proteins'),
      effect: pBeat < 0.4 ? 'lighter drums' : pBeat > 0.6 ? 'heavier drums' : 'a mid-weight beat',
    });
    pInst = percentile('helixShare', t.helixShare);
    reasons.push({
      setting: 'instrument',
      measure: `estimated shape ${pct(t.helixShare)} helix, ${pct(1 - t.helixShare)} strand`,
      comparison: compare(pInst, 'more strand-rich', 'more helix-rich', 'most proteins'),
      effect: pInst < 0.5 ? 'a plucky, percussive instrument' : 'a smooth, flowing instrument',
    });
  } else {
    pTempo = percentile('positionSpread', t.positionSpread);
    reasons.push({
      setting: 'tempo',
      measure: `GC varies by ${pct(t.positionSpread)} across every third base`,
      comparison: compare(pTempo, 'less', 'more', 'random DNA'),
      effect: pTempo < 0.4 ? 'a calmer tempo' : pTempo > 0.6 ? 'a livelier tempo' : 'a medium tempo',
    });
    pBeat = percentile('meanRun', t.meanRun);
    reasons.push({
      setting: 'beat',
      measure: `runs of the same base average ${t.meanRun.toFixed(2)} bases`,
      comparison: compare(pBeat, 'shorter', 'longer', 'random DNA'),
      effect: pBeat < 0.4 ? 'lighter drums' : pBeat > 0.6 ? 'heavier drums' : 'a mid-weight beat',
    });
    // More repetitive → more plucky, loop-like instruments.
    pInst = 1 - percentile('repeats', t.repeats);
    reasons.push({
      setting: 'instrument',
      measure: `${pct(t.repeats)} of 8-base words repeat`,
      comparison: compare(1 - pInst, 'less repetitive', 'more repetitive', 'random DNA'),
      effect: pInst < 0.5 ? 'a plucky, percussive instrument' : 'a smooth, flowing instrument',
    });
  }

  return {
    version: SIGNATURE_VERSION,
    key,
    scale: SCALE_ORDER[scaleIndex],
    tempo: Math.round(TEMPO_MIN + pTempo * (TEMPO_MAX - TEMPO_MIN)),
    beat: pick(BEAT_ORDER, pBeat),
    instrument: pick(INSTRUMENT_ORDER, pInst),
    dnaOnly,
    reasons,
  };
}
