import { translateCodon } from './genetics';

/** Secondary structure per residue: H = helix, E = strand, C = loop/coil. */
export type SecStruct = 'H' | 'E' | 'C';

/** Longer proteins are cut short so the 3D view stays smooth. */
export const MAX_RESIDUES = 1500;

export interface ProteinChain {
  /** One-letter amino acids, from the frame start up to (not including) the first stop. */
  residues: string;
  /** Whether a stop codon ends the chain (otherwise the sequence ran out first). */
  stopFound: boolean;
  /** Whether the chain was cut at MAX_RESIDUES. */
  truncated: boolean;
}

/** The protein a ribosome would make reading from `frameStart`. */
export function proteinFrom(seq: string, frameStart: number): ProteinChain {
  let residues = '';
  let stopFound = false;
  for (let i = Math.max(0, frameStart); i + 3 <= seq.length; i += 3) {
    const aa = translateCodon(seq.slice(i, i + 3));
    if (aa === '*') {
      stopFound = true;
      break;
    }
    residues += aa;
  }
  const truncated = residues.length > MAX_RESIDUES;
  return { residues: truncated ? residues.slice(0, MAX_RESIDUES) : residues, stopFound, truncated };
}

/** Chou–Fasman propensities (helix, strand), scaled so 1.0 is neutral. */
const PROPENSITY: Record<string, [number, number]> = {
  A: [1.42, 0.83], R: [0.98, 0.93], N: [0.67, 0.89], D: [1.01, 0.54], C: [0.7, 1.19],
  Q: [1.11, 1.1], E: [1.51, 0.37], G: [0.57, 0.75], H: [1.0, 0.87], I: [1.08, 1.6],
  L: [1.21, 1.3], K: [1.14, 0.74], M: [1.45, 1.05], F: [1.13, 1.38], P: [0.57, 0.55],
  S: [0.77, 0.75], T: [0.83, 1.19], W: [1.08, 1.37], Y: [0.69, 1.47], V: [1.06, 1.7],
};

const MIN_HELIX = 5;
const MIN_STRAND = 3;

/**
 * A simplified Chou–Fasman-style estimate of secondary structure. It averages
 * helix and strand propensities over short windows, then drops runs too short
 * to be real elements. Expect roughly 50–60% agreement with real structures:
 * it's for illustration, not prediction.
 */
export function predictSecondaryStructure(residues: string): SecStruct[] {
  const n = residues.length;
  const pa = new Float64Array(n);
  const pb = new Float64Array(n);
  for (let i = 0; i < n; i++) [pa[i], pb[i]] = PROPENSITY[residues[i]] ?? [1, 1];

  const mean = (arr: Float64Array, from: number, to: number) => {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, from); k <= Math.min(n - 1, to); k++, c++) s += arr[k];
    return c ? s / c : 1;
  };

  // Chou–Fasman style: find nucleation windows, then extend while a 4-residue average stays ≥ 1.
  const grow = (p: Float64Array, size: number, need: number): Uint8Array => {
    const mask = new Uint8Array(n);
    for (let w = 0; w + size <= n; w++) {
      let formers = 0;
      for (let k = w; k < w + size; k++) if (p[k] >= 1.0) formers++;
      if (formers < need) continue;
      let lo = w;
      let hi = w + size - 1;
      while (lo > 0 && mean(p, lo - 1, lo + 2) >= 1.0) lo--;
      while (hi < n - 1 && mean(p, hi - 2, hi + 1) >= 1.0) hi++;
      for (let k = lo; k <= hi; k++) mask[k] = 1;
    }
    return mask;
  };
  const helix = grow(pa, 6, 4);
  const sheet = grow(pb, 5, 3);

  const ss: SecStruct[] = new Array(n).fill('C');
  for (let i = 0; i < n; i++) {
    if (helix[i] && sheet[i]) ss[i] = mean(pa, i - 2, i + 3) >= mean(pb, i - 2, i + 2) ? 'H' : 'E';
    else if (helix[i]) ss[i] = 'H';
    else if (sheet[i]) ss[i] = 'E';
  }
  // Proline breaks helices except near their start.
  for (let i = 0; i < n; i++) {
    if (residues[i] === 'P' && ss[i] === 'H' && i >= 3 && ss[i - 3] === 'H') ss[i] = 'C';
  }
  // Remove runs too short to be real elements.
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && ss[j] === ss[i]) j++;
    const min = ss[i] === 'H' ? MIN_HELIX : ss[i] === 'E' ? MIN_STRAND : 0;
    if (j - i < min) for (let k = i; k < j; k++) ss[k] = 'C';
    i = j;
  }
  return ss;
}

export type PropertyClass = 'hydrophobic' | 'polar' | 'positive' | 'negative';

export const PROPERTY_LABELS: Record<PropertyClass, string> = {
  hydrophobic: 'Water-avoiding',
  polar: 'Water-loving',
  positive: 'Positive charge',
  negative: 'Negative charge',
};

const CLASS_OF: Record<string, PropertyClass> = {};
for (const aa of 'AVLIMFWC') CLASS_OF[aa] = 'hydrophobic';
for (const aa of 'KRH') CLASS_OF[aa] = 'positive';
for (const aa of 'DE') CLASS_OF[aa] = 'negative';

export function propertyClass(aa: string): PropertyClass {
  return CLASS_OF[aa] ?? 'polar';
}

/** Share of residues in each state, 0..1. */
export function structureSummary(ss: SecStruct[]): { helix: number; strand: number; coil: number } {
  const n = ss.length || 1;
  const count = (s: SecStruct) => ss.filter((x) => x === s).length / n;
  return { helix: count('H'), strand: count('E'), coil: count('C') };
}
