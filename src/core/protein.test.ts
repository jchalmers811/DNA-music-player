import { describe, expect, it } from 'vitest';
import { parseFasta } from './fasta';
import { buildInitialChain, CA_BOND, foldProtein, mulberry32, radiusOfGyration } from './fold';
import { MAX_RESIDUES, predictSecondaryStructure, propertyClass, proteinFrom, structureSummary } from './protein';
import { SAMPLES } from './samples';

const dist = (x: Float32Array, i: number, j: number) =>
  Math.hypot(x[j * 3] - x[i * 3], x[j * 3 + 1] - x[i * 3 + 1], x[j * 3 + 2] - x[i * 3 + 2]);

describe('proteinFrom', () => {
  it('translates from the frame start up to the first stop', () => {
    expect(proteinFrom('CCATGGCCTAAGGG', 2)).toEqual({ residues: 'MA', stopFound: true, truncated: false });
  });
  it('reports a missing stop codon', () => {
    expect(proteinFrom('ATGGCC', 0)).toEqual({ residues: 'MA', stopFound: false, truncated: false });
  });
  it('caps very long proteins', () => {
    const p = proteinFrom('GCC'.repeat(MAX_RESIDUES + 10), 0);
    expect(p.residues).toHaveLength(MAX_RESIDUES);
    expect(p.truncated).toBe(true);
  });
});

describe('secondary structure estimate', () => {
  it('calls helix-formers helix, strand-formers strand and Gly/Pro loops', () => {
    expect(predictSecondaryStructure('AEELLKKAEELLKKA').every((s) => s === 'H')).toBe(true);
    expect(predictSecondaryStructure('VIVYVIVTV').filter((s) => s === 'E').length).toBeGreaterThan(6);
    expect(predictSecondaryStructure('GPGSGPGNG').every((s) => s === 'C')).toBe(true);
  });

  it('gives plausible mixes for the samples (haemoglobin mostly helix, GFP more strand)', () => {
    const protein = (id: string) => {
      const seq = parseFasta(SAMPLES.find((s) => s.id === id)!.fasta).records[0].sequence;
      return proteinFrom(seq, 0).residues;
    };
    const hbb = structureSummary(predictSecondaryStructure(protein('hbb')));
    const gfp = structureSummary(predictSecondaryStructure(protein('egfp')));
    expect(hbb.helix).toBeGreaterThan(hbb.strand);
    expect(gfp.strand).toBeGreaterThan(hbb.strand);
  });

  it('classifies residues by property', () => {
    expect(['L', 'K', 'D', 'S'].map(propertyClass)).toEqual(['hydrophobic', 'positive', 'negative', 'polar']);
  });
});

describe('fold', () => {
  it('builds ideal geometry: bonds of 3.8 Å and helix i→i+3 near 5 Å', () => {
    const ss = predictSecondaryStructure('AEELLKKAEELLKKA');
    const x = buildInitialChain(ss, mulberry32(1));
    for (let i = 0; i + 1 < ss.length; i++) expect(dist(x, i, i + 1)).toBeCloseTo(CA_BOND, 3);
    expect(dist(x, 3, 6)).toBeGreaterThan(4.5);
    expect(dist(x, 3, 6)).toBeLessThan(5.6);
  });

  const gfp = proteinFrom(parseFasta(SAMPLES[2].fasta).records[0].sequence, 0).residues;
  const fold = foldProtein(gfp);
  const final = fold.frames[fold.frames.length - 1];

  it('is deterministic', () => {
    const again = foldProtein(gfp);
    expect(Array.from(again.frames.at(-1)!.slice(0, 30))).toEqual(Array.from(final.slice(0, 30)));
  });

  it('keeps the chain intact and stops beads overlapping', () => {
    for (let i = 0; i + 1 < fold.n; i++) {
      expect(dist(final, i, i + 1)).toBeGreaterThan(3.3);
      expect(dist(final, i, i + 1)).toBeLessThan(4.3);
    }
    let closest = Infinity;
    for (let i = 0; i < fold.n; i++) for (let j = i + 3; j < fold.n; j++) closest = Math.min(closest, dist(final, i, j));
    expect(closest).toBeGreaterThan(3.2);
  });

  it('collapses into a compact shape', () => {
    expect(radiusOfGyration(final)).toBeLessThan(radiusOfGyration(fold.frames[0]));
    expect(radiusOfGyration(final)).toBeLessThan(3.2 * Math.pow(fold.n, 0.38));
  });

  it('handles tiny proteins', () => {
    expect(foldProtein('').frames[0]).toHaveLength(0);
    expect(foldProtein('M').frames.at(-1)).toHaveLength(3);
  });
});
