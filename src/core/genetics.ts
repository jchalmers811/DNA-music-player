import type { Base } from './types';

const TCAG = 'TCAG';
/** Standard genetic code, indexed by 16*b1 + 4*b2 + b3 in TCAG order. '*' = stop. */
const CODE = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';

export const BASE_NAMES: Record<Base, string> = {
  A: 'adenine',
  C: 'cytosine',
  G: 'guanine',
  T: 'thymine',
  N: 'unknown base',
};

const COMPLEMENT: Record<string, Base> = { A: 'T', T: 'A', C: 'G', G: 'C', N: 'N' };

export function complement(base: string): Base {
  return COMPLEMENT[base] ?? 'N';
}

/** Translate one codon to a one-letter amino acid code; '*' = stop, 'X' = unknown. */
export function translateCodon(codon: string): string {
  if (codon.length !== 3) return 'X';
  const a = TCAG.indexOf(codon[0]);
  const b = TCAG.indexOf(codon[1]);
  const c = TCAG.indexOf(codon[2]);
  if (a < 0 || b < 0 || c < 0) return 'X';
  return CODE[a * 16 + b * 4 + c];
}

/** Translate from `start` in steps of three. Stops are included as '*'. */
export function translate(seq: string, start = 0): string {
  let out = '';
  for (let i = start; i + 3 <= seq.length; i += 3) out += translateCodon(seq.slice(i, i + 3));
  return out;
}

/** Index of the first ATG, or -1. */
export function findFirstStart(seq: string): number {
  return seq.indexOf('ATG');
}

/** Fraction of G and C among unambiguous bases (0..1). */
export function gcContent(seq: string): number {
  let gc = 0;
  let known = 0;
  for (let i = 0; i < seq.length; i++) {
    const b = seq.charCodeAt(i);
    if (b === 71 || b === 67) gc++; // G, C
    if (b !== 78) known++; // not N
  }
  return known === 0 ? 0 : gc / known;
}

export interface AminoAcid {
  three: string;
  name: string;
  /** Kyte–Doolittle hydropathy; positive = hydrophobic. */
  hydropathy: number;
}

export const AMINO_ACIDS: Record<string, AminoAcid> = {
  A: { three: 'Ala', name: 'Alanine', hydropathy: 1.8 },
  R: { three: 'Arg', name: 'Arginine', hydropathy: -4.5 },
  N: { three: 'Asn', name: 'Asparagine', hydropathy: -3.5 },
  D: { three: 'Asp', name: 'Aspartate', hydropathy: -3.5 },
  C: { three: 'Cys', name: 'Cysteine', hydropathy: 2.5 },
  Q: { three: 'Gln', name: 'Glutamine', hydropathy: -3.5 },
  E: { three: 'Glu', name: 'Glutamate', hydropathy: -3.5 },
  G: { three: 'Gly', name: 'Glycine', hydropathy: -0.4 },
  H: { three: 'His', name: 'Histidine', hydropathy: -3.2 },
  I: { three: 'Ile', name: 'Isoleucine', hydropathy: 4.5 },
  L: { three: 'Leu', name: 'Leucine', hydropathy: 3.8 },
  K: { three: 'Lys', name: 'Lysine', hydropathy: -3.9 },
  M: { three: 'Met', name: 'Methionine', hydropathy: 1.9 },
  F: { three: 'Phe', name: 'Phenylalanine', hydropathy: 2.8 },
  P: { three: 'Pro', name: 'Proline', hydropathy: -1.6 },
  S: { three: 'Ser', name: 'Serine', hydropathy: -0.8 },
  T: { three: 'Thr', name: 'Threonine', hydropathy: -0.7 },
  W: { three: 'Trp', name: 'Tryptophan', hydropathy: -0.9 },
  Y: { three: 'Tyr', name: 'Tyrosine', hydropathy: -1.3 },
  V: { three: 'Val', name: 'Valine', hydropathy: 4.2 },
};

/**
 * The 20 amino acids ordered from most hydrophilic to most hydrophobic.
 * Used to give similar residues nearby pitches.
 */
export const HYDROPATHY_ORDER: string[] = Object.keys(AMINO_ACIDS).sort(
  (a, b) => AMINO_ACIDS[a].hydropathy - AMINO_ACIDS[b].hydropathy || a.localeCompare(b),
);
